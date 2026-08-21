import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { safeJoin } from '../src/skills.ts'

describe('skill archive paths', () => {
  it('accepts files below the skill directory with native path separators', () => {
    const destination = join(process.cwd(), '.dsh', 'skills', 'example')

    expect(safeJoin(destination, 'SKILL.md')).toBe(join(destination, 'SKILL.md'))
    expect(safeJoin(destination, 'scripts/run.js')).toBe(join(destination, 'scripts', 'run.js'))
  })

  it('rejects paths that escape the skill directory', () => {
    const destination = join(process.cwd(), '.dsh', 'skills', 'example')

    expect(() => safeJoin(destination, '../outside.txt')).toThrow('Invalid archive file.')
  })
})
