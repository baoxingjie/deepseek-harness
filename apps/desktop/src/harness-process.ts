/** Launch and readiness helpers for the desktop-owned dsh Web child process. */

import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?: \(LAN: .+\))?$/

/** Resolve the deployed CLI entry beneath Electron's resources directory. */
export function runtimeCliPath(resourcesPath: string): string {
  return join(resourcesPath, 'runtime', 'lib', 'bin.js')
}

/** Arguments that keep the desktop server loopback-only and request a free port. */
export function desktopCliArgs(cliPath: string): string[] {
  return [cliPath, '--profile', 'web', '--host', '127.0.0.1', '--port', '0']
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
