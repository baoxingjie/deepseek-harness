import { cp, lstat, mkdtemp, readdir, realpath, rename, rm, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const runtimeDir = fileURLToPath(new URL('../runtime-build', import.meta.url))

const pnpmEntry = process.env.npm_execpath
if (pnpmEntry === undefined) throw new Error('prepare-runtime must run from a pnpm script')
const workspaceDir = fileURLToPath(new URL('../../..', import.meta.url))
const stagingDir = await mkdtemp(resolve(workspaceDir, '..', 'dsh-desktop-runtime-'))

async function deploy(filter, destination) {
  const child = spawn(process.execPath, [pnpmEntry, '--filter', filter, 'deploy', '--prod', '--ignore-scripts', '--config.inject-workspace-packages=true', '--config.node-linker=hoisted', destination], {
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

async function runRuntimeScript(path) {
  const child = spawn(process.execPath, [path], {
    cwd: stagingDir,
    stdio: 'inherit',
    windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0) throw new Error(`runtime postinstall failed with exit code ${String(code)} while preparing ${appDir}`)
}

const insideRuntime = (path) => {
  const offset = relative(stagingDir, path)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..')
}

async function materializeExternalLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await realpath(path)
      if (insideRuntime(target)) continue
      await unlink(path)
      await cp(target, path, {
        recursive: true,
        filter: source => source === target || !relative(target, source).split(/[\\/]/).includes('node_modules'),
      })
      continue
    }
    if ((await lstat(path)).isDirectory()) await materializeExternalLinks(path)
  }
}

// Link overrides remain workspace-relative symlinks. An installer cannot refer
// back to the checkout, so replace links escaping the deployed runtime with
// their package files. Do not traverse a copied package again: its dependencies
// already exist in the deployment, and package-local links can reach checkout
// build artifacts.
try {
  await deploy('@deepseek-ai/dsh', stagingDir)
  await materializeExternalLinks(stagingDir)
  await runRuntimeScript(resolve(stagingDir, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'scripts', 'ensure-spawn-helper.mjs'))
  await rm(runtimeDir, { recursive: true, force: true })
  await rename(stagingDir, runtimeDir)
} finally {
  await rm(stagingDir, { recursive: true, force: true })
}
