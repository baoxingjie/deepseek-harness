/**
 * UniClaw settings pages, browser half. Registers one `settings.section` per
 * UniClaw configuration domain; each page reads and writes the uniclaw-shell
 * host plugin's own `/api/uniclaw/*` routes on the serving origin.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section'
// entry) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkillsSection } from './SkillsSection.tsx'

export type { SkillsSectionProps } from './SkillsSection.tsx'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on the slot through `slots.inject()`.
 */
export const inject = ['slots']

/**
 * Register the UniClaw settings pages once `settings.section` is on the
 * ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'uniclaw-skills',
    order: 60,
    label: () => '技能',
  }, SkillsSection))
}
