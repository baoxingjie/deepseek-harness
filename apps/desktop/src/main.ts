/** Electron main process that owns the local Harness runtime and desktop window. */

import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { desktopCliArgs, loadingPagePath, loadWhenListening, ReadinessParser, runtimeCliPath, runtimeNodePath, runtimeResolverURL, stopHarness, uniclawPatchPath } from './harness-process.ts'

const STARTUP_TIMEOUT_MS = 30_000
const PRODUCT_NAME = 'uniclaw-dsh'
let harness: ChildProcess | undefined
let quitting = false
let mainWindow: BrowserWindow | undefined

/** Raise the existing window, restoring it when minimized. */
function focusWindow(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function startHarness(): Promise<string> {
  const appPath = app.getAppPath()
  const cliPath = runtimeCliPath(appPath)
  const child = spawn(process.execPath, desktopCliArgs(runtimeResolverURL(appPath), cliPath, uniclawPatchPath(appPath)), {
    env: {
      ...process.env,
      DSH_DESKTOP_RUNTIME_ANCHOR: join(appPath, 'runtime-build', 'package.json'),
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: runtimeNodePath(appPath, process.env.NODE_PATH),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  harness = child
  const parser = new ReadinessParser()
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_192)
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Desktop runtime did not become ready within ${STARTUP_TIMEOUT_MS / 1_000} seconds.${stderr === '' ? '' : `\n\n${stderr}`}`))
    }, STARTUP_TIMEOUT_MS)
    const finish = (callback: () => void): void => {
      clearTimeout(timeout)
      child.stdout.removeAllListeners('data')
      child.removeAllListeners('error')
      child.removeAllListeners('exit')
      callback()
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const url = parser.push(chunk)
      if (url !== undefined) finish(() => { resolve(url) })
    })
    child.once('error', (error) => { finish(() => { reject(error) }) })
    child.once('exit', (code, signal) => {
      finish(() => {
        reject(new Error(`Desktop runtime exited before startup (code ${String(code)}, signal ${String(signal)}).${stderr === '' ? '' : `\n\n${stderr}`}`))
      })
    })
  })
}

/**
 * Open the window on the local loading page. The runtime takes a moment to
 * come up, and an app that shows nothing until then reads as a failed launch.
 * @returns the window, already visible.
 */
async function openLoadingWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    icon: join(app.getAppPath(), 'build', 'icon.png'),
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
  mainWindow = window
  window.on('closed', () => { mainWindow = undefined })
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(PRODUCT_NAME)
  })
  window.once('ready-to-show', () => { window.show() })
  await window.loadFile(loadingPagePath(app.getAppPath()))
  return window
}

/**
 * Point the open window at the running server and confine navigation to it.
 * @param window - the window opened by {@link openLoadingWindow}.
 * @param url - the address the runtime announced.
 */
async function showHarness(window: BrowserWindow, url: string): Promise<void> {
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin === new URL(url).origin) return
    event.preventDefault()
    void shell.openExternal(target)
  })
  await loadWhenListening(() => window.loadURL(url))
}

app.on('window-all-closed', () => { app.quit() })
// A second launch belongs to the running instance: one harness, one window.
app.on('second-instance', () => { focusWindow() })
app.on('activate', () => { focusWindow() })
app.on('before-quit', (event) => {
  if (quitting || harness === undefined) return
  event.preventDefault()
  quitting = true
  void stopHarness(harness).finally(() => { app.quit() })
})

app.setName(PRODUCT_NAME)
// A second instance must not spawn a second runtime on a second port; the
// lock has to be taken before anything else starts.
if (app.requestSingleInstanceLock()) {
  // Electron emits ready only after the main module finishes evaluating.
  void app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('ai.uniclaw.dsh')
    let window: BrowserWindow | undefined
    try {
      window = await openLoadingWindow()
      await showHarness(window, await startHarness())
    } catch (error) {
      console.error(error)
      window?.destroy()
      await dialog.showMessageBox({
        type: 'error',
        title: `${PRODUCT_NAME} could not start`,
        message: error instanceof Error ? error.message : String(error),
      })
      app.quit()
    }
  })
} else {
  app.quit()
}
