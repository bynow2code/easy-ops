import { app, BrowserWindow } from 'electron'
import * as os from 'node:os'
import { registerIpc } from './ipc'
import { registerPtyIpc } from './ipc/pty'
import { probePty } from './pty/probe'
import { createPtyManager } from './pty/manager'
import { spawnNodePty } from './pty/nodePtyAdapter'
import { cleanupStaleTempScripts, cleanupTempScript, writeTempScript } from './pty/runner'
import { createNodeShellProbe, detectShells } from './pty/shell'
import { createElectronStore } from './store/persistence'
import { createScriptsStore, type ScriptsData } from './store/scripts'
import { createSettingsStore, DEFAULT_SETTINGS } from './store/settings'
import { createMainWindow } from './window'
import type { Settings } from '../shared/types'

const REPO_URL = 'https://github.com/bynow2code/easy-ops'

let mainWindow: BrowserWindow | null = null
let ptyManagerRef: ReturnType<typeof createPtyManager> | null = null

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
    const win = createMainWindow(ptyManagerRef ?? undefined)
    win.on('closed', () => {
      void ptyManagerRef?.disposeAll()
      mainWindow = null
    })
    mainWindow = win
  }

  app
    .whenReady()
    .then(async () => {
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

      const tempDir = os.tmpdir()
      await cleanupStaleTempScripts(tempDir)

      const ptyManager = createPtyManager({
        spawn: spawnNodePty,
        tempDir,
        homeDir: app.getPath('home'),
        writeTempScript,
        cleanupTempScript,
        emit: (channel, payload) => {
          mainWindow?.webContents.send(channel, payload)
        },
        env: process.env as Record<string, string>,
        platform: process.platform
      })
      ptyManagerRef = ptyManager

      registerPtyIpc(ptyManager, settingsStore, () => detectShells(createNodeShellProbe()))

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

  app.on('before-quit', () => {
    void ptyManagerRef?.disposeAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
