import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as plugin from '../src/index.ts'
import { mapBochaResponse, UniclawSearchProvider } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-uniclaw-search-loader-'))
  const credentialsPath = join(root, '.credentials.yaml')
  const configPath = join(root, 'cordis.yml')
  await writeFile(credentialsPath, 'UNICLAW_APP_TOKEN: test-token\n')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: '${credentialsPath.replaceAll('\\', '/')}'`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-web'",
    '  config:',
    '    searchProvider: uniclaw',
    "- name: '@deepseek-ai/dsh-web-search-uniclaw'",
    '  config:',
    "    endpoint: 'https://search.test/bocha'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-web', WebRuntime],
    ['@deepseek-ai/dsh-web-search-uniclaw', plugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  return context
}

describe('UniClaw search response mapping', () => {
  it('maps summaries, snippets, dates, and drops rows without URLs', () => {
    expect(mapBochaResponse({ data: { webPages: { value: [
      { name: 'A', url: 'https://a.test', summary: 'summary', snippet: 'snippet', datePublished: '2026-08-21' },
      { url: 'https://b.test', snippet: 'B', dateLastCrawled: '2026-08-20' },
      { name: 'missing URL' },
    ] } } })).toEqual({
      sources: [
        { title: 'A', url: 'https://a.test', snippet: 'summary', publishedAt: '2026-08-21' },
        { url: 'https://b.test', snippet: 'B', publishedAt: '2026-08-20' },
      ],
      truncated: false,
    })
  })

  it('treats an absent result array as an empty valid response', () => {
    expect(mapBochaResponse({})).toEqual({ sources: [], truncated: false })
  })
})

describe('UniClaw search requests', () => {
  it('loads through a real composition and sends the stored token without following redirects', { timeout: 60_000 }, async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ code: 0, data: { webPages: { value: [] } } }))
    vi.stubGlobal('fetch', fetchMock)
    const loaded = await loadComposition()

    await expect(loaded.web.search({ query: 'current news', maxResults: 3 }))
      .resolves.toEqual({ sources: [], truncated: false })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://search.test/bocha')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'current news', count: 3, freshness: 'noLimit', summary: true,
    })
  })

  it('reports missing credentials without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctx = { credentials: { resolve: async () => undefined } } as unknown as Context
    const provider = new UniclawSearchProvider(ctx, {
      endpoint: 'https://search.test/bocha', apiKeyEnv: 'MISSING', timeoutMs: 1000,
      defaultCount: 10, freshness: 'noLimit', summary: true,
    })
    await expect(provider.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps provider error codes and malformed JSON to web provider failures', async () => {
    const ctx = { credentials: { resolve: async () => ({ value: 'key', source: 'test' }) } } as unknown as Context
    const provider = new UniclawSearchProvider(ctx, {
      endpoint: 'https://search.test/bocha', apiKeyEnv: 'KEY', timeoutMs: 1000,
      defaultCount: 10, freshness: 'noLimit', summary: true,
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 401, msg: 'expired' })))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(/code 401: expired/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')))
    await expect(provider.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})
