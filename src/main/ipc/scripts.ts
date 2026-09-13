import { ipcMain } from 'electron'
import type { ScriptsStore } from '../store/scripts'

export function registerScriptIpc(store: ScriptsStore): void {
  ipcMain.handle('script:list', () => store.listScripts())

  ipcMain.handle('script:create', (_event, input: { name: string; content: string; groupId: string | null }) =>
    store.createScript(input)
  )

  ipcMain.handle('script:update', (_event, payload: { id: string; patch: Record<string, unknown> }) =>
    store.updateScript(payload.id, payload.patch)
  )

  ipcMain.handle('script:delete', (_event, payload: { id: string }) => {
    store.deleteScript(payload.id)
  })

  ipcMain.handle('script:reorder', (_event, payload: { ids: string[] }) => {
    store.reorderScripts(payload.ids)
  })
}
