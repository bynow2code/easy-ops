import { ipcMain } from 'electron'
import type { PtyManager } from '../pty/manager'
import { createShellResolver } from '../pty/shellResolver'
import type { ShellInfo } from '../../shared/types'
import type { SettingsStore } from '../store/settings'

export function registerPtyIpc(manager: PtyManager, settings: SettingsStore, detect: () => Promise<ShellInfo[]>): void {
  const resolveShell = createShellResolver({
    detect,
    getCustomShells: () => settings.get().customShells,
    getPreferredShellId: () => settings.get().shellId
  })

  ipcMain.handle(
    'pty:start',
    async (_event, payload: { scriptId: string; scriptName: string; content: string; shellId: string | null }) => {
      const shell = await resolveShell(payload.shellId)
      return manager.start({
        scriptId: payload.scriptId,
        scriptName: payload.scriptName,
        content: payload.content,
        shell: { path: shell.path, args: shell.args }
      })
    }
  )

  ipcMain.handle('pty:write', (_event, payload: { runId: string; data: string }) => {
    manager.write(payload.runId, payload.data)
  })

  ipcMain.handle('pty:resize', (_event, payload: { runId: string; cols: number; rows: number }) => {
    manager.resize(payload.runId, payload.cols, payload.rows)
  })

  ipcMain.handle('pty:close', async (_event, payload: { runId: string }) => {
    await manager.close(payload.runId)
  })

  ipcMain.handle('pty:closeAll', async () => {
    await manager.closeAll()
  })
}
