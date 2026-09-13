import { contextBridge, ipcRenderer } from 'electron'
import type { Group, Script, Settings } from '../shared/types'

const api = {
  app: {
    info: (): Promise<{ version: string; repo: string; platform: string }> => ipcRenderer.invoke('app:info'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', { url })
  },
  scripts: {
    list: (): Promise<Script[]> => ipcRenderer.invoke('script:list'),
    create: (input: { name: string; content: string; groupId: string | null }): Promise<Script> =>
      ipcRenderer.invoke('script:create', input),
    update: (id: string, patch: Partial<Script>): Promise<Script> => ipcRenderer.invoke('script:update', { id, patch }),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('script:delete', { id }),
    reorder: (ids: string[]): Promise<void> => ipcRenderer.invoke('script:reorder', { ids })
  },
  groups: {
    list: (): Promise<Group[]> => ipcRenderer.invoke('group:list'),
    create: (name: string): Promise<Group> => ipcRenderer.invoke('group:create', { name }),
    update: (id: string, name: string): Promise<Group> => ipcRenderer.invoke('group:update', { id, name }),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('group:delete', { id }),
    reorder: (ids: string[]): Promise<void> => ipcRenderer.invoke('group:reorder', { ids })
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', { patch })
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
