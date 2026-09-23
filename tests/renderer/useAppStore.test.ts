import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Script } from '../../src/shared/types'
import { useAppStore } from '../../src/renderer/src/store/useAppStore'

/**
 * openTabs / selectScript / closeTab / requestTabClose / saveScriptContent / reload
 * 的纯状态逻辑测试。不渲染组件,不需要 jsdom shim,只 mock window.api 走 IPC 往返。
 * (页签关闭确认的完整交互在 tabCloseGuard.test.tsx)
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
    contentFocusRequest: null,
    tabCloseRequest: null,
    alwaysDiscardTabClose: false
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

describe('requestTabClose(页签关闭的唯一入口,TabCloseGuard 消费)', () => {
  it('过滤掉未打开的页签后发请求,每次请求都是新对象', () => {
    useAppStore.setState({ openTabs: ['a', 'b'], tabCloseRequest: null })

    useAppStore.getState().requestTabClose(['a', 'ghost', 'b'])
    expect(useAppStore.getState().tabCloseRequest).toEqual({ ids: ['a', 'b'] })
  })

  it('没有有效 id 时不发请求(保持上一次请求不变)', () => {
    useAppStore.setState({ openTabs: ['a'], tabCloseRequest: null })

    useAppStore.getState().requestTabClose(['ghost'])
    expect(useAppStore.getState().tabCloseRequest).toBeNull()
  })

  it('clearTabCloseRequest 清掉请求', () => {
    useAppStore.setState({ openTabs: ['a'] })
    useAppStore.getState().requestTabClose(['a'])

    useAppStore.getState().clearTabCloseRequest()

    expect(useAppStore.getState().tabCloseRequest).toBeNull()
  })
})

describe('saveScriptContent(内容面板 Cmd/Ctrl+S 与页签关闭确认共用)', () => {
  function mockSaveApi(
    script: Script,
    update: ReturnType<typeof vi.fn>
  ): void {
    ;(window as unknown as { api: unknown }).api = {
      scripts: { list: vi.fn(async () => [script]), update },
      groups: { list: vi.fn(async () => []) }
    }
  }

  it('有草稿且不等于已存内容:按草稿值走 IPC 更新,reload 后清掉草稿', async () => {
    const script = makeScript('a')
    const update = vi.fn(async () => script)
    mockSaveApi(script, update)
    useAppStore.setState({ scripts: [script], contentDrafts: { a: 'echo changed' } })

    await useAppStore.getState().saveScriptContent('a')

    expect(update).toHaveBeenCalledWith('a', { content: 'echo changed' })
    expect(useAppStore.getState().contentDrafts).toEqual({})
  })

  it('保存往返期间草稿又变了(继续输入):新输入作为未保存增量保留', async () => {
    const script = makeScript('a')
    const update = vi.fn(async () => {
      // 模拟 IPC 在途时用户继续输入:草稿从 v1 变到 v2
      useAppStore.setState({ contentDrafts: { a: 'echo v2' } })
      return script
    })
    mockSaveApi(script, update)
    useAppStore.setState({ scripts: [script], contentDrafts: { a: 'echo v1' } })

    await useAppStore.getState().saveScriptContent('a')

    // 落盘的是发起保存那一刻的值,飞行期间的新输入留在草稿里
    expect(update).toHaveBeenCalledWith('a', { content: 'echo v1' })
    expect(useAppStore.getState().contentDrafts).toEqual({ a: 'echo v2' })
  })

  it('没有草稿或草稿等于已存内容:空操作,不发 IPC', async () => {
    const script = makeScript('a')
    const update = vi.fn(async () => script)
    mockSaveApi(script, update)
    useAppStore.setState({ scripts: [script], contentDrafts: { a: 'echo a' } })

    await useAppStore.getState().saveScriptContent('a')
    expect(update).not.toHaveBeenCalled()

    useAppStore.setState({ contentDrafts: {} })
    await useAppStore.getState().saveScriptContent('a')
    expect(update).not.toHaveBeenCalled()
  })

  it('保存失败:错误原样上抛,草稿保留由调用方处置', async () => {
    const script = makeScript('a')
    const update = vi.fn(async () => {
      throw new Error('boom')
    })
    mockSaveApi(script, update)
    useAppStore.setState({ scripts: [script], contentDrafts: { a: 'echo changed' } })

    await expect(useAppStore.getState().saveScriptContent('a')).rejects.toThrow('boom')
    expect(useAppStore.getState().contentDrafts).toEqual({ a: 'echo changed' })
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

  it('选中的页签在中间被删时,落点与 closeTab 同语义:同位置的右邻', async () => {
    // 磁盘上只剩 a、c;b 已删且是当前选中,remaining = [a, c],b 原位置 1 → 落 c
    mockApi([makeScript('a'), makeScript('c')])
    useAppStore.setState({ selectedScriptId: 'b', openTabs: ['a', 'b', 'c'] })

    await useAppStore.getState().reload()

    expect(useAppStore.getState().selectedScriptId).toBe('c')
  })
})

describe('clearAllContentDrafts', () => {
  it('清空全部草稿(导入配置整体覆盖脚本后调用,防旧草稿覆盖导入内容)', () => {
    useAppStore.setState({ contentDrafts: { a: 'echo a', b: 'echo b' } })

    useAppStore.getState().clearAllContentDrafts()

    expect(useAppStore.getState().contentDrafts).toEqual({})
  })
})
