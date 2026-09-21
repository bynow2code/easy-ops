import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Script } from '../../src/shared/types'
import { useAppStore } from '../../src/renderer/src/store/useAppStore'

/**
 * openTabs / selectScript / closeTab / reload 的纯状态逻辑测试。
 * 不渲染组件,不需要 jsdom shim,只 mock window.api 走 IPC 往返。
 */

function makeScript(id: string, groupId: string | null = null): Script {
  return {
    id,
    name: `脚本-${id}`,
    content: `echo ${id}`,
    groupId,
    shellId: 'bash',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function mockApi(scripts: Script[]): void {
  ;(window as unknown as { api: unknown }).api = {
    scripts: { list: vi.fn(async () => scripts) },
    groups: { list: vi.fn(async () => []) }
  }
}

beforeEach(() => {
  useAppStore.setState({
    scripts: [],
    groups: [],
    selectedScriptId: null,
    openTabs: [],
    form: { type: 'none' },
    loading: false,
    search: '',
    contentDrafts: {},
    contentFocusRequest: null
  })
})

describe('selectScript 的页签行为', () => {
  it('选中即追加页签,重复选中不去重失败、顺序稳定', () => {
    useAppStore.setState({ scripts: [makeScript('a'), makeScript('b')] })

    useAppStore.getState().selectScript('a')
    useAppStore.getState().selectScript('b')
    useAppStore.getState().selectScript('a')

    expect(useAppStore.getState().openTabs).toEqual(['a', 'b'])
    expect(useAppStore.getState().selectedScriptId).toBe('a')
  })

  it('清空选中(selectScript(null))只改选中态,不动已开页签', () => {
    useAppStore.setState({ scripts: [makeScript('a')], selectedScriptId: 'a', openTabs: ['a'] })

    useAppStore.getState().selectScript(null)

    expect(useAppStore.getState().selectedScriptId).toBeNull()
    expect(useAppStore.getState().openTabs).toEqual(['a'])
  })
})

describe('closeTab 的落点逻辑', () => {
  const state = (openTabs: string[], selectedScriptId: string | null): void => {
    useAppStore.setState({ openTabs, selectedScriptId })
  }

  it('关中间的页签,选中落到同位置的下一个', () => {
    state(['a', 'b', 'c'], 'b')
    useAppStore.getState().closeTab('b')
    expect(useAppStore.getState().openTabs).toEqual(['a', 'c'])
    expect(useAppStore.getState().selectedScriptId).toBe('c')
  })

  it('关末尾的页签,选中落到左邻', () => {
    state(['a', 'b', 'c'], 'c')
    useAppStore.getState().closeTab('c')
    expect(useAppStore.getState().selectedScriptId).toBe('b')
  })

  it('关唯一一个页签,清空选中', () => {
    state(['a'], 'a')
    useAppStore.getState().closeTab('a')
    expect(useAppStore.getState().openTabs).toEqual([])
    expect(useAppStore.getState().selectedScriptId).toBeNull()
  })

  it('关掉的不是当前选中页签时,选中态不变', () => {
    state(['a', 'b'], 'a')
    useAppStore.getState().closeTab('b')
    expect(useAppStore.getState().selectedScriptId).toBe('a')
  })

  it('closeTab 对不存在的页签是幂等空操作', () => {
    state(['a'], 'a')
    useAppStore.getState().closeTab('nope')
    expect(useAppStore.getState().openTabs).toEqual(['a'])
    expect(useAppStore.getState().selectedScriptId).toBe('a')
  })
})

describe('reload 与页签/选中/草稿的一致性', () => {
  it('脚本被删后:页签过滤、选中失效时回落到第一个剩余页签', async () => {
    // 磁盘上只剩 c;A、B 已被删,当前选中是 B
    mockApi([makeScript('c')])
    useAppStore.setState({
      selectedScriptId: 'b',
      openTabs: ['a', 'b', 'c'],
      contentDrafts: { a: 'echo draft-a', c: 'echo draft-c' }
    })

    await useAppStore.getState().reload()

    const state = useAppStore.getState()
    expect(state.openTabs).toEqual(['c'])
    expect(state.selectedScriptId).toBe('c')
  })

  it('选中仍然有效时,reload 不改变选中态', async () => {
    mockApi([makeScript('a'), makeScript('b')])
    useAppStore.setState({ selectedScriptId: 'b', openTabs: ['a', 'b'] })

    await useAppStore.getState().reload()

    const state = useAppStore.getState()
    expect(state.selectedScriptId).toBe('b')
    expect(state.openTabs).toEqual(['a', 'b'])
  })

  it('被删脚本的孤儿草稿被清掉,幸存脚本的草稿保留', async () => {
    mockApi([makeScript('a')])
    useAppStore.setState({
      openTabs: ['a', 'b'],
      contentDrafts: { a: 'keep', b: 'drop' }
    })

    await useAppStore.getState().reload()

    expect(useAppStore.getState().contentDrafts).toEqual({ a: 'keep' })
  })

  it('所有页签对应的脚本都被删光时,详情区回到空态', async () => {
    mockApi([])
    useAppStore.setState({ selectedScriptId: 'a', openTabs: ['a'] })

    await useAppStore.getState().reload()

    const state = useAppStore.getState()
    expect(state.openTabs).toEqual([])
    expect(state.selectedScriptId).toBeNull()
  })
})
