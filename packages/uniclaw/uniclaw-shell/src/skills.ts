/**
 * uniclaw-shell 技能模块 — UniClaw「扩展-技能」在 DeepSeek Harness 上的插件实现。
 *
 * Host-side only. Registers `/api/uniclaw/skills/*` on the harness web server:
 * marketplace + recommended-catalog proxies against the YuanJing gateway, and
 * a local install pipeline (download/upload archive → validate SKILL.md →
 * write into `<dshHome>/skills/<name>`). Installed skills are discovered by
 * the stock `dsh-skill-filesystem` provider (user-dsh root, live chokidar
 * watch), enter the model-facing `<available_skills>` catalog through
 * `dsh-tool-skill`, and load in conversation via the `skill` tool — no core
 * harness change is involved.
 *
 * IMPORTANT: like index.ts, this file is mounted by absolute path via a
 * cordis.yml patch and must stay free of runtime *package* imports — node
 * builtins only, workspace packages are `import type` only.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `webServer` into Context.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SKILL_NAME, kebabOf, parseFrontmatter, rewriteFrontmatter } from './skill-md.ts'
import { bundledContent, bundledNames, listBundled, registerBundledSkills, setBundledEnabled } from './skills-bundled.ts'

// ── Gateway endpoints (env-overridable, same knobs as the UniClaw app) ──
const MARKET_BASE = (process.env.UNICLAW_SKILL_MARKET_BASE_URL ?? 'https://maas.ai-yuanjing.com/app/gateway/wanwu').replace(/\/+$/, '')
const RECOMMENDED_BASE = (process.env.UNICLAW_RECOMMENDED_SKILLS_BASE_URL ?? 'https://maas.ai-yuanjing.com/app/gateway').replace(/\/+$/, '')
const PROXY_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 300 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 5_000

const API_PREFIX = '/api/uniclaw/skills'

// ── Local roots ──
// Mirrors dsh-home-paths resolveDshHome: $DSH_HOME else ~/.dsh. The active
// root is the exact `user-dsh` root the stock filesystem skill provider
// scans and watches; the inactive sibling is outside every scanned root, so
// a disabled skill vanishes from the catalog without losing its files.
function dshHome(): string {
  const env = process.env.DSH_HOME
  return resolve(env !== undefined && env.trim().length > 0 ? env : join(homedir(), '.dsh'))
}
const skillsRoot = () => join(dshHome(), 'skills')
const inactiveRoot = () => join(dshHome(), 'skills-inactive')
/** Install provenance, keyed by installed directory name (see UniClaw market_meta.json). */
const metaPath = () => join(dshHome(), 'uniclaw-skills-meta.json')

/** Error carrying an HTTP status; `detail` follows UniClaw's FastAPI shape. */
class HttpError extends Error {
  constructor(readonly status: number, readonly detail: unknown) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
}

/** Register the bundled-skills provider, the skill API routes, and the `/uniclaw/skills` page. */
export function registerSkillModule(ctx: Context): void {
  registerBundledSkills(ctx)

  ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sub = url.pathname.slice(API_PREFIX.length) || '/'
      try {
        await dispatch(req.method ?? 'GET', sub, url.searchParams, req, res)
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { detail: error.detail })
        } else {
          console.error('[uniclaw-shell] skills route failed:', error)
          sendJson(res, 500, { detail: error instanceof Error ? error.message : String(error) })
        }
      }
    },
  })

  console.log(`[uniclaw-shell] skills module loaded (market: ${MARKET_BASE})`)
}

// ── Route dispatch ──

async function dispatch(
  method: string,
  sub: string,
  params: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const route = `${method} ${sub}`
  switch (route) {
    case 'GET /installed':
      sendJson(res, 200, await listInstalled())
      return
    case 'GET /market/categories':
      sendJson(res, 200, await gatewayGet(`${MARKET_BASE}/api/skills/categories`))
      return
    case 'GET /market/list':
      sendJson(res, 200, await gatewayGet(`${MARKET_BASE}/api/skills/list?${new URLSearchParams({
        category: params.get('category') ?? 'all',
        page: params.get('page') ?? '1',
        page_size: params.get('page_size') ?? '100',
      })}`))
      return
    case 'GET /market/detail':
      sendJson(res, 200, await gatewayGet(`${MARKET_BASE}/api/skills/detail?${new URLSearchParams({ ids: params.get('ids') ?? '' })}`))
      return
    case 'GET /recommended/categories':
      sendJson(res, 200, await gatewayGet(`${RECOMMENDED_BASE}/uniclaw/skill-categories`))
      return
    case 'GET /recommended/list':
      sendJson(res, 200, await gatewayGet(`${RECOMMENDED_BASE}/uniclaw/recommended-skills`))
      return
    case 'POST /market/install':
      sendJson(res, 200, await marketInstall(await readJson(req)))
      return
    case 'POST /recommended/install':
      sendJson(res, 200, await recommendedInstall(await readJson(req)))
      return
    case 'POST /upload':
      sendJson(res, 200, await uploadInstall(params.get('filename') ?? '', await readBody(req, MAX_PACKAGE_BYTES)))
      return
    case 'POST /toggle':
      sendJson(res, 200, await toggleSkill(await readJson(req)))
      return
    case 'POST /delete':
      sendJson(res, 200, await deleteSkill(await readJson(req)))
      return
    case 'GET /content':
      sendJson(res, 200, await skillContent(params.get('name') ?? ''))
      return
    default:
      throw new HttpError(404, `unknown skills endpoint: ${route}`)
  }
}

// ── Installed listing / toggle / delete ──

interface InstalledSkill {
  /** Frontmatter skill name (the identity the harness catalog shows). */
  name: string
  /** On-disk directory (or flat file) name — the handle toggle/delete use. */
  dir: string
  description: string
  enabled: boolean
  source: string
  mtimeMs: number
  meta?: Record<string, unknown>
  /** Shipped with the plugin: toggleable but not deletable. */
  builtin?: boolean
}

async function listInstalled(): Promise<{ skills: InstalledSkill[] }> {
  const meta = await readMeta()
  const skills: InstalledSkill[] = []
  for (const [root, enabled] of [[skillsRoot(), true], [inactiveRoot(), false]] as const) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue // root not created yet
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      let skillFile: string | undefined
      if (entry.isDirectory()) skillFile = join(root, entry.name, 'SKILL.md')
      else if (entry.isFile() && entry.name.endsWith('.md')) skillFile = join(root, entry.name)
      if (skillFile === undefined) continue
      let text: string
      try {
        text = await readFile(skillFile, 'utf8')
      } catch {
        continue // directory without SKILL.md is not a skill bundle
      }
      const fm = parseFrontmatter(text)
      const provenance = meta[entry.name]
      const mtimeMs = await stat(join(root, entry.name)).then(s => s.mtimeMs).catch(() => 0)
      skills.push({
        name: fm?.name ?? entry.name.replace(/\.md$/, ''),
        dir: entry.name,
        description: fm?.description ?? '',
        enabled,
        source: typeof provenance?.source === 'string' ? provenance.source : 'local',
        mtimeMs,
        ...(provenance ? { meta: provenance } : {}),
      })
    }
  }
  skills.sort((a, b) => b.mtimeMs - a.mtimeMs)
  // Builtin skills sit after user-managed entries, mirroring the UniClaw
  // app's public-category grouping; a same-name user skill shadows the
  // builtin in the harness catalog (rank 400 beats 600) but both rows stay
  // visible here with distinct provenance.
  for (const bundled of await listBundled()) {
    skills.push({
      name: bundled.name,
      dir: bundled.name,
      description: bundled.description,
      enabled: bundled.enabled,
      source: 'builtin',
      mtimeMs: 0,
      builtin: true,
    })
  }
  return { skills }
}

async function toggleSkill(body: Record<string, unknown>): Promise<{ name: string; enabled: boolean }> {
  const dir = requireSafeDirName(body.name)
  const enabled = body.enabled === true
  const from = join(enabled ? inactiveRoot() : skillsRoot(), dir)
  const to = join(enabled ? skillsRoot() : inactiveRoot(), dir)
  if (!await exists(from)) {
    if (await exists(to)) return { name: dir, enabled } // already in the requested state
    if (await setBundledEnabled(dir, enabled)) return { name: dir, enabled }
    throw new HttpError(404, `Skill not found: ${dir}`)
  }
  await mkdir(dirname(to), { recursive: true })
  await rename(from, to)
  return { name: dir, enabled }
}

async function deleteSkill(body: Record<string, unknown>): Promise<{ name: string }> {
  const dir = requireSafeDirName(body.name)
  let removed = false
  for (const root of [skillsRoot(), inactiveRoot()]) {
    const target = join(root, dir)
    if (await exists(target)) {
      await rm(target, { recursive: true })
      removed = true
      break
    }
  }
  if (!removed) {
    if ((await bundledNames()).has(dir)) throw new HttpError(400, '内置技能不可卸载，可以停用')
    throw new HttpError(404, `Skill not found: ${dir}`)
  }
  const meta = await readMeta()
  if (dir in meta) {
    const { [dir]: _removed, ...rest } = meta
    await writeMeta(rest)
  }
  return { name: dir }
}

async function skillContent(name: string): Promise<{ name: string; content: string }> {
  const dir = requireSafeDirName(name)
  for (const root of [skillsRoot(), inactiveRoot()]) {
    for (const candidate of [join(root, dir, 'SKILL.md'), join(root, `${dir}.md`), join(root, dir)]) {
      try {
        const content = await readFile(candidate, 'utf8')
        return { name: dir, content }
      } catch { /* try the next layout */ }
    }
  }
  const bundled = await bundledContent(dir)
  if (bundled !== undefined) return { name: dir, content: bundled }
  throw new HttpError(404, `Skill not found: ${dir}`)
}

// ── Install pipelines ──

async function marketInstall(body: Record<string, unknown>): Promise<{ name: string }> {
  const id = stringOf(body.id)
  const downloadUrl = stringOf(body.download_url)
  if (!id || !downloadUrl) throw new HttpError(400, 'missing skill id or download_url')
  if (!/^https:\/\//.test(downloadUrl)) throw new HttpError(400, 'download_url must be https')

  // Idempotent: this exact marketplace id already installed → no-op.
  const meta = await readMeta()
  for (const [dir, m] of Object.entries(meta)) {
    if (m.source === 'market' && m.id === id && await exists(join(skillsRoot(), dir))) return { name: dir }
  }

  const content = await downloadBytes(downloadUrl)
  const displayName = stringOf(body.name) || id
  const name = await installArchive(content, displayName, {
    source: 'market',
    id,
    displayName,
    provider: stringOf(body.provider),
    category: stringOf(body.category),
    icon_url: stringOf(body.icon_url),
    clawhub_url: stringOf(body.clawhub_url),
  })
  return { name }
}

async function recommendedInstall(body: Record<string, unknown>): Promise<{ name: string }> {
  const id = stringOf(body.id).trim()
  if (!id) throw new HttpError(400, 'missing skill id')

  const meta = await readMeta()
  for (const [dir, m] of Object.entries(meta)) {
    if (m.source === 'recommended' && m.id === id && await exists(join(skillsRoot(), dir))) return { name: dir }
  }

  const payload = await gatewayGet(`${RECOMMENDED_BASE}/uniclaw/recommended-skills`)
  const items = recommendedItems(payload)
  const skill = items.find(item => stringOf(item.id) === id)
  if (skill === undefined) throw new HttpError(404, 'recommended skill not found')

  // Accept only the service's own package path for this id — never an
  // arbitrary URL from catalog data (same validation as the UniClaw app).
  const downloadPath = skill.package_download_path
  if (typeof downloadPath !== 'string' || decodeURIComponent(downloadPath) !== `/uniclaw/skills/${id}/package`) {
    throw new HttpError(502, 'Invalid recommended skill package path')
  }
  const content = await downloadBytes(`${RECOMMENDED_BASE}${downloadPath}`)

  const expectedSize = skill.package_file_size
  if (typeof expectedSize === 'number' && content.length !== expectedSize) {
    throw new HttpError(502, 'Recommended package size mismatch')
  }
  const expectedSha = skill.package_sha256
  if (typeof expectedSha === 'string' && expectedSha.trim()) {
    const actual = createHash('sha256').update(content).digest('hex')
    if (actual.toLowerCase() !== expectedSha.trim().toLowerCase()) {
      throw new HttpError(502, 'Recommended package checksum mismatch')
    }
  }

  const fileName = stringOf(skill.package_file_name) || stringOf(skill.name) || id
  const fallback = fileName.replace(/\.[^.]+$/, '')
  const name = await installArchive(content, fallback, {
    source: 'recommended',
    id,
    displayName: stringOf(skill.name) || fallback,
    provider: stringOf(skill.provider),
    category: stringOf(skill.category),
    clawhub_url: stringOf(skill.clawhub_url),
    description: stringOf(skill.description),
  })
  return { name }
}

async function uploadInstall(filename: string, content: Buffer): Promise<{ name: string }> {
  if (!/\.(zip|skill)$/i.test(filename)) {
    throw new HttpError(400, 'Only .zip and .skill files are accepted.')
  }
  if (content.length === 0) throw new HttpError(400, 'empty upload')
  const fallback = filename.replace(/\.[^.]+$/, '')
  const name = await installArchive(content, fallback, { source: 'upload', displayName: fallback })
  return { name }
}

/**
 * Extract a skill archive and install it under the active skills root.
 * Validates SKILL.md, normalizes the skill name to the harness kebab-case
 * grammar (rewriting frontmatter when needed so the stock provider accepts
 * the skill), rejects name conflicts, then records provenance.
 * @param content - raw archive bytes (.zip/.skill).
 * @param fallbackName - name used when frontmatter has no usable name.
 * @param provenance - install-source metadata persisted for the UI.
 * @returns the canonical installed directory/skill name.
 */
async function installArchive(
  content: Buffer,
  fallbackName: string,
  provenance: Record<string, unknown>,
): Promise<string> {
  const entries = stripCommonRoot(extractZip(content))
  const skillEntry = entries.find(e => e.path === 'SKILL.md')
    ?? entries.find(e => e.path.toUpperCase() === 'SKILL.MD')
  if (skillEntry === undefined) {
    throw new HttpError(400, 'Archive must contain a SKILL.md file at the skill root.')
  }

  let text = skillEntry.data.toString('utf8')
  const fm = parseFrontmatter(text)
  if (fm === undefined) throw new HttpError(400, 'Invalid SKILL.md: missing YAML frontmatter')

  // The harness provider only catalogs kebab-case frontmatter names; a
  // marketplace skill with a non-conforming name would install invisibly.
  // Normalize the name (and backfill a description) in the written copy.
  const rawName = fm.name ?? ''
  const name = SKILL_NAME.test(rawName) ? rawName
    : kebabOf(rawName) || kebabOf(fallbackName) || `skill-${createHash('sha256').update(content).digest('hex').slice(0, 8)}`
  const description = fm.description ?? (stringOf(provenance.description) || stringOf(provenance.displayName) || name)
  if (name !== rawName || fm.description === undefined) {
    text = rewriteFrontmatter(text, name, description)
  }

  // Conflicts against every category, builtins included (UniClaw parity —
  // a same-name install would otherwise silently shadow the builtin).
  for (const root of [skillsRoot(), inactiveRoot()]) {
    if (await exists(join(root, name))) {
      throw new HttpError(409, { code: 'skill_conflict', name, existing_name: name })
    }
  }
  if ((await bundledNames()).has(name)) {
    throw new HttpError(409, { code: 'skill_conflict', name, existing_name: name, category: 'builtin' })
  }

  const dest = join(skillsRoot(), name)
  // Write resource files first and SKILL.md last: the provider's watcher
  // treats <name>/SKILL.md as the catalog trigger, so the bundle is complete
  // by the time the skill becomes discoverable.
  for (const entry of entries) {
    if (entry === skillEntry) continue
    const target = safeJoin(dest, entry.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entry.data)
  }
  const skillTarget = safeJoin(dest, 'SKILL.md')
  await mkdir(dirname(skillTarget), { recursive: true })
  await writeFile(skillTarget, text, 'utf8')

  const meta = await readMeta()
  meta[name] = { ...provenance, installedAt: new Date().toISOString() }
  await writeMeta(meta)
  console.log(`[uniclaw-shell] skill installed: ${name} (source: ${String(provenance.source)})`)
  return name
}

// ── Minimal zip extraction (stored + deflate; no zip64) ──
// The plugin cannot import an unzip dependency (absolute-path mount, no
// node_modules resolution domain), so this is a self-contained central-
// directory reader over node:zlib. Marketplace/recommended packages are
// plain zips well under the zip64 thresholds.

interface ZipEntry { path: string; data: Buffer }

function extractZip(buf: Buffer): ZipEntry[] {
  const scanFloor = Math.max(0, buf.length - 22 - 65_536)
  let eocd = -1
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new HttpError(400, 'Invalid archive file.')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffff_ffff) throw new HttpError(400, 'zip64 archives are not supported')
  if (count > MAX_ARCHIVE_ENTRIES) throw new HttpError(400, 'archive has too many entries')

  const entries: ZipEntry[] = []
  let p = cdOffset
  let total = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new HttpError(400, 'Invalid archive file.')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const rawName = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen

    if (rawName.endsWith('/')) continue // directory row
    const path = normalizeEntryPath(rawName)
    if (path === undefined) continue // junk or unsafe entry

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new HttpError(400, 'Invalid archive file.')
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    if (dataStart + compSize > buf.length) throw new HttpError(400, 'Invalid archive file.')
    const comp = buf.subarray(dataStart, dataStart + compSize)

    let data: Buffer
    if (method === 0) data = Buffer.from(comp)
    else if (method === 8) {
      try {
        data = inflateRawSync(comp, { maxOutputLength: MAX_UNCOMPRESSED_BYTES })
      } catch {
        throw new HttpError(400, 'Invalid archive file.')
      }
    } else throw new HttpError(400, `unsupported zip compression method ${method}`)
    if (data.length !== uncompSize) throw new HttpError(400, 'Invalid archive file.')

    total += data.length
    if (total > MAX_UNCOMPRESSED_BYTES) throw new HttpError(400, 'archive too large when extracted')
    entries.push({ path, data })
  }
  if (entries.length === 0) throw new HttpError(400, 'Invalid archive file.')
  return entries
}

/** Normalize one archive entry path; undefined drops unsafe or junk entries. */
function normalizeEntryPath(raw: string): string | undefined {
  const unified = raw.replaceAll('\\', '/')
  const segments = unified.split('/').filter(s => s !== '' && s !== '.')
  if (segments.length === 0) return undefined
  if (segments.some(s => s === '..')) return undefined
  if (/^[a-zA-Z]:/.test(segments[0] ?? '')) return undefined
  if (segments[0] === '__MACOSX') return undefined
  if (segments.at(-1) === '.DS_Store') return undefined
  return segments.join('/')
}

/** When every entry lives under one top-level directory, strip that prefix. */
function stripCommonRoot(entries: ZipEntry[]): ZipEntry[] {
  const tops = new Set(entries.map(e => e.path.split('/')[0] ?? ''))
  const [top] = [...tops]
  if (tops.size !== 1 || top === undefined) return entries
  if (!entries.every(e => e.path.includes('/'))) return entries // top is itself a file
  return entries.map(e => ({ path: e.path.slice(top.length + 1), data: e.data }))
    .filter(e => e.path !== '')
}

/**
 * Join an archive path below its destination directory.
 * @param dest - Absolute destination directory.
 * @param relPath - Archive entry path relative to the destination.
 * @returns The platform-native target path.
 * @throws When the entry escapes the destination directory.
 */
export function safeJoin(dest: string, relPath: string): string {
  const target = join(dest, relPath)
  const fromDest = relative(dest, target)
  if (fromDest === '..' || fromDest.startsWith(`..${sep}`) || isAbsolute(fromDest)) {
    throw new HttpError(400, 'Invalid archive file.')
  }
  return target
}

// ── Provenance manifest ──

async function readMeta(): Promise<Record<string, Record<string, unknown>>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(metaPath(), 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, Record<string, unknown>>
    }
  } catch { /* absent or corrupt manifest reads as empty */ }
  return {}
}

async function writeMeta(meta: Record<string, Record<string, unknown>>): Promise<void> {
  await mkdir(dshHome(), { recursive: true })
  await writeFile(metaPath(), JSON.stringify(meta, null, 2), 'utf8')
}

// ── Gateway proxy helpers ──

/** GET a gateway endpoint and unwrap its `{code,msg,data}` envelope. */
async function gatewayGet(url: string): Promise<unknown> {
  let payload: unknown
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) })
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`)
    payload = await upstream.json()
  } catch (error) {
    throw new HttpError(502, `Skill service unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const envelope = payload as { code?: unknown; msg?: unknown; data?: unknown }
    if ('code' in envelope || ('msg' in envelope && 'data' in envelope)) {
      if (envelope.code !== 0 && envelope.code !== null && envelope.code !== undefined) {
        throw new HttpError(502, stringOf(envelope.msg) || 'skill service error')
      }
      return envelope.data
    }
  }
  return payload
}

async function downloadBytes(url: string): Promise<Buffer> {
  let body: ArrayBuffer
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`)
    body = await upstream.arrayBuffer()
  } catch (error) {
    throw new HttpError(502, `Failed to download skill: ${error instanceof Error ? error.message : String(error)}`)
  }
  const content = Buffer.from(body)
  if (content.length === 0 || content.length > MAX_PACKAGE_BYTES) {
    throw new HttpError(502, 'Invalid package size')
  }
  return content
}

function recommendedItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (isRecord(payload)) {
    for (const key of ['list', 'records', 'items']) {
      const items = payload[key]
      if (Array.isArray(items)) return items.filter(isRecord)
    }
  }
  return []
}

// ── Small helpers ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A directory handle from the client must be one plain path segment. */
function requireSafeDirName(value: unknown): string {
  const name = stringOf(value).trim()
  if (!name || name.startsWith('.') || /[\\/]/.test(name) || name.includes('..')) {
    throw new HttpError(400, `invalid skill name: ${name}`)
  }
  return name
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

async function readBody(req: IncomingMessage, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > cap) throw new HttpError(413, 'request body too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, 1_048_576)
  if (raw.length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new HttpError(400, 'request body must be JSON')
  }
  if (!isRecord(parsed)) throw new HttpError(400, 'request body must be a JSON object')
  return parsed
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
