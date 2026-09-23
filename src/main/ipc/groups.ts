import { ipcMain } from 'electron'
import type { ScriptsStore } from '../store/scripts'

export function registerGroupIpc(store: ScriptsStore): void {
  ipcMain.handle('group:list', () => store.listGroups())
  ipcMain.handle('group:create', (_event, payload: { name: string; parentId?: string | null }) =>
    store.createGroup(payload.name, payload.parentId ?? null)
  )
  ipcMain.handle('group:update', (_event, payload: { id: string; name: string }) =>
    store.updateGroup(payload.id, payload.name)
  )

  // 删除目录一律级联:连带目录树下全部子目录与脚本;后果由渲染层确认框二次确认
  ipcMain.handle('group:delete', (_event, payload: { id: string }) => {
    store.deleteGroup(payload.id)
  })

  ipcMain.handle('group:move', (_event, payload: { id: string; parentId: string | null }) =>
    store.moveGroup(payload.id, payload.parentId ?? null)
  )

  ipcMain.handle('group:reorder', (_event, payload: { ids: string[] }) => {
    store.reorderGroups(payload.ids)
  })
}
