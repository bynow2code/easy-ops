import { app, ipcMain, type BrowserWindow } from 'electron'
import type { Settings } from '../../shared/types'
import type { ScriptsStore } from '../store/scripts'
import type { SettingsStore } from '../store/settings'
import { registerGroupIpc } from './groups'
import { registerConfigIpc } from './config'
import { registerScriptIpc } from './scripts'
import { registerShellIpc } from './shell'
import { registerUpdaterIpc } from './updater'

export interface IpcContext {
  scripts: ScriptsStore
  settings: SettingsStore
  getWindow: () => BrowserWindow | null
  repoUrl: string
}

export function registerIpc(ctx: IpcContext): { updaterHandle: ReturnType<typeof registerUpdaterIpc> } {
  registerScriptIpc(ctx.scripts)
  registerGroupIpc(ctx.scripts)
  registerShellIpc(ctx.getWindow, ctx.settings)
  registerConfigIpc({ getWindow: ctx.getWindow, scripts: ctx.scripts, settings: ctx.settings })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    repo: ctx.repoUrl,
    platform: process.platform,
    // 渲染层用这个区分 dev / 打包:未保存草稿的关窗拦截只在打包版开启,
    // dev 下 HMR 的整页刷新会频繁触发 beforeunload,不能被它烦到
    packaged: app.isPackaged
  }))

  ipcMain.handle('app:openExternal', async (_event, payload: { url: string }) => {
    const { shell } = await import('electron')
    if (/^https?:\/\//i.test(payload.url)) await shell.openExternal(payload.url)
  })

  ipcMain.handle('settings:get', () => ctx.settings.get())
  ipcMain.handle('settings:update', (_event, payload: { patch: Partial<Settings> }) => ctx.settings.update(payload.patch))

  const updaterHandle = registerUpdaterIpc(ctx.getWindow)
  return { updaterHandle }
}
