import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { UNICLAW_SEARCH_ENDPOINT, UniclawSearchProvider } from '../src/index.ts'

const key = process.env.UNICLAW_APP_TOKEN
const maybe = key === undefined || key.length === 0 ? describe.skip : describe

maybe('UniclawSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const ctx = { credentials: { resolve: async () => ({ value: key!, source: 'env' }) } } as unknown as Context
    const provider = new UniclawSearchProvider(ctx, {
      endpoint: process.env.UNICLAW_SEARCH_ENDPOINT ?? UNICLAW_SEARCH_ENDPOINT,
      apiKeyEnv: 'UNICLAW_APP_TOKEN', timeoutMs: 30_000, defaultCount: 5,
      freshness: 'oneMonth', summary: true,
    })
    const result = await provider.search({ query: 'DeepSeek 最新消息', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 35_000)
})
