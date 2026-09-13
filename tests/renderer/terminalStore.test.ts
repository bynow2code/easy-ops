import { beforeEach, describe, expect, it } from 'vitest'
import { terminalActions, useTerminalStore } from '../../src/renderer/src/store/useTerminalStore'

beforeEach(() => {
  useTerminalStore.setState({ sessions: [], activeRunId: null, maximizedRunId: null })
})

describe('终端列表', () => {
  it('新增终端后出现在列表中', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    expect(terminalActions.get().sessions).toHaveLength(1)
    expect(terminalActions.get().sessions[0].title).toBe('a')
  })

  it('新增后自动成为活动终端', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('移除终端后活动项切换到剩余的第一个', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.remove('r2')
    expect(terminalActions.get().sessions.map((s) => s.runId)).toEqual(['r1'])
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('移除最后一个终端后活动项为 null', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.remove('r1')
    expect(terminalActions.get().sessions).toHaveLength(0)
    expect(terminalActions.get().activeRunId).toBeNull()
  })

  it('标记退出后保留终端但记录退出码', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.markExited('r1', 0)
    expect(terminalActions.get().sessions).toHaveLength(1)
    expect(terminalActions.get().sessions[0].exited).toBe(true)
    expect(terminalActions.get().sessions[0].exitCode).toBe(0)
  })

  it('切换活动终端', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.setActive('r1')
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('最大化状态按 runId 记录,取消后清空', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.setMaximized('r1', true)
    expect(terminalActions.get().maximizedRunId).toBe('r1')
    terminalActions.setMaximized('r2', true)
    expect(terminalActions.get().maximizedRunId).toBe('r2')
    terminalActions.setMaximized('r2', false)
    expect(terminalActions.get().maximizedRunId).toBeNull()
  })
})
