import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'

/**
 * 自绘标题栏的窗口控件(titleBarStyle: 'hidden' 后原生按钮没了):
 * 红绿灯的关闭/最小化/最大化都走这三个 IPC。close() 会正常触发
 * beforeunload,UnsavedDraftGuard 的「保存并退出」拦截不受影响。
 */
export function registerWindowIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('win:minimize', () => {
    getWindow()?.minimize()
  })

  ipcMain.handle('win:toggleMaximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('win:close', () => {
    getWindow()?.close()
  })
}
