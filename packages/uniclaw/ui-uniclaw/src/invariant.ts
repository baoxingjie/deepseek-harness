/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-uniclaw`.
 * @module @deepseek-ai/dsh-client-ui-uniclaw/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-uniclaw'

/** Cordis companion plugin name. */
export const name = 'client-ui-uniclaw-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: these are settings pages over the uniclaw-shell HTTP
 * routes — they emit no cordis events and own no cross-plugin mutable
 * relation, and slot registration conflicts already fail loud in the slot
 * core at load time.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
