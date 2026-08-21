import { describe, expect, it, vi } from 'vitest'
import { delimiter } from 'node:path'
import { desktopCliArgs, loadingPagePath, loadWhenListening, ReadinessParser, runtimeCliPath, runtimeNodePath, runtimeResolverURL, uniclawPatchPath } from '../src/harness-process.ts'

describe('desktop Harness launch', () => {
  it('resolves the deployed CLI and fixes the server to loopback with an ephemeral port', () => {
    const cli = runtimeCliPath('app.asar')
    const resolver = runtimeResolverURL('app.asar')
    expect(cli).toMatch(/app\.asar[\\/]runtime-build[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/)
    expect(resolver).toMatch(/^file:\/\/\/.*app\.asar\/lib\/runtime-resolver\.js$/)
    expect(runtimeNodePath('app.asar')).toMatch(/app\.asar[\\/]runtime-build[\\/]node_modules$/)
    expect(runtimeNodePath('app.asar', 'inherited')).toMatch(new RegExp(`node_modules\\${delimiter}inherited$`))
    const patch = uniclawPatchPath('app.asar')
    expect(patch).toMatch(/app\.asar[\\/]config[\\/]uniclaw\.cordis\.yml$/)
    expect(loadingPagePath('app.asar')).toMatch(/app\.asar[\\/]config[\\/]loading\.html$/)
    expect(desktopCliArgs(resolver, cli, patch)).toEqual([
      '--import', resolver, '--expose-internals', cli,
      '--profile', 'web', '--patch', patch,
      '--host', '127.0.0.1', '--port', '0',
    ])
  })

  it('parses a readiness line split across chunks', () => {
    const parser = new ReadinessParser()
    expect(parser.push('booting\ndsh web: http://127.0.')).toBeUndefined()
    expect(parser.push('0.1:43127\n')).toBe('http://127.0.0.1:43127')
  })

  it('does not accept non-loopback output as a navigation target', () => {
    const parser = new ReadinessParser()
    expect(parser.push('dsh web: http://example.com:3080\n')).toBeUndefined()
  })

  it('retries a refused readiness URL until the server accepts connections', async () => {
    vi.useFakeTimers()
    const refused = Object.assign(new Error('not listening'), { code: 'ERR_CONNECTION_REFUSED' })
    const load = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce()
    const loading = loadWhenListening(load)
    await vi.advanceTimersByTimeAsync(100)
    await expect(loading).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('does not retry other page load failures', async () => {
    const failure = Object.assign(new Error('invalid response'), { code: 'ERR_FAILED' })
    const load = vi.fn<() => Promise<void>>().mockRejectedValue(failure)
    await expect(loadWhenListening(load)).rejects.toBe(failure)
    expect(load).toHaveBeenCalledOnce()
  })
})
