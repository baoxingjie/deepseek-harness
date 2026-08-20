/**
 * UniClaw settings pages, browser half. Registers one `settings.section` per
 * UniClaw configuration domain; each page reads and writes the uniclaw-shell
 * host plugin's own `/api/uniclaw/*` routes on the serving origin.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section'
// entry) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { McpSection } from './McpSection.tsx'
import type { McpSectionInjected } from './McpSection.tsx'
import { createMcpStore } from './mcp-store.ts'
import { SkillsSection } from './SkillsSection.tsx'
import type { SkillsSectionInjected } from './SkillsSection.tsx'
import { createSkillsStore } from './skills-store.ts'
import { LoginOnboarding } from './LoginOnboarding.tsx'
import type { LoginOnboardingInjected } from './LoginOnboarding.tsx'
import { createLoginStore } from './login-store.ts'

export type { McpSectionProps, McpSectionInjected } from './McpSection.tsx'
export type { SkillsSectionProps, SkillsSectionInjected } from './SkillsSection.tsx'
export type { LoginOnboardingProps, LoginOnboardingInjected } from './LoginOnboarding.tsx'
export type { McpController, McpState } from './mcp-store.ts'
export type { SkillsController, SkillsState } from './skills-store.ts'
export type { LoginController, LoginState } from './login-store.ts'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on the slot through `slots.inject()`.
 */
export const inject = ['slots']

/**
 * Register the login gate and the UniClaw settings pages once their slots are
 * on the ledger. Each surface holds its own snapshot store, loaded when it
 * first opens.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const login = createLoginStore()
  const loginInjected = (): LoginOnboardingInjected => ({
    hooks: { login: login.store },
    controller: login,
  })

  const skills = createSkillsStore()
  const skillsInjected = (): SkillsSectionInjected => ({
    controller: skills,
    useSnapshot: bindSnapshotSelector(skills.store),
  })
  const mcp = createMcpStore()
  const mcpInjected = (): McpSectionInjected => ({
    controller: mcp,
    useSnapshot: bindSnapshotSelector(mcp.store),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'uniclaw-skills',
    order: 60,
    label: () => '技能',
    inject: skillsInjected,
  }, SkillsSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'uniclaw-mcp',
    order: 61,
    label: () => 'MCP',
    inject: mcpInjected,
  }, McpSection))
  // Ordered ahead of every product onboarding step: without a UniClaw session
  // there is no model catalog for a later step to configure.
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'uniclaw-login',
    order: -200,
    inject: loginInjected,
  }, LoginOnboarding))
}
