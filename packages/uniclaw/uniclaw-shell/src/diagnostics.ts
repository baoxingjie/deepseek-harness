/**
 * uniclaw-shell 诊断 — read-only visibility into what the skill registry
 * actually merged, so a report of "the builtin skills are missing" is checked
 * against data instead of against a model's prose.
 *
 * The model-facing skill catalog is otherwise unobservable: it reaches a model
 * inside the system prompt and reaches the browser through the settings RPC,
 * and neither is inspectable from a terminal. A skill can also be *shipped*
 * without being *visible* — the registry drops candidates that fail validation
 * and shadows duplicate names by rank — so counting bundle directories proves
 * nothing. This route reports the merged catalog itself.
 *
 * Like the rest of the plugin: node builtins only, workspace packages are
 * `import type` only (mounted by absolute path, outside node_modules).
 */
import { readdir } from 'node:fs/promises'
import { sep } from 'node:path'
import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `webServer` into Context.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SkillResourceBase, SkillSummary } from '@deepseek-ai/dsh-skill'
import { SHIPPED_DIR, bundledDir, readDisabledSet } from './skills-bundled.ts'

const ROUTE = '/api/uniclaw/diagnostics/skills'

/**
 * Register the read-only skill-catalog diagnostics route.
 * @param ctx - plugin context carrying the web server and the skill registry.
 */
export function registerDiagnosticsModule(ctx: Context): void {
  ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      try {
        sendJson(res, 200, await report(ctx, url.searchParams))
      } catch (error) {
        console.error('[uniclaw-shell] diagnostics route failed:', error)
        sendJson(res, 500, { detail: error instanceof Error ? error.message : String(error) })
      }
    },
  })
  console.log(`[uniclaw-shell] diagnostics route at ${ROUTE}`)
}

interface CatalogEntry {
  name: string
  provider: string
  source: string
  modelInvocable: boolean
  userInvocable: boolean
  resource?: string
  description: string
}

interface Report {
  route: string
  /**
   * `snapshot()` without a scope reads the global layer alone. An agent also
   * sees its own scope chain, so a per-agent catalog is a superset of this one
   * — a skill missing here is missing everywhere.
   */
  scope: 'global'
  /** Restates {@link Report.scope} for whoever is reading the JSON. */
  scopeNote: string
  cwd: string
  bundled: {
    /** Where the bundles ship inside the plugin. */
    shippedDir: string
    /** Where the provider serves them from: {@link Report.bundled.shippedDir}, or a copy under `<dshHome>`. */
    servingDir: string
    /** Whether the bundles were copied out of an ASAR archive to become reachable by subprocesses. */
    materialized: boolean
    /**
     * Whether a skill's own `scripts/*` are reachable by the shell and python
     * subprocesses that run them. False means skills list but cannot execute.
     */
    subprocessReadable: boolean
    readable: boolean
    shipped: number
    offered: number
    disabled: string[]
  }
  catalog: {
    complete: boolean
    total: number
    modelInvocable: number
    byProvider: Record<string, number>
    skills: CatalogEntry[]
  }
  probe?: {
    name: string
    loaded: boolean
    provider?: string
    path?: string
    bytes?: number
  }
}

/**
 * Build the catalog report.
 * @param ctx - plugin context carrying the skill registry.
 * @param params - `cwd` selects the workspace for cwd-sensitive providers;
 *   `probe` additionally loads one skill body to prove it is readable.
 * @returns the report payload.
 */
async function report(ctx: Context, params: URLSearchParams): Promise<Report> {
  const cwd = params.get('cwd') ?? process.cwd()
  const probeName = params.get('probe')

  const serving = await bundledDir()
  const [snapshot, disabled, dirents] = await Promise.all([
    ctx.skills.snapshot({ cwd }),
    readDisabledSet(),
    readdir(serving, { withFileTypes: true }).catch(() => undefined),
  ])

  const shipped = dirents?.filter(d => d.isDirectory() && !d.name.startsWith('.')) ?? []
  const byProvider: Record<string, number> = {}
  for (const skill of snapshot.skills) byProvider[skill.provider] = (byProvider[skill.provider] ?? 0) + 1

  const result: Report = {
    route: ROUTE,
    scope: 'global',
    scopeNote: 'Global layer only. A running agent additionally sees its preset-scoped'
      + ' providers, so its catalog is a superset — a skill absent here is absent everywhere.',
    cwd,
    bundled: {
      shippedDir: SHIPPED_DIR,
      servingDir: serving,
      materialized: serving !== SHIPPED_DIR,
      subprocessReadable: !serving.split(sep).some(segment => segment.endsWith('.asar')),
      readable: dirents !== undefined,
      shipped: shipped.length,
      offered: shipped.length - shipped.filter(d => disabled.has(d.name)).length,
      disabled: [...disabled].sort(),
    },
    catalog: {
      complete: snapshot.complete,
      total: snapshot.skills.length,
      modelInvocable: snapshot.skills.filter(s => s.invocation.modelInvocable).length,
      byProvider,
      skills: snapshot.skills.map(entry),
    },
  }

  if (probeName !== null && probeName !== '') {
    const definition = await ctx.skills.get(probeName, { cwd })
    result.probe = definition === undefined
      ? { name: probeName, loaded: false }
      : {
        name: probeName,
        loaded: true,
        provider: definition.provider,
        ...definition.path === undefined ? {} : { path: definition.path },
        bytes: Buffer.byteLength(definition.content, 'utf8'),
      }
  }
  return result
}

/** Flatten one catalog summary into its report row. */
function entry(skill: SkillSummary): CatalogEntry {
  return {
    name: skill.name,
    provider: skill.provider,
    source: skill.source,
    modelInvocable: skill.invocation.modelInvocable,
    userInvocable: skill.invocation.userInvocable,
    ...skill.resourceBase === undefined ? {} : { resource: describeBase(skill.resourceBase) },
    description: skill.description,
  }
}

/** One-line rendering of a provider's resource base. */
function describeBase(base: SkillResourceBase): string {
  switch (base.kind) {
    case 'directory': return `directory:${base.path}`
    case 'url': return `url:${base.url}`
    default: return `opaque:${base.description}`
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body, null, 2))
}
