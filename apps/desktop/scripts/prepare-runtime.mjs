import { cp, lstat, readdir, realpath, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const runtimeDir = fileURLToPath(new URL('../dist/runtime', import.meta.url))
await rm(runtimeDir, { recursive: true, force: true })

const pnpmEntry = process.env.npm_execpath
if (pnpmEntry === undefined) throw new Error('prepare-runtime must run from a pnpm script')
const workspaceDir = fileURLToPath(new URL('../../..', import.meta.url))

async function deploy(filter, destination) {
  const child = spawn(process.execPath, [pnpmEntry, '--filter', filter, 'deploy', '--prod', '--legacy', destination], {
    cwd: workspaceDir,
    stdio: 'inherit',
    windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0) throw new Error(`pnpm deploy failed with exit code ${String(code)} while preparing ${appDir}`)
}

await deploy('@deepseek-ai/dsh', runtimeDir)

const insideRuntime = (path) => {
  const offset = relative(runtimeDir, path)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..')
}

async function materializeExternalLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await realpath(path)
      if (insideRuntime(target)) continue
      await rm(path, { recursive: true, force: true })
      await cp(target, path, {
        recursive: true,
        filter: source => source === target || !relative(target, source).split(/[\\/]/).includes('node_modules'),
      })
      await materializeExternalLinks(path)
      continue
    }
    if ((await lstat(path)).isDirectory()) await materializeExternalLinks(path)
  }
}

// Legacy deploy preserves link: overrides as workspace-relative symlinks. An
// installer cannot refer back to the checkout, so replace only links escaping
// the deployed runtime with their package files before electron-builder copies it.
await materializeExternalLinks(runtimeDir)
