/**
 * uniclaw-shell — UniClaw (元景网关) 登录与套餐集成插件。
 *
 * Host-side only (phase 1). Registers proxy routes on the harness web server
 * for the YuanJing gateway's captcha / sendCode / smsLogin / my-plan
 * endpoints, stores the per-user credentials through `ctx.credentials`, and
 * materializes the my-plan model catalog into the `llm-pi-ai` provider
 * settings so the models become selectable without a restart.
 *
 * IMPORTANT: this file must stay free of runtime *package* imports. It is
 * loaded by absolute path via a cordis.yml patch (like the scratch-plugin
 * tutorial), outside any package with its own node_modules — workspace
 * packages are `import type` only. Node builtins resolve natively and are
 * fine.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `webServer` into Context.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { registerSkillModule } from './skills.ts'
import { registerMcpModule, requestMcpSync } from './mcp-builtin.ts'

export const name = 'uniclaw-shell'
export const inject = ['webServer', 'settings', 'credentials', 'skills']

// ── Gateway endpoints (env-overridable for enterprise deployments) ──
const AUTH_BASE = process.env.UNICLAW_AUTH_BASE ?? 'https://maas.ai-yuanjing.com/app'
const GATEWAY_BASE = process.env.UNICLAW_GATEWAY_BASE ?? 'https://maas.ai-yuanjing.com/app/gateway'
const APPLICATION = process.env.UNICLAW_APPLICATION ?? 'uniclaw'
const UPSTREAM_TIMEOUT_MS = 20_000

// Branded-string casts; the runtime brand functions only validate the
// spelling, and these literals are known-good (lowercase kebab / POSIX id).
const LLM_NS = 'llm-pi-ai' as SettingsNamespace
const APP_TOKEN_REF = 'UNICLAW_APP_TOKEN' as CredentialRef
const JWT_REF = 'UNICLAW_JWT' as CredentialRef

/** Provider route id inside llm-pi-ai's `providers` dictionary. */
const PROVIDER_ID = 'uniclaw'

// ── UniClaw wire shapes (see UniClaw docs/uniclaw-api.yaml) ──

interface UniclawModelEntry {
  id?: string
  display_name?: string
  api_key?: string
  base_url?: string
  model?: string
  provider?: string
  context_window?: number
  max_tokens?: number
  supported_modalities?: string[]
}

interface UniclawModelCatalog {
  models: UniclawModelEntry[]
  main_model_id?: string
  fast_model_id?: string
}

/** Last my-plan snapshot (models string stripped), for the status route. */
let lastPlan: Record<string, unknown> | undefined
let lastMaterialized: { providerCount: number; modelCount: number; at: string } | undefined

export function apply(ctx: Context) {
  const debugEnabled = process.env.UNICLAW_SHELL_DEBUG === '1'

  // ── Login proxies ──

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/uniclaw/login/captcha',
    handler: async (_req, res) => {
      const upstream = await gatewayFetch(`${AUTH_BASE}/login/captcha`)
      await relayJson(upstream, res)
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/uniclaw/login/sendCode',
    handler: async (req, res) => {
      const body = await readJson(req)
      const upstream = await gatewayFetch(`${AUTH_BASE}/login/sendCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: body.phone,
          captchaCode: body.captchaCode,
          captchaId: body.captchaId,
        }),
      })
      await relayJson(upstream, res)
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/uniclaw/login/smsLogin',
    handler: async (req, res) => {
      const body = await readJson(req)
      const upstream = await gatewayFetch(`${AUTH_BASE}/login/smsLogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: body.phone,
          smsCode: body.smsCode,
          origin: 'app',
          application: APPLICATION,
        }),
      })
      const payload = (await upstream.json()) as {
        code?: number
        data?: { token?: string; app_token?: string; plan?: Record<string, unknown> }
        msg?: string
      }

      if (payload.code === 0 && payload.data?.token) {
        await ctx.credentials.set(JWT_REF, payload.data.token)
        if (typeof payload.data.app_token === 'string' && payload.data.app_token.startsWith('sk-')) {
          await ctx.credentials.set(APP_TOKEN_REF, payload.data.app_token)
          requestMcpSync(ctx, payload.data.app_token)
        } else {
          // Same boundary UniClaw warns about: no usable token on this account.
          console.warn('[uniclaw-shell] smsLogin succeeded but returned no sk- app_token; models will fail auth until one is issued')
        }
        // Materialize the model catalog right away; login response has no
        // models, only my-plan does.
        try {
          await refreshMyPlan(ctx, payload.data.token)
        } catch (error) {
          console.warn('[uniclaw-shell] my-plan refresh after login failed:', error)
        }
      }

      sendJson(res, upstream.status, payload)
    },
  })

  // ── my-plan proxy + model materialization ──

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/uniclaw/my-plan',
    handler: async (_req, res) => {
      const jwt = await ctx.credentials.resolve(JWT_REF)
      if (!jwt) {
        sendJson(res, 401, { code: 401, msg: 'not logged in (no stored JWT)' })
        return
      }
      const payload = await refreshMyPlan(ctx, jwt.value)
      sendJson(res, 200, payload)
    },
  })

  // ── Status (login page + debugging) ──

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/uniclaw/status',
    handler: async (_req, res) => {
      const [jwt, appToken] = await Promise.all([
        ctx.credentials.describe(JWT_REF),
        ctx.credentials.describe(APP_TOKEN_REF),
      ])
      // The plan snapshot is in-memory; after a restart, lazily re-pull
      // my-plan so the login page shows the plan and the key/model catalog
      // re-syncs on first visit.
      if (jwt.configured && !lastPlan) {
        try {
          const resolved = await ctx.credentials.resolve(JWT_REF)
          if (resolved) await refreshMyPlan(ctx, resolved.value)
        } catch (error) {
          console.warn('[uniclaw-shell] lazy my-plan refresh failed:', error)
        }
      }
      sendJson(res, 200, {
        loggedIn: jwt.configured,
        appTokenConfigured: appToken.configured,
        plan: lastPlan,
        materialized: lastMaterialized,
      })
    },
  })

  // ── Login page (phase 1 stand-in for the client-bundle UI) ──
  // Markup and styles are ported from UniClaw's LoginPage.tsx/.css so the
  // shell matches the app's look; the brand logo ships with the plugin.

  ctx.webServer.register({
    kind: 'exact',
    path: '/uniclaw',
    handler: (_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(LOGIN_PAGE_HTML)
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/uniclaw/brand-logo.png',
    handler: async (_req, res) => {
      const here = dirname(fileURLToPath(import.meta.url))
      const png = await readFile(join(here, '../assets/brand-logo.png'))
      res.statusCode = 200
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.end(png)
    },
  })

  // ── Debug-only: materialize a hand-fed my-plan payload without real login ──

  if (debugEnabled) {
    console.warn('[uniclaw-shell] DEBUG route enabled (UNICLAW_SHELL_DEBUG=1) — do not ship this')
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/uniclaw/debug/materialize',
      handler: async (req, res) => {
        const body = await readJson(req)
        if (typeof body.app_token === 'string' && body.app_token) {
          await ctx.credentials.set(APP_TOKEN_REF, body.app_token)
        }
        const summary = await materializeModels(ctx, body)
        sendJson(res, 200, { ok: true, materialized: summary })
      },
    })
  }

  // ── 扩展-技能 module (marketplace / recommended / installed) ──
  registerSkillModule(ctx)

  // ── MCP module (builtin + custom servers) ──
  registerMcpModule(ctx)
  // Mount MCP servers from the stored login state; UniAI-Toolkit stays
  // unmounted until a key exists, key-free servers mount right away.
  void ctx.credentials.resolve(APP_TOKEN_REF)
    .then((token) => { requestMcpSync(ctx, token?.value ?? '') })
    .catch(() => { requestMcpSync(ctx, '') })

  console.log(`[uniclaw-shell] loaded — login page at /uniclaw (gateway: ${AUTH_BASE})`)
}

// ── my-plan fetch + materialization ──

async function refreshMyPlan(ctx: Context, jwt: string): Promise<Record<string, unknown>> {
  const upstream = await gatewayFetch(`${GATEWAY_BASE}/uniclaw/my-plan`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
  if (!upstream.ok) {
    throw new Error(`my-plan returned HTTP ${upstream.status}`)
  }
  const payload = (await upstream.json()) as Record<string, unknown>
  // my-plan's top-level apiKey is the current effective key (voucher
  // redemption rotates it — plan type "updateKey"); keep the stored
  // credential in sync, same as UniClaw's mergeUserWithMyPlan.
  if (typeof payload.apiKey === 'string' && payload.apiKey.startsWith('sk-')) {
    await ctx.credentials.set(APP_TOKEN_REF, payload.apiKey)
    // Key rotation remounts key-bearing builtin MCP servers (UniAI-Toolkit).
    requestMcpSync(ctx, payload.apiKey)
  }
  const summary = await materializeModels(ctx, payload)
  if (summary) lastMaterialized = { ...summary, at: new Date().toISOString() }
  // Keep the snapshot small and secret-free: the models string is config,
  // and the apiKey lives in the credential store, not in status responses.
  const { models: _models, apiKey: _apiKey, ...planOnly } = payload
  lastPlan = planOnly
  return payload
}

/**
 * Decode the my-plan `models` JSON string and replace llm-pi-ai's uniclaw
 * provider route(s) with it. Mirrors UniClaw's semantics: full replace on a
 * usable payload, keep last-known-good local catalog on a partial one.
 */
async function materializeModels(
  ctx: Context,
  payload: Record<string, unknown>,
): Promise<{ providerCount: number; modelCount: number } | undefined> {
  const catalog = decodeModelCatalog(payload)
  if (!catalog) return undefined

  // Group by (protocol, base_url) — one llm-pi-ai route per endpoint+protocol
  // (in practice one). UniClaw's backend maps provider=yuanjing to
  // ChatAnthropic ("YuanJing uses Anthropic-compatible API"), so the wire
  // protocol follows each entry's provider, not a global assumption.
  const routes = new Map<string, { protocol: string; baseURL: string; entries: UniclawModelEntry[] }>()
  for (const entry of catalog.models) {
    if (!entry.base_url || !entry.model) continue
    const protocol = protocolFor(entry.provider)
    const key = `${protocol}\n${entry.base_url}`
    const group = routes.get(key) ?? { protocol, baseURL: entry.base_url, entries: [] }
    group.entries.push(entry)
    routes.set(key, group)
  }
  if (routes.size === 0) {
    console.warn('[uniclaw-shell] my-plan models had no entries with base_url+model; keeping local catalog')
    return undefined
  }

  const providers: Record<string, unknown> = {}
  let index = 0
  let modelCount = 0
  for (const { protocol, baseURL, entries } of routes.values()) {
    const routeId = index === 0 ? PROVIDER_ID : `${PROVIDER_ID}-${index + 1}`
    index += 1
    const seen = new Set<string>()
    const models = entries.flatMap((m) => {
      const id = m.model
      // `routes` is keyed while grouping, which already dropped model-less rows.
      if (id === undefined || seen.has(id)) return []
      seen.add(id)
      modelCount += 1
      return [{
        id,
        ...(m.display_name ? { name: m.display_name } : {}),
        ...(typeof m.context_window === 'number' ? { contextWindow: m.context_window } : {}),
        ...(typeof m.max_tokens === 'number' ? { maxTokens: m.max_tokens } : {}),
        ...(m.supported_modalities?.includes('image') ? { input: ['text', 'image'] } : {}),
      }]
    })
    providers[routeId] = {
      displayName: index === 1 ? 'UniClaw 元景' : `UniClaw 元景 ${index}`,
      api: protocol,
      baseURL,
      apiKeyEnv: 'UNICLAW_APP_TOKEN',
      models,
    }
  }

  await ctx.settings.update(LLM_NS, { providers })
  console.log(`[uniclaw-shell] materialized ${modelCount} model(s) across ${routes.size} route(s) into llm-pi-ai`)
  return { providerCount: routes.size, modelCount }
}

/**
 * Wire protocol for one catalog entry, mirroring UniClaw's provider mapping
 * (agent_manager._make_chat_model): yuanjing and anthropic ride the Anthropic
 * messages API (the SDK appends /v1/messages to base_url); everything else is
 * OpenAI-compatible (the SDK appends /chat/completions).
 */
function protocolFor(provider: string | undefined): string {
  return provider === 'yuanjing' || provider === 'anthropic'
    ? 'anthropic-messages'
    : 'openai-completions'
}

function decodeModelCatalog(payload: Record<string, unknown>): UniclawModelCatalog | undefined {
  const raw = payload.models
  if (typeof raw !== 'string' || !raw.trim()) {
    console.warn('[uniclaw-shell] my-plan: no model-config JSON string; keeping local models')
    return undefined
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    console.warn('[uniclaw-shell] my-plan: models is not valid JSON')
    return undefined
  }
  if (
    typeof data !== 'object' || data === null || Array.isArray(data)
    || !Array.isArray((data as UniclawModelCatalog).models)
    || (data as UniclawModelCatalog).models.length === 0
  ) {
    console.warn('[uniclaw-shell] my-plan: models JSON has no usable models; keeping local models')
    return undefined
  }
  return data as UniclawModelCatalog
}

// ── HTTP helpers ──

async function gatewayFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 1_048_576) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

async function relayJson(upstream: Response, res: ServerResponse): Promise<void> {
  const text = await upstream.text()
  res.statusCode = upstream.status
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
  res.end(text)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

// ── Phase-1 login page (ported from UniClaw LoginPage.tsx/.css) ──

const LOGIN_PAGE_HTML = /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>元景 UniClaw</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }

  .login-container {
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; background: #f9fafb;
    animation: fadeInUp 0.6s ease-out;
  }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(24px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .login-card { width: 100%; max-width: 400px; padding: 40px 32px; }
  .login-header { display: flex; align-items: center; justify-content: center; margin-bottom: 24px; }
  .login-logo { max-width: 100%; height: auto; object-fit: contain; }

  .login-status {
    text-align: center; font-size: 13px; color: #6b7280; margin-bottom: 20px;
  }
  .login-status a { color: #2563eb; text-decoration: none; }
  .login-status a:hover { text-decoration: underline; }

  .login-field { margin-bottom: 16px; }
  .login-input-group {
    display: flex; align-items: stretch;
    border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; background: #fff;
  }
  .login-input-group:focus-within {
    border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
  }
  .login-addon {
    display: flex; align-items: center; padding: 0 12px;
    font-size: 14px; color: #374151; background: #f9fafb;
    border-right: 1px solid #d1d5db; white-space: nowrap; user-select: none;
  }
  .login-input {
    flex: 1; border: none; outline: none; padding: 10px 12px;
    font-size: 14px; color: #111827; background: transparent; min-width: 0;
  }
  .login-input::placeholder { color: #9ca3af; }
  .login-captcha-img {
    display: flex; align-items: center; justify-content: center;
    width: 80px; min-height: 40px; background: #f3f4f6;
    cursor: pointer; border-left: 1px solid #d1d5db; flex-shrink: 0;
  }
  .login-captcha-img img { width: 100%; height: 100%; object-fit: contain; }
  .login-captcha-loading { font-size: 11px; color: #9ca3af; }
  .login-send-btn {
    flex-shrink: 0; width: 112px; border: none; border-left: 1px solid #d1d5db;
    background: #fff; color: #2563eb; font-size: 13px; cursor: pointer;
    padding: 0 8px; white-space: nowrap;
  }
  .login-send-btn:hover:not(:disabled) { background: #eff6ff; }
  .login-send-btn:disabled { color: #9ca3af; cursor: not-allowed; }
  .login-error { color: #dc2626; font-size: 14px; text-align: center; margin-bottom: 12px; }
  .login-success { color: #16a34a; font-size: 14px; text-align: center; margin-bottom: 12px; }
  .login-btn {
    width: 100%; height: 44px; border: none; border-radius: 6px;
    background: #2563eb; color: #fff; font-size: 16px; font-weight: 500;
    cursor: pointer; transition: background 0.2s;
  }
  .login-btn:hover:not(:disabled) { background: #1d4ed8; }
  .login-btn:disabled { background: #93c5fd; cursor: not-allowed; }

  @media (prefers-color-scheme: dark) {
    .login-container { background: #111827; }
    .login-input-group { border-color: #374151; background: #1f2937; }
    .login-input-group:focus-within { border-color: #3b82f6; }
    .login-addon { background: #111827; border-color: #374151; color: #d1d5db; }
    .login-input { color: #f9fafb; }
    .login-input::placeholder { color: #6b7280; }
    .login-captcha-img { background: #1f2937; border-color: #374151; }
    .login-send-btn { background: #1f2937; border-color: #374151; color: #60a5fa; }
    .login-send-btn:hover:not(:disabled) { background: #263348; }
    .login-status { color: #9ca3af; }
    .login-status a { color: #60a5fa; }
    .login-logo { filter: brightness(0) invert(1); }
  }
</style>
</head>
<body>
<div class="login-container">
  <div class="login-card">
    <div class="login-header">
      <img class="login-logo" src="/uniclaw/brand-logo.png" alt="元景 UniClaw">
    </div>
    <div class="login-status" id="status"></div>
    <div class="login-field">
      <div class="login-input-group">
        <span class="login-addon">+86</span>
        <input type="tel" class="login-input" id="phone" placeholder="请输入手机号" maxlength="11">
      </div>
    </div>
    <div class="login-field">
      <div class="login-input-group">
        <input type="text" class="login-input" id="captchaCode" placeholder="请输入图形验证码">
        <div class="login-captcha-img" id="captchaBox" title="点击刷新">
          <span class="login-captcha-loading">加载中...</span>
        </div>
      </div>
    </div>
    <div class="login-field">
      <div class="login-input-group">
        <input type="text" class="login-input" id="smsCode" placeholder="请输入短信验证码" maxlength="6">
        <button class="login-send-btn" id="sendBtn" disabled>发送验证码</button>
      </div>
    </div>
    <div id="msg"></div>
    <button class="login-btn" id="loginBtn" disabled>登录</button>
  </div>
</div>
<script>
const $ = function (id) { return document.getElementById(id) }
let captchaId = ''
let countdown = 0
let countdownTimer = null
let loading = false

function phoneValid() { return /^1[3-9]\\d{9}$/.test($('phone').value) }

async function api(path, body) {
  const res = await fetch(path, body === undefined
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

function say(text, ok) {
  $('msg').innerHTML = text
    ? '<div class="' + (ok ? 'login-success' : 'login-error') + '"></div>'
    : ''
  if (text) $('msg').firstChild.textContent = text
}

function syncButtons() {
  $('sendBtn').disabled = !phoneValid() || !$('captchaCode').value.trim() || countdown > 0
  $('loginBtn').disabled = !phoneValid() || !$('smsCode').value.trim() || loading
  $('sendBtn').textContent = countdown > 0 ? countdown + 's后重发' : '发送验证码'
  $('loginBtn').textContent = loading ? '登录中...' : '登录'
}

function startCountdown() {
  countdown = 60
  syncButtons()
  countdownTimer = setInterval(function () {
    countdown -= 1
    if (countdown <= 0) { clearInterval(countdownTimer); countdown = 0 }
    syncButtons()
  }, 1000)
}

async function loadCaptcha() {
  try {
    const r = await api('/api/uniclaw/login/captcha')
    if (r && r.data && r.data.b64s) {
      captchaId = r.data.captchaId || ''
      $('captchaBox').innerHTML = '<img alt="captcha">'
      $('captchaBox').firstChild.src = r.data.b64s
    } else {
      say('验证码加载失败: ' + ((r && r.msg) || '网关无响应'), false)
    }
  } catch (e) { say('验证码加载失败，点击验证码框重试', false) }
}

async function loadStatus() {
  try {
    const s = await api('/api/uniclaw/status')
    if (s.loggedIn) {
      // Already logged in: go straight to the workbench. ?stay=1 is the
      // re-login escape hatch (switch account / refresh key).
      if (!new URLSearchParams(location.search).has('stay')) {
        location.replace('/')
        return
      }
      const plan = s.plan || {}
      $('status').innerHTML = '已登录'
        + (plan.productName ? ' · ' + plan.productName : '')
        + ' · <a href="/">进入工作台 →</a>'
    }
  } catch (e) { /* status is decorative */ }
}

$('captchaBox').onclick = loadCaptcha

$('phone').oninput = function () {
  this.value = this.value.replace(/\\D/g, '').slice(0, 11)
  syncButtons()
}
$('captchaCode').oninput = syncButtons
$('smsCode').oninput = function () {
  this.value = this.value.replace(/\\D/g, '').slice(0, 6)
  syncButtons()
}

$('sendBtn').onclick = async function () {
  say('', true)
  try {
    const r = await api('/api/uniclaw/login/sendCode', {
      phone: $('phone').value, captchaCode: $('captchaCode').value.trim(), captchaId: captchaId,
    })
    if (r.code === 0) {
      startCountdown()
    } else {
      say(r.msg || '发送失败', false)
      $('captchaCode').value = ''
      loadCaptcha()
      syncButtons()
    }
  } catch (e) { say('发送失败，请检查网络', false) }
}

$('loginBtn').onclick = async function () {
  loading = true
  syncButtons()
  say('', true)
  try {
    const r = await api('/api/uniclaw/login/smsLogin', {
      phone: $('phone').value, smsCode: $('smsCode').value,
    })
    if (r.code === 0) {
      say(r.data && r.data.app_token ? '登录成功，正在进入工作台...' : '登录成功，但账号暂无可用密钥', true)
      if (r.data && r.data.app_token) {
        setTimeout(function () { location.href = '/' }, 900)
      } else {
        loadStatus()
      }
    } else {
      if (r.msg && r.msg.indexOf('验证码失效') !== -1) {
        $('captchaCode').value = ''
        $('smsCode').value = ''
        loadCaptcha()
      }
      say(r.msg || '登录失败', false)
    }
  } catch (e) { say('登录失败，请检查网络', false) }
  finally { loading = false; syncButtons() }
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !$('loginBtn').disabled) $('loginBtn').onclick()
})

loadCaptcha()
loadStatus()
</script>
</body>
</html>
`
