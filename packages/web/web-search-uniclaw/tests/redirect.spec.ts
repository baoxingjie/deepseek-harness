/** Real HTTP coverage proves that native fetch never contacts a redirect target. */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { UniclawSearchProvider } from '../src/index.ts'

let redirectOrigin: string
let targetOrigin: string
let targetRequests = 0

const targetServer = createServer((_request, response) => {
  targetRequests += 1
  response.writeHead(204).end()
})

const redirectServer = createServer((request, response) => {
  request.resume()
  const status = Number(new URL(request.url ?? '/', 'http://fixture.test').pathname.slice(1))
  response.writeHead(status, { location: `${targetOrigin}/collect` }).end()
})

beforeAll(async () => {
  targetOrigin = await listen(targetServer)
  redirectOrigin = await listen(redirectServer)
})

afterAll(async () => {
  await Promise.all([close(redirectServer), close(targetServer)])
})

describe('UniclawSearchProvider redirect policy', () => {
  it.each([301, 302, 303, 307, 308])('rejects HTTP %i before contacting Location', async (status) => {
    targetRequests = 0
    const ctx = { credentials: { resolve: async () => ({ value: 'secret', source: 'test' }) } } as unknown as Context
    const provider = new UniclawSearchProvider(ctx, {
      endpoint: `${redirectOrigin}/${status}`, apiKeyEnv: 'KEY', timeoutMs: 1000,
      defaultCount: 10, freshness: 'noLimit', summary: true,
    })
    await expect(provider.search({ query: 'private query' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(targetRequests).toBe(0)
  })
})

/** @returns The loopback origin after the server starts listening. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

/** Close a listening fixture after every request settles. */
async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
}
