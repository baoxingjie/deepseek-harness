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
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'
import { SKILL_NAME, parseFrontmatter, stripFrontmatter } from './skill-md.ts'

const PROVIDER_NAME = 'uniclaw-bundled'
/** Bundled precedence slot (dsh-skill BUNDLED_SKILL_RANK; runtime import is unavailable here). */
const BUNDLED_RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/** Root of the skill bundles shipped inside the plugin directory. */
const BUNDLED_DIR = join(dirname(fileURLToPath(import.meta.url)), '../skills')

/** Persisted names of disabled builtin skills. */
function disabledPath(): string {
  const env = process.env.DSH_HOME
  const home = resolve(env !== undefined && env.trim().length > 0 ? env : join(homedir(), '.dsh'))
  return join(home, 'uniclaw-builtin-disabled.json')
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

/** Scan the shipped bundles once; the plugin directory is immutable at runtime. */
async function scanBundled(): Promise<BundledEntry[]> {
  if (scanned !== undefined) return scanned
  const entries: BundledEntry[] = []
  let dirents
  try {
    dirents = await readdir(BUNDLED_DIR, { withFileTypes: true })
  } catch {
    scanned = []
    return scanned // plugin shipped without a skills payload
  }
  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
    const directory = join(BUNDLED_DIR, dirent.name)
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

/** Register the bundled-skills provider on `ctx.skills`. */
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
  void scanBundled().then(entries => {
    console.log(`[uniclaw-shell] bundled skills provider registered — ${entries.length} skill(s) shipped`)
  })
}

// ── Accessors for the skills management routes (skills.ts) ──

export interface BundledSkill {
  name: string
  description: string
  enabled: boolean
}

/** List shipped builtin skills with their persisted enabled state. */
export async function listBundled(): Promise<BundledSkill[]> {
  const [entries, disabled] = await Promise.all([scanBundled(), readDisabledSet()])
  return entries.map(e => ({ name: e.name, description: e.description, enabled: !disabled.has(e.name) }))
}

/** Names of every shipped builtin skill (for install conflict checks). */
export async function bundledNames(): Promise<Set<string>> {
  return new Set((await scanBundled()).map(e => e.name))
}

/**
 * Persist one builtin skill's enabled state and refresh live catalogs.
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

/** Raw SKILL.md text of one builtin skill, or undefined when not shipped. */
export async function bundledContent(name: string): Promise<string | undefined> {
  const entry = (await scanBundled()).find(e => e.name === name)
  if (entry === undefined) return undefined
  try {
    return await readFile(entry.skillFile, 'utf8')
  } catch {
    return undefined
  }
}
