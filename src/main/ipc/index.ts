import { app, ipcMain, type BrowserWindow } from 'electron'
import type { Settings } from '../../shared/types'
import type { ScriptsStore } from '../store/scripts'
import type { SettingsStore } from '../store/settings'
import { registerGroupIpc } from './groups'
import { registerConfigIpc } from './config'
import { registerScriptIpc } from './scripts'
import { registerShellIpc } from './shell'

export interface IpcContext {
  scripts: ScriptsStore
  settings: SettingsStore
  getWindow: () => BrowserWindow | null
  repoUrl: string
}

export function registerIpc(ctx: IpcContext): void {
  registerScriptIpc(ctx.scripts)
  registerGroupIpc(ctx.scripts)
  registerShellIpc(ctx.getWindow, ctx.settings)
  registerConfigIpc({ getWindow: ctx.getWindow, scripts: ctx.scripts, settings: ctx.settings })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    repo: ctx.repoUrl,
    platform: process.platform
  }))

  ipcMain.handle('app:openExternal', async (_event, payload: { url: string }) => {
    const { shell } = await import('electron')
    if (/^https?:\/\//i.test(payload.url)) await shell.openExternal(payload.url)
  })

  ipcMain.handle('settings:get', () => ctx.settings.get())
  ipcMain.handle('settings:update', (_event, payload: { patch: Partial<Settings> }) => ctx.settings.update(payload.patch))
}
