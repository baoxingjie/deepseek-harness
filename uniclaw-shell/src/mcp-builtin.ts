/**
 * uniclaw-shell MCP 模块 — UniClaw app 的内置 + 自定义 MCP servers 在 harness 上的实现。
 *
 * The UniClaw app ships three builtin MCP servers in its bundled config.json
 * (UniAI-Toolkit / playwright / arXiv-mcp) and lets users add custom HTTP or
 * stdio servers in its settings dialog. Here every enabled server — builtin
 * and custom alike — mounts one `@deepseek-ai/dsh-mcp-client` plugin instance
 * via `ctx.plugin()`: the stock bridge registers the server's tools on
 * `ctx.tools` as `mcp__<serverName>__<rawName>`, model-callable in
 * conversation, with reconnect/re-sync handled by the bridge itself.
 *
 * UniAI-Toolkit needs the login key: its URL carries an empty `key=` field
 * filled with the my-plan apiKey (the stored UNICLAW_APP_TOKEN) — the same
 * `inject_yuanjing_key()` semantics as the UniClaw backend. Login and every
 * my-plan refresh call `requestMcpSync()` with the current key; a rotated
 * key remounts the bridge with the new URL.
 *
 * Custom servers persist in `<dshHome>/uniclaw-mcp.json` next to the builtin
 * enable overrides; edits remount only the touched server (the mount manager
 * reconciles against a config signature).
 *
 * The mcp-client module is imported by source path relative to this file
 * (the plugin mounts by absolute path outside every node_modules resolution
 * domain, so bare workspace specifiers do not resolve here; the bridge's own
 * dependencies resolve from its package directory).
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** mcp-client serverName grammar (its SERVER_NAME_PATTERN). */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

interface BuiltinMcpDef {
  /** Stable id used by the toggle API and the persisted override map. */
  id: string
  /** mcp-client serverName — the model-facing tool namespace. */
  serverName: string
  transport: 'streamable-http' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  /** URL carries a `key=` field that must be filled with the login app token. */
  needsKey: boolean
  defaultEnabled: boolean
  /** One-line UI hint shown on the skills page. */
  note: string
}

/** UniClaw app bundled config.json `mcp_servers`, is_builtin entries. */
const BUILTIN_MCPS: BuiltinMcpDef[] = [
  {
    id: 'uniai-toolkit',
    serverName: 'UniAI-Toolkit',
    transport: 'streamable-http',
    url: process.env.UNICLAW_UNIAI_MCP_URL
      ?? 'https://maas.ai-yuanjing.com/app/mcp-server/mcp?key=&client_id=UniClaw-Work-test',
    needsKey: true,
    defaultEnabled: true,
    note: '元景 UniAI 工具集（登录后自动连接，key 随套餐刷新轮换）',
  },
  {
    id: 'arxiv-mcp',
    serverName: 'arXiv-mcp',
    transport: 'streamable-http',
    url: 'https://arxiv.caseyjhand.com/mcp',
    needsKey: false,
    defaultEnabled: true,
    note: 'arXiv 论文检索',
  },
  {
    // UniClaw gates this on its managed browser runtime; the harness has no
    // such runtime manager, and `npx @playwright/mcp` downloads on first use,
    // so it ships opt-in instead of on-by-default.
    id: 'playwright',
    serverName: 'playwright',
    transport: 'stdio',
    command: 'npx',
    args: ['@playwright/mcp@latest', '--isolated'],
    needsKey: false,
    defaultEnabled: false,
    note: '浏览器自动化（需本机 npx 与浏览器，默认关闭）',
  },
]

/** One user-defined MCP server, persisted verbatim. */
interface CustomMcpEntry {
  id: string
  serverName: string
  transport: 'streamable-http' | 'stdio'
  url: string
  headers: Record<string, string>
  command: string
  /** Whitespace-separated argument string, split at mount (UniClaw stores the same). */
  args: string
  env: Record<string, string>
  enabled: boolean
}

interface McpState {
  /** Builtin enabled overrides; absence means the shipped default. */
  overrides: Record<string, boolean>
  custom: CustomMcpEntry[]
}

function statePath(): string {
  const env = process.env.DSH_HOME
  const home = resolve(env !== undefined && env.trim().length > 0 ? env : join(homedir(), '.dsh'))
  return join(home, 'uniclaw-mcp.json')
}

async function readState(): Promise<McpState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath(), 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const raw = parsed as { overrides?: unknown; custom?: unknown }
      const overrides = typeof raw.overrides === 'object' && raw.overrides !== null && !Array.isArray(raw.overrides)
        ? Object.fromEntries(Object.entries(raw.overrides).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>
        : {}
      const custom = Array.isArray(raw.custom)
        ? raw.custom.filter((e): e is CustomMcpEntry =>
            typeof e === 'object' && e !== null
            && typeof (e as CustomMcpEntry).id === 'string'
            && typeof (e as CustomMcpEntry).serverName === 'string')
        : []
      return { overrides, custom }
    }
  } catch { /* absent or corrupt state reads as defaults-only */ }
  return { overrides: {}, custom: [] }
}

async function writeState(state: McpState): Promise<void> {
  await mkdir(dirname(statePath()), { recursive: true })
  await writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
}

/**
 * Fill the empty `key=` field of a builtin MCP URL with the login key —
 * the UniClaw backend's `inject_yuanjing_key()` semantics. URLs without an
 * empty `key=` field pass through unchanged.
 */
function injectKey(url: string, key: string): string {
  if (url.includes('key=&') || url.endsWith('key=')) return url.replace('key=', `key=${key}`)
  return url
}

// ── Mount manager ──

/** A mounted cordis fiber (the subset this module drives). */
interface McpFiber { dispose: () => Promise<void> }

interface MountState {
  fiber: McpFiber
  /** Signature of the mounted config; any drift (key rotation, edit) remounts. */
  sig: string
}

const mounts = new Map<string, MountState>()
let currentKey = ''
/** Serializes syncs so login, my-plan refresh, and edits never interleave. */
let syncChain: Promise<void> = Promise.resolve()

let mcpClientModule: Promise<Record<string, unknown>> | undefined

/** Import the stock mcp-client bridge from its workspace source, once. */
function loadMcpClient(): Promise<Record<string, unknown>> {
  mcpClientModule ??= import(new URL('../../packages/mcp/mcp-client/src/index.ts', import.meta.url).href)
  return mcpClientModule
}

/** One reconcilable server: its identity plus the exact mcp-client config to mount. */
interface DesiredMount {
  id: string
  serverName: string
  config: Record<string, unknown> | undefined
}

function builtinDesired(def: BuiltinMcpDef, state: McpState, appToken: string): DesiredMount {
  const enabled = state.overrides[def.id] ?? def.defaultEnabled
  const want = enabled && (!def.needsKey || appToken !== '')
  const config = !want ? undefined
    : def.transport === 'streamable-http'
      ? { transport: 'streamable-http', serverName: def.serverName, url: injectKey(def.url ?? '', def.needsKey ? appToken : '') }
      : { transport: 'stdio', serverName: def.serverName, command: def.command ?? '', args: def.args ?? [] }
  return { id: def.id, serverName: def.serverName, config }
}

function customDesired(entry: CustomMcpEntry): DesiredMount {
  const valid = SERVER_NAME.test(entry.serverName)
    && (entry.transport === 'streamable-http' ? entry.url.trim() !== '' : entry.command.trim() !== '')
  const config = !entry.enabled || !valid ? undefined
    : entry.transport === 'streamable-http'
      ? { transport: 'streamable-http', serverName: entry.serverName, url: entry.url.trim(), headers: entry.headers }
      : {
          transport: 'stdio',
          serverName: entry.serverName,
          command: entry.command.trim(),
          args: entry.args.split(/\s+/).filter(Boolean),
          env: entry.env,
        }
  return { id: entry.id, serverName: entry.serverName, config }
}

/**
 * Queue an MCP reconciliation for the given login key. Mount states converge
 * to the enabled server set; a changed key or edited config remounts only the
 * affected server, and deleted servers unmount. Errors are logged, never
 * thrown to callers.
 * @param ctx - plugin context used to mount mcp-client instances.
 * @param appToken - current login app token; empty when logged out.
 */
export function requestMcpSync(ctx: Context, appToken: string): void {
  syncChain = syncChain
    .then(() => syncOnce(ctx, appToken))
    .catch((error) => { console.warn('[uniclaw-shell] MCP sync failed:', error) })
}

/** Settles when every queued reconciliation has finished (mounts awaited). */
export function mcpSyncSettled(): Promise<void> {
  return syncChain
}

async function syncOnce(ctx: Context, appToken: string): Promise<void> {
  currentKey = appToken
  const state = await readState()
  const desired = [
    ...BUILTIN_MCPS.map(def => builtinDesired(def, state, appToken)),
    ...state.custom.map(customDesired),
  ]

  const liveIds = new Set(desired.map(d => d.id))
  for (const [id, mounted] of [...mounts]) {
    if (!liveIds.has(id)) {
      mounts.delete(id)
      await mounted.fiber.dispose() // entry deleted since the last sync
    }
  }

  for (const item of desired) {
    const mounted = mounts.get(item.id)
    if (item.config === undefined) {
      if (mounted !== undefined) {
        mounts.delete(item.id)
        await mounted.fiber.dispose()
        console.log(`[uniclaw-shell] MCP unmounted: ${item.serverName}`)
      }
      continue
    }
    const sig = JSON.stringify(item.config)
    if (mounted !== undefined && mounted.sig === sig) continue
    if (mounted !== undefined) {
      mounts.delete(item.id)
      await mounted.fiber.dispose() // config drift — remount with the new one
    }
    await mountOne(ctx, item, sig)
  }
}

async function mountOne(ctx: Context, item: DesiredMount, sig: string): Promise<void> {
  try {
    const module = await loadMcpClient()
    const fiber = ctx.plugin(module, item.config) as unknown as McpFiber & PromiseLike<unknown>
    mounts.set(item.id, { fiber, sig })
    await fiber
    console.log(`[uniclaw-shell] MCP mounted: ${item.serverName}`)
  } catch (error) {
    // Startup failures keep the fiber mounted (the bridge activates without
    // tools and reconnects); only a rejected mount itself is rolled back.
    const mounted = mounts.get(item.id)
    if (mounted !== undefined) {
      mounts.delete(item.id)
      await mounted.fiber.dispose().catch(() => { /* already torn down with the failed mount */ })
    }
    console.warn(`[uniclaw-shell] MCP mount failed: ${item.serverName}:`, error)
  }
}

// ── Routes ──

const API_PREFIX = '/api/uniclaw/mcp'

/** Register the MCP status/toggle/save/delete routes; mounting starts via requestMcpSync. */
export function registerMcpModule(ctx: Context): void {
  mounts.clear() // an HMR re-apply must not reuse fibers of the disposed generation

  ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sub = url.pathname.slice(API_PREFIX.length) || '/'
      try {
        await dispatch(ctx, `${req.method ?? 'GET'} ${sub}`, req, res)
      } catch (error) {
        console.error('[uniclaw-shell] mcp route failed:', error)
        sendJson(res, 500, { detail: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

async function dispatch(ctx: Context, route: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  switch (route) {
    case 'GET /': {
      const state = await readState()
      const servers = [
        ...BUILTIN_MCPS.map(def => ({
          id: def.id,
          name: def.serverName,
          transport: def.transport,
          note: def.note,
          builtin: true,
          enabled: state.overrides[def.id] ?? def.defaultEnabled,
          mounted: mounts.has(def.id),
          requiresLogin: def.needsKey && currentKey === '',
        })),
        ...state.custom.map(entry => ({
          id: entry.id,
          name: entry.serverName,
          transport: entry.transport,
          note: entry.transport === 'streamable-http' ? entry.url : `${entry.command} ${entry.args}`.trim(),
          builtin: false,
          enabled: entry.enabled,
          mounted: mounts.has(entry.id),
          requiresLogin: false,
          url: entry.url,
          headers: entry.headers,
          command: entry.command,
          args: entry.args,
          env: entry.env,
        })),
      ]
      return sendJson(res, 200, { servers })
    }
    case 'POST /toggle': {
      const body = await readJson(req)
      const id = typeof body.id === 'string' ? body.id : ''
      const enabled = body.enabled === true
      const state = await readState()
      if (BUILTIN_MCPS.some(def => def.id === id)) {
        state.overrides[id] = enabled
      } else {
        const entry = state.custom.find(e => e.id === id)
        if (entry === undefined) return sendJson(res, 404, { detail: `unknown MCP server: ${id}` })
        entry.enabled = enabled
      }
      await writeState(state)
      requestMcpSync(ctx, currentKey)
      return sendJson(res, 200, { id, enabled })
    }
    case 'POST /save': {
      const body = await readJson(req)
      const entry = normalizeCustomEntry(body)
      if (typeof entry === 'string') return sendJson(res, 400, { detail: entry })
      const state = await readState()
      const takenNames = new Set([
        ...BUILTIN_MCPS.map(d => d.serverName),
        ...state.custom.filter(e => e.id !== entry.id).map(e => e.serverName),
      ])
      if (takenNames.has(entry.serverName)) {
        return sendJson(res, 409, { detail: `名称「${entry.serverName}」已被占用` })
      }
      const index = state.custom.findIndex(e => e.id === entry.id)
      if (index >= 0) state.custom[index] = entry
      else state.custom.push(entry)
      await writeState(state)
      requestMcpSync(ctx, currentKey)
      return sendJson(res, 200, { id: entry.id })
    }
    case 'POST /delete': {
      const body = await readJson(req)
      const id = typeof body.id === 'string' ? body.id : ''
      if (BUILTIN_MCPS.some(def => def.id === id)) {
        return sendJson(res, 400, { detail: '内置 MCP 不可删除，可以停用' })
      }
      const state = await readState()
      const index = state.custom.findIndex(e => e.id === id)
      if (index < 0) return sendJson(res, 404, { detail: `unknown MCP server: ${id}` })
      state.custom.splice(index, 1)
      await writeState(state)
      requestMcpSync(ctx, currentKey)
      return sendJson(res, 200, { id })
    }
    default:
      return sendJson(res, 404, { detail: `unknown mcp endpoint: ${route}` })
  }
}

/** Validate a save payload into a persistable custom entry, or return an error string. */
function normalizeCustomEntry(body: Record<string, unknown>): CustomMcpEntry | string {
  const serverName = typeof body.name === 'string' ? body.name.trim() : ''
  if (!SERVER_NAME.test(serverName)) return '名称须为 1-32 位字母/数字/下划线/连字符'
  const transport = body.transport === 'stdio' ? 'stdio' : 'streamable-http'
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const command = typeof body.command === 'string' ? body.command.trim() : ''
  if (transport === 'streamable-http') {
    if (!/^https?:\/\//.test(url)) return '地址须为 http(s) URL'
  } else if (command === '') {
    return 'Stdio 类型须填写命令'
  }
  return {
    id: typeof body.id === 'string' && body.id !== '' ? body.id : randomUUID(),
    serverName,
    transport,
    url,
    headers: stringDict(body.headers),
    command,
    args: typeof body.args === 'string' ? body.args.trim() : '',
    env: stringDict(body.env),
    enabled: body.enabled !== false,
  }
}

function stringDict(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((kv): kv is [string, string] => typeof kv[1] === 'string' && kv[0] !== ''),
  )
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
