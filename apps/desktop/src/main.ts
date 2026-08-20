/** Electron main process that owns the local Harness runtime and desktop window. */

import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { desktopCliArgs, ReadinessParser, runtimeCliPath, runtimeResolverURL, stopHarness } from './harness-process.ts'

const STARTUP_TIMEOUT_MS = 30_000
let harness: ChildProcess | undefined
let quitting = false

function startHarness(): Promise<string> {
  const appPath = app.getAppPath()
  const cliPath = runtimeCliPath(appPath)
  const child = spawn(process.execPath, desktopCliArgs(runtimeResolverURL(appPath), cliPath), {
    env: {
      ...process.env,
      DSH_DESKTOP_RUNTIME_ANCHOR: join(appPath, 'runtime-build', 'package.json'),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  harness = child
  const parser = new ReadinessParser()
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_192)
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Desktop runtime did not become ready within ${STARTUP_TIMEOUT_MS / 1_000} seconds.${stderr === '' ? '' : `\n\n${stderr}`}`))
    }, STARTUP_TIMEOUT_MS)
    const finish = (callback: () => void): void => {
      clearTimeout(timeout)
      child.stdout?.removeAllListeners('data')
      child.removeAllListeners('error')
      child.removeAllListeners('exit')
      callback()
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      const url = parser.push(chunk)
      if (url !== undefined) finish(() => { resolve(url) })
    })
    child.once('error', error => finish(() => { reject(error) }))
    child.once('exit', (code, signal) => finish(() => {
      reject(new Error(`Desktop runtime exited before startup (code ${String(code)}, signal ${String(signal)}).${stderr === '' ? '' : `\n\n${stderr}`}`))
    }))
  })
}

async function createWindow(url: string): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => { window.show() })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin === new URL(url).origin) return
    event.preventDefault()
    void shell.openExternal(target)
  })
  await window.loadURL(url)
}

app.on('window-all-closed', () => { app.quit() })
app.on('before-quit', (event) => {
  if (quitting || harness === undefined) return
  event.preventDefault()
  quitting = true
  void stopHarness(harness).finally(() => { app.quit() })
})

await app.whenReady()
try {
  await createWindow(await startHarness())
} catch (error) {
  console.error(error)
  await dialog.showMessageBox({
    type: 'error',
    title: 'DeepSeek Harness could not start',
    message: error instanceof Error ? error.message : String(error),
  })
  app.quit()
}
