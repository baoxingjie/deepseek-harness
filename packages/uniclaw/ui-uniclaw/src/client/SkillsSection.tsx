/** The UniClaw 技能 settings page. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings shell's SlotMap merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

export type SkillsSectionProps = PropsRuntime<'settings.section'>

/** Render the skills page. */
export function SkillsSection(_props: SkillsSectionProps): JSX.Element {
  return <div>UniClaw 技能（占位）</div>
}
