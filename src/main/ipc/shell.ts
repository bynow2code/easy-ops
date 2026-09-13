import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { createNodeShellProbe, detectShells, isValidShellPath } from '../pty/shell'
import type { SettingsStore } from '../store/settings'

export function registerShellIpc(getWindow: () => BrowserWindow | null, settings: SettingsStore): void {
  ipcMain.handle('shell:detect', async () => {
    const probe = createNodeShellProbe()
    const detected = await detectShells(probe)
    const custom = settings.get().customShells.map((s) => ({
      id: s.id,
      name: s.name,
      path: s.path,
      args: ['-i'],
      source: 'custom' as const
    }))
    return [...detected, ...custom]
  })

  ipcMain.handle('shell:validate', async (_event, payload: { path: string }) => {
    const probe = createNodeShellProbe()
    return isValidShellPath(payload.path, probe)
  })

  ipcMain.handle('shell:browse', async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile', 'showHiddenFiles'] })
      : await dialog.showOpenDialog({ properties: ['openFile', 'showHiddenFiles'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
