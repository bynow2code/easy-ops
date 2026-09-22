import { app, BrowserWindow } from 'electron'
import * as os from 'node:os'
import { resolveAppIcon } from './appIcon'
import { registerIpc } from './ipc'
import { registerPtyIpc } from './ipc/pty'
import { probePty } from './pty/probe'
import { createPtyManager } from './pty/manager'
import { shellEnv } from './pty/env'
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

  /**
   * 补上应用图标。判断依据集中在 resolveAppIcon(见 src/main/appIcon.ts):
   * 打包后的 Linux **也要设** —— AppImage 不会把 .desktop 装进系统,桌面环境拿不到
   * .desktop 的 Icon=,只能回落到窗口自己的 _NET_WM_ICON,不设就是 Electron 默认图标。
   */
  const applyAppIcon = (win: BrowserWindow): void => {
    const plan = resolveAppIcon({
      platform: process.platform,
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath()
    })
    if (!plan.apply) return
    if (process.platform === 'darwin') {
      // macOS 的 Dock 图标只能这样设;BrowserWindow.icon 在 macOS 无效
      if (app.dock) app.dock.setIcon(plan.path)
    } else {
      win.setIcon(plan.path)
    }
  }

  const spawnMainWindow = (): void => {
    const win = createMainWindow(ptyManagerRef ?? undefined)
    applyAppIcon(win)
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

      const { updaterHandle } = registerIpc({
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
        env: shellEnv(process.env as Record<string, string>),
        platform: process.platform
      })
      ptyManagerRef = ptyManager

      registerPtyIpc(ptyManager, settingsStore, () => detectShells(createNodeShellProbe()))

      spawnMainWindow()

      if (settingsStore.get().checkUpdateOnLaunch) {
        setTimeout(() => updaterHandle.checkOnLaunch(), 3000)
      }

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
