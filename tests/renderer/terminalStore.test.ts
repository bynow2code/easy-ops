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

  it('新增终端插到列表最顶部(最新在最上)', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.add({ runId: 'r3', title: 'c', scriptId: 's3' })
    expect(terminalActions.get().sessions.map((s) => s.runId)).toEqual(['r3', 'r2', 'r1'])
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

describe('批量移除终端', () => {
  /** 铺三张卡片:r3 在最上(最新),r1 在最下,与 add 的插入顺序语义一致 */
  const seedThree = (): void => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.add({ runId: 'r3', title: 'c', scriptId: 's3' })
  }

  it('一次移除多个,未列出的会话原样保留', () => {
    seedThree()
    terminalActions.removeMany(['r1', 'r3'])
    expect(terminalActions.get().sessions.map((s) => s.runId)).toEqual(['r2'])
  })

  it('活动项被移除时回落到剩余的第一个', () => {
    seedThree()
    terminalActions.setActive('r3')
    terminalActions.removeMany(['r2', 'r3'])
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('活动项不在移除集合里就保持不变', () => {
    seedThree()
    terminalActions.setActive('r1')
    terminalActions.removeMany(['r2', 'r3'])
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('最大化项被移除时清空最大化状态', () => {
    seedThree()
    terminalActions.setMaximized('r1', true)
    terminalActions.removeMany(['r1', 'r2'])
    expect(terminalActions.get().maximizedRunId).toBeNull()
  })

  it('最大化项不在移除集合里就继续保持最大化', () => {
    seedThree()
    terminalActions.setMaximized('r1', true)
    terminalActions.removeMany(['r2', 'r3'])
    expect(terminalActions.get().maximizedRunId).toBe('r1')
  })

  it('空数组不产生新的状态对象(避免无意义渲染)', () => {
    seedThree()
    const before = useTerminalStore.getState()
    terminalActions.removeMany([])
    // 同一引用 = zustand 不会通知订阅者
    expect(useTerminalStore.getState()).toBe(before)
  })

  it('单个 remove 与 removeMany([id]) 结果完全一致 —— 回落规则只有一份', () => {
    seedThree()
    terminalActions.setActive('r2')
    terminalActions.setMaximized('r2', true)
    terminalActions.remove('r2')
    const byOne = useTerminalStore.getState()

    useTerminalStore.setState({ sessions: [], activeRunId: null, maximizedRunId: null })
    seedThree()
    terminalActions.setActive('r2')
    terminalActions.setMaximized('r2', true)
    terminalActions.removeMany(['r2'])
    const byMany = useTerminalStore.getState()

    expect(byMany).toEqual(byOne)
  })
})
