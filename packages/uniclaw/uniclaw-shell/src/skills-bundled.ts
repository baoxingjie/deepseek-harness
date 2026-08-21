/**
 * uniclaw-shell 内置技能 — UniClaw app 打包内置的 public skills，随插件分发。
 *
 * The skill bundles live in `uniclaw-shell/skills/` (copied from the UniClaw
 * app's `backend/skills/public`). A `SkillProvider` registered on
 * `ctx.skills` serves them at the bundled rank (600), the same slot the
 * stock `dsh-skill-badge` provider uses, so project/user skills shadow a
 * same-name builtin. Disabling persists a name set in `<dshHome>` and hides
 * the skill from `list()`; the provider control's `invalidate()` makes the
 * change live without a restart.
 *
 * Like the rest of the plugin: node builtins only, workspace packages are
 * `import type` only (mounted by absolute path, outside node_modules).
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'
import { SKILL_NAME, parseFrontmatter, stripFrontmatter } from './skill-md.ts'

const PROVIDER_NAME = 'uniclaw-bundled'
/** Bundled precedence slot (dsh-skill BUNDLED_SKILL_RANK; runtime import is unavailable here). */
const BUNDLED_RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/** Package directory holding the shipped skill bundles and the version stamp. */
const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

/** Root of the skill bundles as shipped inside the plugin directory. */
export const SHIPPED_DIR = join(PACKAGE_DIR, 'skills')

/** Resolved `<dshHome>`, honouring the DSH_HOME override. */
function dshHome(): string {
  const env = process.env.DSH_HOME
  return resolve(env !== undefined && env.trim().length > 0 ? env : join(homedir(), '.dsh'))
}

/** Persisted names of disabled builtin skills. */
function disabledPath(): string {
  return join(dshHome(), 'uniclaw-builtin-disabled.json')
}

/**
 * Whether a path traverses an ASAR archive. Electron patches `fs` so the
 * harness process reads such a path transparently, but the shell, python, and
 * node subprocesses a skill's own scripts run in get the unpatched syscalls
 * and see the archive as a plain file. A skill whose SKILL.md invokes
 * `scripts/*.py` is therefore unusable while its files stay inside one.
 */
function insideArchive(path: string): boolean {
  return path.split(sep).some(segment => segment.endsWith('.asar'))
}

/** Parent of the per-version materialization targets. */
function materializeRoot(): string {
  return join(dshHome(), 'uniclaw-builtin-skills')
}

/** Shipped package version; unreadable metadata falls back to a fixed name. */
async function bundleVersion(): Promise<string> {
  try {
    const meta: unknown = JSON.parse(await readFile(join(PACKAGE_DIR, 'package.json'), 'utf8'))
    const version = (meta as { version?: unknown }).version
    if (typeof version === 'string' && version.length > 0) return version
  } catch { /* absent or corrupt package metadata falls through to the fixed name */ }
  return 'unversioned'
}

/** Accumulate `relative-path:size` for every shipped file, depth-first in directory order. */
async function digestTree(root: string, prefix: string, hash: ReturnType<typeof createHash>): Promise<void> {
  for (const dirent of (await readdir(join(root, prefix), { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`
    if (dirent.isDirectory()) await digestTree(root, relative, hash)
    else if (dirent.isFile()) hash.update(`${relative}:${String((await stat(join(root, relative))).size)}\n`)
  }
}

/**
 * Name of the materialized copy: the shipped version plus a digest over every
 * shipped file's path and size. Keying on content rather than version alone
 * means a reinstall that changes the payload always replaces the copy, including
 * the release-candidate rebuilds that reuse one version number.
 * @returns the directory name for the current payload.
 */
async function bundleStamp(): Promise<string> {
  const hash = createHash('sha256')
  await digestTree(SHIPPED_DIR, '', hash)
  return `${await bundleVersion()}-${hash.digest('hex').slice(0, 12)}`
}

/** Recursive copy through `readdir`/`readFile`/`writeFile`, the calls Electron's ASAR shim covers. */
async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true })
  for (const dirent of await readdir(from, { withFileTypes: true })) {
    const source = join(from, dirent.name)
    const target = join(to, dirent.name)
    if (dirent.isDirectory()) await copyTree(source, target)
    else if (dirent.isFile()) await writeFile(target, await readFile(source))
  }
}

/**
 * Resolve the directory the provider serves skills from, materializing the
 * shipped bundles under `<dshHome>` when they ship inside an ASAR archive.
 * The copy lands in a temporary sibling and is renamed into place, so an
 * interrupted run leaves no directory that a later run would mistake for
 * complete; copies under every other stamp are removed once the current one
 * exists, so an upgrade or reinstall replaces rather than accumulates.
 * @returns the absolute serving root.
 */
async function resolveServingDir(): Promise<string> {
  if (!insideArchive(SHIPPED_DIR)) return SHIPPED_DIR
  const root = materializeRoot()
  const stamp = await bundleStamp()
  const target = join(root, stamp)
  try {
    await readdir(target)
  } catch {
    const staging = `${target}.incoming-${String(process.pid)}`
    await rm(staging, { recursive: true, force: true })
    console.log(`[uniclaw-shell] materializing bundled skills into ${target} (shipped inside an archive)`)
    await copyTree(SHIPPED_DIR, staging)
    await rename(staging, target).catch(async (error: unknown) => {
      // A concurrent harness process won the rename; its copy is equivalent.
      await rm(staging, { recursive: true, force: true })
      await readdir(target).catch(() => { throw error })
    })
  }
  for (const stale of await readdir(root).catch(() => [])) {
    if (stale !== stamp) await rm(join(root, stale), { recursive: true, force: true })
  }
  return target
}

let servingDir: Promise<string> | undefined

/**
 * Serving root for the bundled skills, resolved once per process.
 * @returns the absolute directory the provider reads skill bundles from.
 */
export async function bundledDir(): Promise<string> {
  servingDir ??= resolveServingDir()
  return servingDir
}

/** Set by the provider registration; live-refreshes consumer catalogs on toggle. */
let invalidateCatalog: (() => void) | undefined

interface BundledEntry {
  name: string
  description: string
  directory: string
  skillFile: string
}

let scanned: BundledEntry[] | undefined

/** Scan the serving root once; both it and the plugin directory are immutable at runtime. */
async function scanBundled(): Promise<BundledEntry[]> {
  if (scanned !== undefined) return scanned
  const root = await bundledDir()
  const entries: BundledEntry[] = []
  let dirents
  try {
    dirents = await readdir(root, { withFileTypes: true })
  } catch {
    scanned = []
    return scanned // plugin shipped without a skills payload
  }
  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
    const directory = join(root, dirent.name)
    const skillFile = join(directory, 'SKILL.md')
    let fm
    try {
      fm = parseFrontmatter(await readFile(skillFile, 'utf8'))
    } catch {
      continue // no SKILL.md — not a skill bundle
    }
    const name = fm?.name ?? ''
    if (!SKILL_NAME.test(name) || !fm?.description) {
      console.warn(`[uniclaw-shell] bundled skill ${dirent.name} ignored: frontmatter needs a kebab-case name and a description`)
      continue
    }
    entries.push({ name, description: fm.description, directory, skillFile })
  }
  scanned = entries
  return entries
}

/**
 * Read the persisted names of disabled builtin skills.
 * @returns the disabled names; an absent or corrupt list reads as all-enabled.
 */
export async function readDisabledSet(): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(disabledPath(), 'utf8'))
    if (Array.isArray(parsed)) return new Set(parsed.filter(v => typeof v === 'string'))
  } catch { /* absent or corrupt list reads as all-enabled */ }
  return new Set()
}

async function writeDisabledSet(disabled: Set<string>): Promise<void> {
  await mkdir(dirname(disabledPath()), { recursive: true })
  await writeFile(disabledPath(), JSON.stringify([...disabled].sort(), null, 2), 'utf8')
}

/**
 * Register the bundled-skills provider on `ctx.skills`.
 * @param ctx - plugin context carrying the skill registry.
 */
export function registerBundledSkills(ctx: Context): void {
  const provider: SkillProvider = {
    name: PROVIDER_NAME,
    list: async (): Promise<SkillCandidate[]> => {
      const [entries, disabled] = await Promise.all([scanBundled(), readDisabledSet()])
      return entries
        .filter(e => !disabled.has(e.name))
        .map(e => ({
          name: e.name,
          description: e.description,
          invocation: INVOCATION,
          provider: PROVIDER_NAME,
          source: 'bundled',
          resourceBase: { kind: 'directory', path: e.directory },
          rank: BUNDLED_RANK,
          locator: e,
          path: e.skillFile,
        }))
    },
    get: async (candidate): Promise<SkillDefinition | undefined> => {
      const entry = candidate.locator as BundledEntry
      let text: string
      try {
        text = await readFile(entry.skillFile, 'utf8')
      } catch {
        return undefined
      }
      return {
        name: entry.name,
        description: entry.description,
        invocation: INVOCATION,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: entry.directory },
        path: entry.skillFile,
        content: stripFrontmatter(text),
      }
    },
  }
  ctx.skills.registerProvider((control) => {
    invalidateCatalog = control.invalidate
    control.signal.addEventListener('abort', () => { invalidateCatalog = undefined }, { once: true })
    return provider
  })
  void Promise.all([scanBundled(), readDisabledSet(), bundledDir()]).then(([entries, disabled, root]) => {
    const enabled = entries.filter(e => !disabled.has(e.name)).length
    // Says what is on disk, not what a model can see: candidates still have to
    // survive the registry's name/rank merge. GET /api/uniclaw/diagnostics/skills
    // reports the merged catalog.
    console.log(
      `[uniclaw-shell] bundled skills provider registered — ${enabled}/${entries.length} bundle(s) offered`
      + ` from ${root}; merged catalog: GET /api/uniclaw/diagnostics/skills`,
    )
  })
}

// ── Accessors for the skills management routes (skills.ts) ──

/** One shipped builtin skill with its persisted enabled state. */
export interface BundledSkill {
  name: string
  description: string
  enabled: boolean
}

/**
 * List shipped builtin skills with their persisted enabled state.
 * @returns one entry per shipped bundle, in directory order.
 */
export async function listBundled(): Promise<BundledSkill[]> {
  const [entries, disabled] = await Promise.all([scanBundled(), readDisabledSet()])
  return entries.map(e => ({ name: e.name, description: e.description, enabled: !disabled.has(e.name) }))
}

/**
 * Names of every shipped builtin skill, for install conflict checks.
 * @returns the shipped skill names, including disabled ones.
 */
export async function bundledNames(): Promise<Set<string>> {
  return new Set((await scanBundled()).map(e => e.name))
}

/**
 * Persist one builtin skill's enabled state and refresh live catalogs.
 * @param name - the shipped builtin skill's name.
 * @param enabled - whether the skill should be offered to consumers.
 * @returns false when the name is not a shipped builtin skill.
 */
export async function setBundledEnabled(name: string, enabled: boolean): Promise<boolean> {
  const entries = await scanBundled()
  if (!entries.some(e => e.name === name)) return false
  const disabled = await readDisabledSet()
  if (enabled) disabled.delete(name)
  else disabled.add(name)
  await writeDisabledSet(disabled)
  invalidateCatalog?.()
  return true
}

/**
 * Read one builtin skill's SKILL.md verbatim, frontmatter included.
 * @param name - the shipped builtin skill's name.
 * @returns the raw text, or undefined when the skill is not shipped or unreadable.
 */
export async function bundledContent(name: string): Promise<string | undefined> {
  const entry = (await scanBundled()).find(e => e.name === name)
  if (entry === undefined) return undefined
  try {
    return await readFile(entry.skillFile, 'utf8')
  } catch {
    return undefined
  }
}
