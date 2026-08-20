import { describe, expect, it } from 'vitest'
import { delimiter } from 'node:path'
import { desktopCliArgs, ReadinessParser, runtimeCliPath, runtimeNodePath, runtimeResolverURL } from '../src/harness-process.ts'

describe('desktop Harness launch', () => {
  it('resolves the deployed CLI and fixes the server to loopback with an ephemeral port', () => {
    const cli = runtimeCliPath('app.asar')
    const resolver = runtimeResolverURL('app.asar')
    expect(cli).toMatch(/app\.asar[\\/]runtime-build[\\/]lib[\\/]bin\.js$/)
    expect(resolver).toMatch(/^file:\/\/\/.*app\.asar\/lib\/runtime-resolver\.js$/)
    expect(runtimeNodePath('app.asar')).toMatch(/app\.asar[\\/]runtime-build[\\/]node_modules$/)
    expect(runtimeNodePath('app.asar', 'inherited')).toMatch(new RegExp(`node_modules\\${delimiter}inherited$`))
    expect(desktopCliArgs(resolver, cli)).toEqual([
      '--import', resolver, '--expose-internals', cli, '--profile', 'web', '--host', '127.0.0.1', '--port', '0',
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
})
