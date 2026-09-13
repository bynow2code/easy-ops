import { contextBridge, ipcRenderer } from 'electron'
import type { Group, Script, Settings, ShellInfo } from '../shared/types'

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
  shell: {
    detect: (): Promise<ShellInfo[]> => ipcRenderer.invoke('shell:detect'),
    validate: (path: string): Promise<{ valid: boolean; version?: string; reason?: string }> =>
      ipcRenderer.invoke('shell:validate', { path }),
    browse: (): Promise<string | null> => ipcRenderer.invoke('shell:browse')
  },
  pty: {
    start: (input: { scriptId: string; scriptName: string; content: string; shellId: string | null }): Promise<{
      runId: string
      title: string
    }> => ipcRenderer.invoke('pty:start', input),
    write: (runId: string, data: string): Promise<void> => ipcRenderer.invoke('pty:write', { runId, data }),
    resize: (runId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('pty:resize', { runId, cols, rows }),
    close: (runId: string): Promise<void> => ipcRenderer.invoke('pty:close', { runId }),
    closeAll: (): Promise<void> => ipcRenderer.invoke('pty:closeAll'),
    onData: (listener: (payload: { runId: string; chunk: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: { runId: string; chunk: string }): void => listener(payload)
      ipcRenderer.on('pty:data', handler)
      return () => ipcRenderer.removeListener('pty:data', handler)
    },
    onExit: (listener: (payload: { runId: string; exitCode: number; signal: number | null }) => void): (() => void) => {
      const handler = (_e: unknown, payload: { runId: string; exitCode: number; signal: number | null }): void =>
        listener(payload)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    }
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', { patch })
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
