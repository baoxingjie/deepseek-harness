/**
 * SKILL.md frontmatter helpers shared by the skill install pipeline
 * (skills.ts) and the bundled-skills provider (skills-bundled.ts).
 */

/** Harness skill-name grammar (packages/skill/skill isSkillName). */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface Frontmatter { name?: string; description?: string }

/**
 * Opening fence, body, and closing fence of a SKILL.md frontmatter block.
 * Every group is unconditional, so a successful match always fills all three;
 * the helpers below read them through {@link groupsOf}.
 */
const FRONTMATTER_BLOCK = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/

/** The three unconditional groups of a {@link FRONTMATTER_BLOCK} match. */
interface FrontmatterMatch {
  /** Whole matched block, used for slicing the body that follows it. */
  all: string
  open: string
  body: string
  close: string
}

/** Destructure a frontmatter match, or `undefined` when the text carries no block. */
function groupsOf(text: string): FrontmatterMatch | undefined {
  const match = FRONTMATTER_BLOCK.exec(text)
  if (match === null) return undefined
  const [all, open = '', body = '', close = ''] = match
  return { all, open, body, close }
}

/** Parse the `name` and `description` keys of a SKILL.md frontmatter block. */
export function parseFrontmatter(text: string): Frontmatter | undefined {
  const match = groupsOf(text)
  if (match === undefined) return undefined
  const lines = match.body.split(/\r?\n/)
  const result: Frontmatter = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(name|description):\s*(.*)$/.exec(lines[i] ?? '')
    if (kv === null) continue
    const key = kv[1] as 'name' | 'description'
    let value = (kv[2] ?? '').trim()
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      // Block scalar: join the following indented lines for display purposes.
      const block: string[] = []
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j] ?? ''); j++) {
        block.push((lines[j] ?? '').trim())
      }
      value = block.join(' ')
    }
    value = value.replace(/^["']|["']$/g, '')
    if (result[key] === undefined) result[key] = value
  }
  return result
}

/** Rewrite (or insert) the frontmatter `name`, backfilling `description`. */
export function rewriteFrontmatter(text: string, name: string, description: string): string {
  const match = groupsOf(text)
  if (match === undefined) return text
  let block = match.body
  const quote = (v: string): string => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  block = /^name:.*$/m.test(block)
    ? block.replace(/^name:.*$/m, `name: ${name}`)
    : `name: ${name}\n${block}`
  if (!/^description:/m.test(block)) {
    block = `${block}\ndescription: ${quote(description)}`
  }
  return text.slice(0, match.open.length) + block + match.close + text.slice(match.all.length)
}

/** Markdown body with the frontmatter block removed (SkillDefinition.content). */
export function stripFrontmatter(text: string): string {
  const match = groupsOf(text)
  return match === undefined ? text : text.slice(match.all.length)
}

/** Best-effort kebab-case slug; empty when nothing latin/numeric survives. */
export function kebabOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
