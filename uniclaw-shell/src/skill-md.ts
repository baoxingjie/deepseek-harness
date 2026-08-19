/**
 * SKILL.md frontmatter helpers shared by the skill install pipeline
 * (skills.ts) and the bundled-skills provider (skills-bundled.ts).
 *
 * Node builtins only — this module is loaded by absolute path with the rest
 * of the uniclaw-shell plugin.
 */

/** Harness skill-name grammar (packages/skill/skill isSkillName). */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface Frontmatter { name?: string; description?: string }

const FRONTMATTER_BLOCK = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/

/** Parse the `name` and `description` keys of a SKILL.md frontmatter block. */
export function parseFrontmatter(text: string): Frontmatter | undefined {
  const match = FRONTMATTER_BLOCK.exec(text)
  if (match === null) return undefined
  const lines = match[2]!.split(/\r?\n/)
  const result: Frontmatter = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(name|description):\s*(.*)$/.exec(lines[i]!)
    if (kv === null) continue
    const key = kv[1] as 'name' | 'description'
    let value = kv[2]!.trim()
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      // Block scalar: join the following indented lines for display purposes.
      const block: string[] = []
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]!); j++) block.push(lines[j]!.trim())
      value = block.join(' ')
    }
    value = value.replace(/^["']|["']$/g, '')
    if (result[key] === undefined) result[key] = value
  }
  return result
}

/** Rewrite (or insert) the frontmatter `name`, backfilling `description`. */
export function rewriteFrontmatter(text: string, name: string, description: string): string {
  const match = FRONTMATTER_BLOCK.exec(text)
  if (match === null) return text
  let block = match[2]!
  const quote = (v: string) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  block = /^name:.*$/m.test(block)
    ? block.replace(/^name:.*$/m, `name: ${name}`)
    : `name: ${name}\n${block}`
  if (!/^description:/m.test(block)) {
    block = `${block}\ndescription: ${quote(description)}`
  }
  return text.slice(0, match[1]!.length) + block + match[3]! + text.slice(match[0].length)
}

/** Markdown body with the frontmatter block removed (SkillDefinition.content). */
export function stripFrontmatter(text: string): string {
  const match = FRONTMATTER_BLOCK.exec(text)
  return match === null ? text : text.slice(match[0].length)
}

/** Best-effort kebab-case slug; empty when nothing latin/numeric survives. */
export function kebabOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
