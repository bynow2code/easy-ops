import { beforeEach, describe, expect, it, vi } from 'vitest'

// 主进程 IPC 依赖 electron,这里把它换成可控的 handler 表,直接调用注册进去的处理函数
vi.mock('electron', () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  return {
    __handlers: handlers,
    ipcMain: {
      handle: (channel: string, fn: (...args: any[]) => any) => {
        handlers.set(channel, fn)
      }
    }
  }
})

import * as electronMock from 'electron'
import { registerScriptIpc } from '../../src/main/ipc/scripts'
import { createScriptsStore, type ScriptsData } from '../../src/main/store/scripts'

const mock = electronMock as unknown as { __handlers: Map<string, (...args: any[]) => any> }

let data: ScriptsData
let invoke: (channel: string, payload?: unknown) => unknown

beforeEach(() => {
  mock.__handlers.clear()
  data = { scripts: [], groups: [] }
  const store = createScriptsStore({
    read: () => data,
    write: (next) => {
      data = next
    }
  })
  registerScriptIpc(store)
  invoke = (channel, payload) =>
    mock.__handlers.get(channel)!(null, payload) as unknown
})

describe('script:create 的 shellId 透传', () => {
  it('渲染层传来的脚本级 shell 会落到 store', () => {
    invoke('script:create', { name: 'a', content: 'echo a', groupId: null, shellId: 'zsh' })

    expect(data.scripts).toHaveLength(1)
    expect(data.scripts[0].shellId).toBe('zsh')
  })

  it('未指定 shell 时落 null,表示跟随全局', () => {
    invoke('script:create', { name: 'a', content: 'echo a', groupId: null, shellId: null })

    expect(data.scripts[0].shellId).toBeNull()
  })
})

describe('script:update 的字段白名单', () => {
  it('接受 shellId,置 null 表示清空覆盖', () => {
    invoke('script:create', { name: 'a', content: 'echo a', groupId: null, shellId: 'zsh' })
    const id = data.scripts[0].id

    invoke('script:update', { id, patch: { shellId: 'bash' } })
    expect(data.scripts[0].shellId).toBe('bash')

    invoke('script:update', { id, patch: { shellId: null } })
    expect(data.scripts[0].shellId).toBeNull()
  })

  it('白名单外的字段被丢弃,不能借 patch 改写 id / order', () => {
    invoke('script:create', { name: 'a', content: 'echo a', groupId: null })
    const id = data.scripts[0].id

    invoke('script:update', { id, patch: { name: 'b', order: 99, id: 'hack' } })

    expect(data.scripts[0].name).toBe('b')
    expect(data.scripts[0].order).toBe(0)
    expect(data.scripts[0].id).toBe(id)
  })
})
