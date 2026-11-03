import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { CONFIG_FILE, VAULT } from './config'
import { wireAlerts } from './alerts'
import { Controller } from './controller'
import { cleanEnv, loadShellPath, resolveBinaries } from './env'
import { installRuntimeFiles } from './hooks'
import { wireIpc } from './ipc'
import { Sessions } from './sessions'
import { StatusStore } from './status'
import { Tmux } from './tmux'

let win: BrowserWindow | undefined
let controller: Controller | undefined
let sessions: Sessions | undefined
let startupError: string | undefined

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(boot)
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Claude Control',
    backgroundColor: '#0b0d10',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.on('focus', () => {
    if (!controller) return
    controller.windowFocused = true
    if (controller.selectedKey) controller.select(controller.selectedKey)
  })
  w.on('blur', () => {
    if (controller) controller.windowFocused = false
  })
  w.on('closed', () => {
    win = undefined
  })
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(join(__dirname, '../renderer/index.html'))
  return w
}

async function boot(): Promise<void> {
  loadShellPath()
  try {
    if (!VAULT) throw new Error(`No vault configured. Create ${CONFIG_FILE} with { "vault": "/path/to/vault" } and restart Claude Control.`)
    const bins = resolveBinaries()
    console.log(`[boot] ${bins.claudeVersion} at ${bins.claude}; tmux at ${bins.tmux}`)
    installRuntimeFiles(app.getAppPath())
    const env = cleanEnv()
    const tmux = new Tmux(bins.tmux, env)
    sessions = new Sessions(tmux, bins.claude, env)
    controller = new Controller(tmux, sessions, new StatusStore())
    wireIpc(controller, sessions, tmux, () => win, () => startupError)
    wireAlerts(controller, () => win, (key) => {
      controller?.select(key)
      win?.webContents.send('select', key)
    })
    await controller.start()
  } catch (err) {
    startupError = (err as Error).message
    console.error('[boot]', err)
  }
  win = createWindow()
  app.on('activate', () => {
    if (!win) win = createWindow()
  })
}

app.on('window-all-closed', () => {
  // Detach only: tmux and every claude keep running.
  sessions?.detachAll()
  app.quit()
})

app.on('before-quit', () => {
  sessions?.detachAll()
  void controller?.stop()
})
