/**
 * Typed reads and writes over the uniclaw-shell host plugin's HTTP routes.
 *
 * The settings pages and the plugin that serves `/api/uniclaw/*` are two
 * halves of one feature on one origin, so these go over plain `fetch` rather
 * than the RPC gateway: the routes proxy the UniClaw gateway and own their own
 * on-disk state, and nothing here needs a session or the wire event stream.
 */

/** One MCP server row as `/api/uniclaw/mcp` reports it. */
export interface McpServerView {
  id: string
  name: string
  transport: 'streamable-http' | 'stdio'
  /** One-line hint: the builtin's blurb, or the custom entry's URL/command. */
  note: string
  /** Builtin servers ship with the plugin: switchable, never removable. */
  builtin: boolean
  enabled: boolean
  /** Whether a bridge fiber is live for this server right now. */
  mounted: boolean
  /** Enabled but holding for a login token (the UniAI toolkit's key). */
  requiresLogin: boolean
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string
  env?: Record<string, string>
}

/** The editable fields of one custom MCP server. */
export interface McpDraft {
  id: string
  name: string
  transport: 'streamable-http' | 'stdio'
  url: string
  headers: Record<string, string>
  command: string
  args: string
  env: Record<string, string>
}

/** One installed skill as `/api/uniclaw/skills/installed` reports it. */
export interface InstalledSkillView {
  /** Frontmatter skill name — the identity the harness catalog shows. */
  name: string
  /** On-disk directory name; the handle toggle and delete take. */
  dir: string
  description: string
  enabled: boolean
  /** Install provenance (`local`, `market`, `recommended`, `bundled`). */
  source: string
  mtimeMs: number
  /** Install record: the catalog `id` it came from and its original name. */
  meta?: { id?: string; displayName?: string }
  /** Shipped with the plugin: switchable but not removable. */
  builtin?: boolean
}

/**
 * One catalog row. Both catalogs are gateway passthroughs whose rows carry
 * whichever id/category spelling that service uses, so every field is read
 * defensively and normalized by {@link catalogRow}.
 */
export interface CatalogSkillView {
  id: string
  name: string
  description: string
  provider: string
  categoryId: string
}

/** One category chip. */
export interface CatalogCategory {
  id: string
  name: string
}

/** A route rejected the request; `message` is already user-facing Chinese. */
export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(detailOf(body, res.status))
  return body as T
}

/** Render a route's error envelope as display text. */
function detailOf(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (typeof detail === 'object' && detail !== null) {
    const conflict = detail as { code?: unknown; name?: unknown }
    if (conflict.code === 'skill_conflict') return `已存在同名技能「${String(conflict.name)}」，请先卸载后重试`
  }
  return `请求失败: HTTP ${status}`
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** Read every MCP server, builtin and custom. */
export const listMcp = (): Promise<{ servers: McpServerView[] }> =>
  call('/api/uniclaw/mcp')

/** Switch one server on or off and reconcile its mount. */
export const toggleMcp = (id: string, enabled: boolean): Promise<unknown> =>
  call('/api/uniclaw/mcp/toggle', json({ id, enabled }))

/** Create or update one custom server; an empty `id` creates. */
export const saveMcp = (draft: McpDraft): Promise<{ id: string }> =>
  call('/api/uniclaw/mcp/save', json(draft))

/** Remove one custom server and unmount it. */
export const deleteMcp = (id: string): Promise<unknown> =>
  call('/api/uniclaw/mcp/delete', json({ id }))

/** Read installed skills, bundled ones included. */
export const listInstalled = (): Promise<{ skills: InstalledSkillView[] }> =>
  call('/api/uniclaw/skills/installed')

/**
 * Unwrap a gateway list payload. These routes pass the UniClaw services
 * through untouched, and the two services disagree on the wrapper key, so a
 * bare array and each known wrapper all read as the same list.
 */
function listOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (typeof payload === 'object' && payload !== null) {
    for (const key of ['list', 'records', 'items']) {
      const inner = (payload as Record<string, unknown>)[key]
      if (Array.isArray(inner)) return inner as Record<string, unknown>[]
    }
  }
  return []
}

const text = (value: unknown): string => typeof value === 'string' ? value : (typeof value === 'number' ? String(value) : '')

/** Normalize one gateway catalog row into the fields the cards render. */
function catalogRow(raw: Record<string, unknown>): CatalogSkillView {
  const id = text(raw.id) || text(raw.name)
  return {
    id,
    name: text(raw.name) || id,
    description: text(raw.description),
    provider: text(raw.provider) || text(raw.author),
    categoryId: text(raw.category_id) || text(raw.category),
  }
}

/** Normalize one gateway category row. */
function categoryRow(raw: Record<string, unknown>): CatalogCategory {
  const id = text(raw.id) || text(raw.name)
  return { id, name: text(raw.name) || id }
}

/** Read the UniClaw recommended-skills catalog with its category chips. */
export async function listRecommended(): Promise<{ items: CatalogSkillView[]; categories: CatalogCategory[] }> {
  const [items, categories] = await Promise.all([
    call<unknown>('/api/uniclaw/skills/recommended/list'),
    call<unknown>('/api/uniclaw/skills/recommended/categories').catch(() => []),
  ])
  return { items: listOf(items).map(catalogRow), categories: listOf(categories).map(categoryRow) }
}

/** Read the first page of the skill market with its category chips. */
export async function listMarket(): Promise<{ items: CatalogSkillView[]; categories: CatalogCategory[] }> {
  const [items, categories] = await Promise.all([
    call<unknown>('/api/uniclaw/skills/market/list?category=all&page=1&page_size=100'),
    call<unknown>('/api/uniclaw/skills/market/categories').catch(() => []),
  ])
  return { items: listOf(items).map(catalogRow), categories: listOf(categories).map(categoryRow) }
}

/** Install one catalog entry from the given source list. */
export const installSkill = (source: 'recommended' | 'market', id: string): Promise<unknown> =>
  call(`/api/uniclaw/skills/${source}/install`, json({ id }))

/** Switch one installed skill on or off, by its on-disk `dir` handle. */
export const toggleSkill = (name: string, enabled: boolean): Promise<unknown> =>
  call('/api/uniclaw/skills/toggle', json({ name, enabled }))

/** Uninstall one skill by its `dir` handle; bundled skills are refused. */
export const deleteSkill = (name: string): Promise<unknown> =>
  call('/api/uniclaw/skills/delete', json({ name }))

/** Read one installed skill's SKILL.md for the viewer. */
export const readSkill = (name: string): Promise<{ content: string }> =>
  call(`/api/uniclaw/skills/content?name=${encodeURIComponent(name)}`)

/** Upload one `.zip`/`.skill` package. */
export const uploadSkill = (file: File): Promise<unknown> =>
  call(`/api/uniclaw/skills/upload?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    body: file,
  })

// ── Login ──

/** Whether a stored login exists, and what plan it carries. */
export interface UniClawStatus {
  loggedIn: boolean
  /** A usable `sk-` key is stored; without one every model request 401s. */
  appTokenConfigured: boolean
  plan: { productName?: string } | null
}

/** One captcha challenge: the image to show and the id to send back with it. */
export interface Captcha {
  captchaId: string
  /** `data:` URI of the challenge image. */
  b64s: string
}

/** The gateway's envelope; `code === 0` means success. */
interface GatewayEnvelope<T> {
  code?: number
  msg?: string
  data?: T
}

/** A gateway call that answered with a non-zero code. */
export class GatewayError extends Error {}

/** Unwrap a gateway envelope, raising {@link GatewayError} on a non-zero code. */
function unwrap<T>(payload: GatewayEnvelope<T>, fallback: string): T {
  if (payload.code !== 0) throw new GatewayError(payload.msg ?? fallback)
  return payload.data as T
}

/** Read the stored login state. */
export const readStatus = (): Promise<UniClawStatus> =>
  call('/api/uniclaw/status')

/** Fetch a fresh captcha challenge. */
export async function fetchCaptcha(): Promise<Captcha> {
  const payload = await call<GatewayEnvelope<Captcha>>('/api/uniclaw/login/captcha')
  const data = payload.data
  if (data?.b64s === undefined) throw new GatewayError(payload.msg ?? '验证码加载失败')
  return data
}

/** Ask the gateway to text a login code to `phone`. */
export async function sendLoginCode(phone: string, captchaCode: string, captchaId: string): Promise<void> {
  unwrap(await call<GatewayEnvelope<unknown>>(
    '/api/uniclaw/login/sendCode', json({ phone, captchaCode, captchaId })), '发送失败')
}

/**
 * Exchange the SMS code for a session. The host stores the credentials,
 * materializes the model catalog, and mounts the key-bearing MCP servers
 * before answering.
 * @returns whether the account also carries a usable model key.
 */
export async function smsLogin(phone: string, smsCode: string): Promise<{ hasKey: boolean }> {
  const data = unwrap(await call<GatewayEnvelope<{ app_token?: string }>>(
    '/api/uniclaw/login/smsLogin', json({ phone, smsCode })), '登录失败')
  return { hasKey: typeof data.app_token === 'string' && data.app_token.startsWith('sk-') }
}
