import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { probePty } from './pty/probe'
import { createElectronStore } from './store/persistence'
import { createScriptsStore, type ScriptsData } from './store/scripts'
import { createSettingsStore, DEFAULT_SETTINGS } from './store/settings'
import { createMainWindow } from './window'
import type { Settings } from '../shared/types'

const REPO_URL = 'https://github.com/bynow2code/easy-ops'

let mainWindow: BrowserWindow | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  const spawnMainWindow = (): void => {
    const win = createMainWindow()
    win.on('closed', () => {
      mainWindow = null
    })
    mainWindow = win
  }

  app
    .whenReady()
    .then(() => {
      const scriptsPersistence = createElectronStore<ScriptsData>('easyops-scripts', { scripts: [], groups: [] }, 'data')
      const settingsPersistence = createElectronStore<Settings>('easyops-settings', DEFAULT_SETTINGS, 'data')

      const scriptsStore = createScriptsStore(scriptsPersistence)
      const settingsStore = createSettingsStore(settingsPersistence)

      registerIpc({
        scripts: scriptsStore,
        settings: settingsStore,
        getWindow: () => mainWindow,
        repoUrl: REPO_URL
      })

      spawnMainWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          spawnMainWindow()
        }
      })

      if (!app.isPackaged) {
        void probePty().then((probe) => {
          if (probe.ok) {
            console.log('[EasyOps] node-pty 可用,输出:', probe.output.trim())
          } else {
            console.error('[EasyOps] node-pty 不可用:', probe.error ?? `退出码 ${probe.exitCode}`)
          }
        })
      }
    })
    .catch((err: unknown) => {
      console.error('[EasyOps] 主进程启动失败:', err)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
