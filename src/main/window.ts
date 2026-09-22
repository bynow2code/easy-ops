import { resolve } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import type { PtyManager } from './pty/manager'

export function createMainWindow(ptyManager?: PtyManager): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1280,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    // 方案 B(macOS 统一工具栏):去掉原生标题栏,顶栏由渲染层自绘,
    // 窗口控件走 win:* IPC(macOS 上系统红绿灯仍自动叠在左上角,渲染层据此跳过自绘)
    titleBarStyle: 'hidden',
    title: 'EasyOps',
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  if (ptyManager) {
    // 渲染进程重载(dev Cmd+R / Page.reload,非原地导航)会丢失旧 UI,
    // 主进程会话随之变幽灵,这里统一清理;初始导航时无会话,disposeAll 天然无害
    win.webContents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) void ptyManager.disposeAll()
    })
    // 渲染进程崩溃同样清理
    win.webContents.on('render-process-gone', () => {
      void ptyManager.disposeAll()
    })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(resolve(__dirname, '../renderer/index.html'))
  }

  return win
}
