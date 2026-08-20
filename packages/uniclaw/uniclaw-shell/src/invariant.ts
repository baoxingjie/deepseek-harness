/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-uniclaw-shell`.
 * @module @deepseek-ai/dsh-uniclaw-shell/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-uniclaw-shell'

/** Cordis companion plugin name. */
export const name = 'uniclaw-shell-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package proxies the UniClaw gateway over HTTP
 * routes and mounts mcp-client fibers whose own package owns their tool
 * registration invariant. It emits no cordis events, and the relations it
 * holds — mounted fibers keyed by server id, installed skills on disk — are
 * private to one plugin instance rather than a cross-plugin contract.
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
