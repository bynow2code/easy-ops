import { resolve } from 'node:path'
import { BrowserWindow, shell } from 'electron'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1280,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'EasyOps',
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(resolve(__dirname, '../renderer/index.html'))
  }

  return win
}
