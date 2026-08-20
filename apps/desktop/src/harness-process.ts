/** Launch and readiness helpers for the desktop-owned dsh Web child process. */

import type { ChildProcess } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?: \(LAN: .+\))?$/

/**
 * Resolve the deployed CLI entry beneath Electron's resources directory. The
 * deployment root is this desktop package (its production closure is what
 * carries the UniClaw plugins), so the CLI sits in the closure rather than at
 * the root.
 */
export function runtimeCliPath(appPath: string): string {
  return join(appPath, 'runtime-build', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/** Resolve the module fallback hook URL packaged with the desktop main process. */
export function runtimeResolverURL(appPath: string): string {
  return pathToFileURL(join(appPath, 'lib', 'runtime-resolver.js')).href
}

/**
 * Build the CommonJS fallback search path for packages archived with the runtime.
 * @param appPath - Electron application path, including an ASAR path in packaged builds.
 * @param inherited - Existing process-level CommonJS search path.
 * @returns Runtime node_modules followed by any inherited search path.
 */
export function runtimeNodePath(appPath: string, inherited?: string): string {
  const runtime = join(appPath, 'runtime-build', 'node_modules')
  return inherited === undefined || inherited === '' ? runtime : `${runtime}${delimiter}${inherited}`
}

/** Absolute path of the shipped overlay that mounts the UniClaw plugins. */
export function uniclawPatchPath(appPath: string): string {
  return join(appPath, 'config', 'uniclaw.cordis.yml')
}

/**
 * Arguments that install the ASAR resolver, mount the UniClaw overlay, keep
 * the server loopback-only, and request a free port.
 */
export function desktopCliArgs(resolverURL: string, cliPath: string, patchPath: string): string[] {
  return [
    '--import', resolverURL, '--expose-internals', cliPath,
    '--profile', 'web', '--patch', patchPath,
    '--host', '127.0.0.1', '--port', '0',
  ]
}

/** Incrementally extract the Web readiness URL from arbitrarily chunked stdout. */
export class ReadinessParser {
  private pending = ''

  /** Add one decoded stdout chunk and return the first complete readiness URL. */
  push(chunk: string): string | undefined {
    this.pending += chunk
    const lines = this.pending.split(/\r?\n/)
    this.pending = lines.pop() ?? ''
    for (const line of lines) {
      const match = READY_LINE.exec(line)
      if (match?.[1] !== undefined) return match[1]
    }
    return undefined
  }
}

/** Ask the child to dispose its plugin tree, then force termination after the grace period. */
export function stopHarness(child: ChildProcess, graceMs = 7_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
    }, graceMs)
    timeout.unref()
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
}
