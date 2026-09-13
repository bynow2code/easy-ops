import { ipcMain } from 'electron'
import type { PtyManager } from '../pty/manager'
import type { ShellInfo } from '../../shared/types'
import type { SettingsStore } from '../store/settings'

export function registerPtyIpc(manager: PtyManager, settings: SettingsStore, detect: () => Promise<ShellInfo[]>): void {
  const resolveShell = async (scriptShellId: string | null): Promise<ShellInfo> => {
    const shells = await detect()
    const wanted = scriptShellId ?? settings.get().shellId
    const found = wanted ? shells.find((s) => s.id === wanted) : undefined
    if (found) return found
    const fallback = shells[0]
    if (!fallback) throw new Error('未检测到可用的 shell,请在设置中配置')
    return fallback
  }

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
