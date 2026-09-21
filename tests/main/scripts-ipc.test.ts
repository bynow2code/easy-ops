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
import { registerGroupIpc } from '../../src/main/ipc/groups'
import { createScriptsStore, type ScriptsData } from '../../src/main/store/scripts'
import type { Group } from '../../src/shared/types'

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
  registerGroupIpc(store)
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

describe('script:duplicate', () => {
  it('复制脚本,名称加后缀且字段照搬', () => {
    invoke('script:create', { name: '构建', content: 'echo build', groupId: null, shellId: 'bash' })
    const id = data.scripts[0].id

    const copy = invoke('script:duplicate', { id }) as { name: string; shellId: string | null }

    expect(copy.name).toBe('构建 副本')
    expect(copy.shellId).toBe('bash')
    expect(data.scripts).toHaveLength(2)
  })

  it('复制不存在的脚本时抛错', () => {
    expect(() => invoke('script:duplicate', { id: 'nope' })).toThrowError(/不存在/)
  })
})

describe('group:create 的 parentId 透传与 group:move', () => {
  it('group:create 透传 parentId,group:move 校验后落盘', () => {
    const parent = invoke('group:create', { name: '父' }) as Group
    const child = invoke('group:create', { name: '子', parentId: parent.id }) as Group
    expect(child.parentId).toBe(parent.id)

    const g = invoke('group:create', { name: '移动我' }) as Group
    invoke('group:move', { id: g.id, parentId: parent.id })
    const listed = invoke('group:list') as Group[]
    expect(listed.find((x: Group) => x.id === g.id)!.parentId).toBe(parent.id)

    expect(() => invoke('group:move', { id: parent.id, parentId: g.id })).toThrowError(/子目录/)
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
