/**
 * uniclaw-shell — UniClaw (元景网关) 登录与套餐集成插件。
 *
 * Host-side only (phase 1). Registers proxy routes on the harness web server
 * for the YuanJing gateway's captcha / sendCode / smsLogin / my-plan
 * endpoints, stores the per-user credentials through `ctx.credentials`, and
 * materializes the my-plan model catalog into the `llm-pi-ai` provider
 * settings so the models become selectable without a restart.
 *
 * IMPORTANT: this file must stay free of runtime imports. It is loaded by
 * absolute path via a cordis.yml patch (like the scratch-plugin tutorial),
 * outside any package with its own node_modules — `import type` only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

export const name = 'uniclaw-shell'
export const inject = ['webServer', 'settings', 'credentials']

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
      sendJson(res, 200, {
        loggedIn: jwt.configured,
        appTokenConfigured: appToken.configured,
        plan: lastPlan,
        materialized: lastMaterialized,
      })
    },
  })

  // ── Minimal login page (phase 1 stand-in for the client-bundle UI) ──

  ctx.webServer.register({
    kind: 'exact',
    path: '/uniclaw',
    handler: (_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(LOGIN_PAGE_HTML)
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
  }
  const summary = await materializeModels(ctx, payload)
  if (summary) lastMaterialized = { ...summary, at: new Date().toISOString() }
  // Keep the snapshot small: the models string is config, not display state.
  const { models: _models, ...planOnly } = payload
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
      if (seen.has(m.model!)) return []
      seen.add(m.model!)
      modelCount += 1
      return [{
        id: m.model!,
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

// ── Phase-1 login page ──

const LOGIN_PAGE_HTML = /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UniClaw 登录</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 420px; margin: 48px auto; padding: 0 16px; }
  h1 { font-size: 20px; }
  .row { display: flex; gap: 8px; margin: 10px 0; align-items: center; }
  input { flex: 1; padding: 8px 10px; font-size: 14px; border: 1px solid #8884; border-radius: 6px; background: transparent; color: inherit; }
  button { padding: 8px 14px; font-size: 14px; border: 1px solid #8886; border-radius: 6px; background: #4a6cf71a; cursor: pointer; color: inherit; }
  button:disabled { opacity: .5; cursor: default; }
  img.captcha { height: 38px; border-radius: 6px; cursor: pointer; border: 1px solid #8884; }
  #msg { margin-top: 14px; font-size: 13px; white-space: pre-wrap; word-break: break-all; }
  .ok { color: #1a7f37; } .err { color: #d1242f; }
  a { color: #4a6cf7; }
</style>
</head>
<body>
<h1>UniClaw 登录</h1>
<div id="status"></div>
<div class="row">
  <input id="phone" placeholder="手机号" maxlength="11" inputmode="numeric">
</div>
<div class="row">
  <input id="captchaCode" placeholder="图形验证码">
  <img id="captchaImg" class="captcha" title="点击刷新" alt="验证码加载中">
</div>
<div class="row">
  <input id="smsCode" placeholder="短信验证码" maxlength="6" inputmode="numeric">
  <button id="sendBtn">发送验证码</button>
</div>
<div class="row">
  <button id="loginBtn" style="flex:1">登录</button>
</div>
<div id="msg"></div>
<script>
const $ = (id) => document.getElementById(id)
let captchaId = ''

async function api(path, body) {
  const res = await fetch(path, body === undefined
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

function say(text, ok) {
  const el = $('msg')
  el.textContent = text
  el.className = ok ? 'ok' : 'err'
}

async function loadCaptcha() {
  try {
    const r = await api('/api/uniclaw/login/captcha')
    captchaId = r?.data?.captchaId || ''
    if (r?.data?.b64s) $('captchaImg').src = r.data.b64s
    else say('验证码加载失败: ' + (r?.msg || JSON.stringify(r)), false)
  } catch (e) { say('验证码加载失败: ' + e, false) }
}

async function loadStatus() {
  try {
    const s = await api('/api/uniclaw/status')
    if (s.loggedIn) {
      const plan = s.plan || {}
      const mat = s.materialized
      $('status').innerHTML = '<p class="ok">已登录 · 套餐: ' + (plan.productName || '未知')
        + (plan.status ? ' (' + plan.status + ')' : '')
        + (mat ? ' · 已物化 ' + mat.modelCount + ' 个模型' : '')
        + ' · <a href="/">进入工作台</a></p>'
    }
  } catch {}
}

$('captchaImg').onclick = loadCaptcha

$('sendBtn').onclick = async () => {
  $('sendBtn').disabled = true
  try {
    const r = await api('/api/uniclaw/login/sendCode', {
      phone: $('phone').value.trim(), captchaCode: $('captchaCode').value.trim(), captchaId,
    })
    if (r.code === 0) say('验证码已发送', true)
    else { say(r.msg || JSON.stringify(r), false); loadCaptcha() }
  } catch (e) { say('发送失败: ' + e, false) }
  finally { $('sendBtn').disabled = false }
}

$('loginBtn').onclick = async () => {
  $('loginBtn').disabled = true
  try {
    const r = await api('/api/uniclaw/login/smsLogin', {
      phone: $('phone').value.trim(), smsCode: $('smsCode').value.trim(),
    })
    if (r.code === 0) {
      say('登录成功' + (r.data && r.data.app_token ? '，模型已配置' : '，但账号暂无可用密钥'), true)
      loadStatus()
    } else say(r.msg || JSON.stringify(r), false)
  } catch (e) { say('登录失败: ' + e, false) }
  finally { $('loginBtn').disabled = false }
}

loadCaptcha()
loadStatus()
</script>
</body>
</html>
`
