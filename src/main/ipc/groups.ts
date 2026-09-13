import { ipcMain } from 'electron'
import type { ScriptsStore } from '../store/scripts'

export function registerGroupIpc(store: ScriptsStore): void {
  ipcMain.handle('group:list', () => store.listGroups())
  ipcMain.handle('group:create', (_event, payload: { name: string }) => store.createGroup(payload.name))
  ipcMain.handle('group:update', (_event, payload: { id: string; name: string }) =>
    store.updateGroup(payload.id, payload.name)
  )

  ipcMain.handle('group:delete', (_event, payload: { id: string }) => {
    store.deleteGroup(payload.id)
  })

  ipcMain.handle('group:reorder', (_event, payload: { ids: string[] }) => {
    store.reorderGroups(payload.ids)
  })
}
