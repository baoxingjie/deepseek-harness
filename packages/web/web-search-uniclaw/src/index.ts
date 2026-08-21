/**
 * UniClaw Yuanjing/Bocha search provider for the shared web capability.
 * @module @deepseek-ai/dsh-web-search-uniclaw
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-uniclaw'

/** Services required to resolve credentials and register the provider. */
export const inject = ['web', 'credentials']

/** Provider identifier selected by the UniClaw desktop composition. */
export const UNICLAW_SEARCH_PROVIDER_ID = 'uniclaw'

/** Default Yuanjing search endpoint used by UniClaw. */
export const UNICLAW_SEARCH_ENDPOINT = 'https://maas-api.ai-yuanjing.com/openapi/v1/uniclaw/general/search/bocha'

const NAMED_FRESHNESS = new Set(['noLimit', 'oneDay', 'oneWeek', 'oneMonth', 'oneYear'])
const DATE_FRESHNESS = /^\d{4}-\d{2}-\d{2}(?:\.\.\d{4}-\d{2}-\d{2})?$/

/** Deployment settings for the UniClaw search provider. */
export interface Config {
  /** HTTPS Bocha-compatible search endpoint. */
  endpoint: string
  /** Credential reference resolved for each search. */
  apiKeyEnv: string
  /** Network timeout in milliseconds. */
  timeoutMs: number
  /** Result count sent when the caller omits `maxResults`. */
  defaultCount: number
  /** Provider freshness selector or inclusive date range. */
  freshness: string
  /** Request provider-generated page summaries. */
  summary: boolean
}

export const Config: z<Config> = z.object({
  endpoint: z.string().default(UNICLAW_SEARCH_ENDPOINT),
  apiKeyEnv: z.string().role('credential-ref').default('UNICLAW_APP_TOKEN'),
  timeoutMs: z.number().step(1).min(1).default(30_000),
  defaultCount: z.number().step(1).min(1).max(50).default(10),
  freshness: z.string().default('noLimit'),
  summary: z.boolean().default(true),
})

interface BochaPage {
  name?: unknown
  url?: unknown
  snippet?: unknown
  summary?: unknown
  datePublished?: unknown
  dateLastCrawled?: unknown
}

interface BochaResponse {
  code?: unknown
  msg?: unknown
  message?: unknown
  data?: { webPages?: { value?: unknown } }
}

/**
 * Normalize a Bocha response into provider-neutral web sources.
 * @param payload - Response returned by the Bocha endpoint.
 * @returns Sources accepted by the shared web capability.
 */
export function mapBochaResponse(payload: BochaResponse): WebSearchResult {
  const value = payload.data?.webPages?.value
  if (!Array.isArray(value)) return { sources: [], truncated: false }
  const sources = value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const page = item as BochaPage
    const url = optionalString(page.url)
    if (url === undefined) return []
    const title = optionalString(page.name)
    const snippet = optionalString(page.summary) ?? optionalString(page.snippet)
    const publishedAt = optionalString(page.datePublished) ?? optionalString(page.dateLastCrawled)
    return [{
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    }]
  })
  return { sources, truncated: false }
}

/** UniClaw search provider backed by the Yuanjing Bocha endpoint. */
export class UniclawSearchProvider implements WebSearchProvider {
  readonly id = UNICLAW_SEARCH_PROVIDER_ID

  /**
   * Create a provider that resolves its credential for every request.
   * @param ctx - Cordis context carrying the credential service.
   * @param config - Validated endpoint and request defaults.
   */
  constructor(private readonly ctx: Context, private readonly config: Config) {}

  /** @returns Whether the configured endpoint is a valid HTTPS URL. */
  available(): boolean {
    return URL.canParse(this.config.endpoint) && new URL(this.config.endpoint).protocol === 'https:'
  }

  /**
   * Search through Yuanjing and normalize the returned pages.
   * @param request - Query and optional result limit.
   * @param signal - Optional caller cancellation signal.
   * @returns Normalized citeable sources.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const key = await this.ctx.credentials.resolve(credentialRef(this.config.apiKeyEnv))
    if (key === undefined) {
      throw new WebError(`UniClaw search has no credential for "${this.config.apiKeyEnv}"`, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: combined,
        headers: {
          authorization: `Bearer ${key.value}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          query: request.query,
          count: request.maxResults ?? this.config.defaultCount,
          freshness: this.config.freshness,
          summary: this.config.summary,
        }),
      })
    } catch (error) {
      if (combined.aborted) throw new WebError('UniClaw search aborted', 'WEB_ABORTED', { cause: combined.reason })
      throw new WebError(`UniClaw search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw new WebError(`UniClaw search API error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    let payload: BochaResponse
    try {
      payload = await response.json() as BochaResponse
    } catch (error) {
      throw new WebError(`UniClaw search returned invalid JSON: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (typeof payload.code === 'number' && payload.code !== 0 && payload.code !== 200) {
      const detail = optionalString(payload.msg) ?? optionalString(payload.message)
      throw new WebError(`UniClaw search returned code ${payload.code}${detail === undefined ? '' : `: ${detail}`}`, 'WEB_PROVIDER_ERROR')
    }
    return mapBochaResponse(payload)
  }
}

/**
 * Register the UniClaw provider with the shared web capability.
 * @param ctx - Cordis context carrying web and credential services.
 * @param config - Endpoint, credential reference, and request defaults.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.endpoint.startsWith('https://')) throw new Error('web-search-uniclaw: endpoint must use HTTPS')
  if (!NAMED_FRESHNESS.has(config.freshness) && !DATE_FRESHNESS.test(config.freshness)) {
    throw new Error('web-search-uniclaw: freshness must be a named interval or YYYY-MM-DD..YYYY-MM-DD')
  }
  ctx.web.registerSearchProvider(new UniclawSearchProvider(ctx, config))
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
