import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateEvent } from '../../src/main/updater'

// 主进程模块依赖 electron 与真实网络,这里只验证「事件回放」这条判据链,两者都用可控桩替代
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

let emitRef: ((event: UpdateEvent) => void) | null = null

vi.mock('../../src/main/updater', () => ({
  createUpdater: (emit: (event: UpdateEvent) => void) => {
    emitRef = emit
    return {
      check: async () => undefined,
      download: async () => undefined,
      install: () => undefined
    }
  }
}))

import * as electronMock from 'electron'
import { isReplayableUpdateEvent, registerUpdaterIpc } from '../../src/main/ipc/updater'

const mock = electronMock as unknown as { __handlers: Map<string, (...args: any[]) => any> }

let lastEvent: () => UpdateEvent | null

function emit(event: UpdateEvent): void {
  emitRef!(event)
}

beforeEach(() => {
  mock.__handlers.clear()
  emitRef = null
  registerUpdaterIpc(() => null)
  lastEvent = mock.__handlers.get('update:lastEvent') as () => UpdateEvent | null
})

describe('isReplayableUpdateEvent', () => {
  it('一次检查的结论(available / downloaded / error / not-available)可回放', () => {
    expect(isReplayableUpdateEvent({ status: 'available', version: '0.9.0' })).toBe(true)
    expect(isReplayableUpdateEvent({ status: 'downloaded', version: '0.9.0' })).toBe(true)
    expect(isReplayableUpdateEvent({ status: 'error', message: '检查失败' })).toBe(true)
    expect(isReplayableUpdateEvent({ status: 'not-available' })).toBe(true)
  })

  it('瞬态进度(checking / downloading)不缓存', () => {
    expect(isReplayableUpdateEvent({ status: 'checking' })).toBe(false)
    expect(isReplayableUpdateEvent({ status: 'downloading', percent: 42 })).toBe(false)
  })
})

describe('update:lastEvent', () => {
  it('挂载前没有任何事件时返回 null', () => {
    expect(lastEvent()).toBeNull()
  })

  it('瞬态进度不被缓存,面板打开后不会回放早已结束的「检查中/下载中」', () => {
    emit({ status: 'checking' })
    emit({ status: 'downloading', percent: 100 })
    expect(lastEvent()).toBeNull()
  })

  it('只保留最近一次可回放事件,不会被更早的结论覆盖', () => {
    emit({ status: 'not-available' })
    expect(lastEvent()).toEqual({ status: 'not-available' })

    emit({ status: 'available', version: '0.9.0' })
    expect(lastEvent()).toEqual({ status: 'available', version: '0.9.0' })

    // 结论之后到达的瞬态进度不应把缓存打回旧值
    emit({ status: 'downloading', percent: 10 })
    expect(lastEvent()).toEqual({ status: 'available', version: '0.9.0' })

    emit({ status: 'downloaded', version: '0.9.0' })
    expect(lastEvent()).toEqual({ status: 'downloaded', version: '0.9.0' })
  })

  it('启动时先检查再打开设置面板,仍能取回可回放的结论', () => {
    emit({ status: 'checking' })
    emit({ status: 'error', message: '获取最新版本失败:HTTP 403' })
    expect(lastEvent()).toEqual({ status: 'error', message: '获取最新版本失败:HTTP 403' })
  })
})
