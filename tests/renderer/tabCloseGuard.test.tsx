import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Script } from '../../src/shared/types'
import { installJsdomShims } from './jsdomShims'

// CodeMirror 在 jsdom 里跑不动;这里只关心页签关闭流程,用替身隔离编辑器
vi.mock('../../src/renderer/src/components/ScriptEditor', () => ({
  ScriptEditor: ({ value }: { value: string }): JSX.Element => (
    <textarea data-testid="editor" value={value} readOnly />
  )
}))

// import App 会把整条依赖图带进模块加载期,TerminalDock → TerminalView →
// @xterm/xterm 在模块作用域就调 canvas.getContext,jsdom 未实现会刷 stderr;
// 本用例不碰终端区,按 scriptDetailTabs 用例同款替身截断这条链
vi.mock('../../src/renderer/src/components/TerminalDock', () => ({
  TerminalDock: (): JSX.Element => <div />
}))

import { ScriptDetail } from '../../src/renderer/src/App'
import { TabCloseGuard } from '../../src/renderer/src/components/TabCloseGuard'
import { useAppStore } from '../../src/renderer/src/store/useAppStore'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'

function makeScript(id: string, content: string): Script {
  return {
    id,
    name: `脚本-${id}`,
    content,
    groupId: null,
    shellId: 'bash',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

const s1 = makeScript('s1', 'echo s1')
const s2 = makeScript('s2', 'echo s2')

interface ApiMock {
  update: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

let api: ApiMock

beforeEach(() => {
  installJsdomShims()
  api = {
    // update 返回脚本本身;个别用例会覆写实现
    update: vi.fn(async () => s1),
    list: vi.fn(async () => [s1, s2])
  }
  ;(window as unknown as { api: unknown }).api = {
    scripts: {
      list: api.list,
      update: api.update,
      create: vi.fn(),
      remove: vi.fn(),
      duplicate: vi.fn(),
      reorder: vi.fn()
    },
    groups: { list: vi.fn(async () => []) },
    app: { info: vi.fn(async () => ({ version: '0.8.1', repo: '', platform: 'linux', packaged: false })) }
  }
})

afterEach(() => {
  cleanup()
})

/** 弹窗处于关闭态:wrap 从未挂载,或已带 display:none(antd 关闭后骨架仍留在 DOM,
    关闭后用 queryByText 会误命中隐藏文本,必须看 wrap 的内联样式) */
const isModalClosed = (): boolean => {
  const wrap = document.querySelector('.ant-modal-wrap') as HTMLElement | null
  return wrap === null || wrap.style.display === 'none'
}

const state = (): {
  openTabs: string[]
  selectedScriptId: string | null
  contentDrafts: Record<string, string>
  alwaysDiscardTabClose: boolean
} => useAppStore.getState()

const closeTabButton = (name: string): HTMLElement => screen.getByLabelText(`关闭页签 ${name}`)

interface Setup {
  drafts: Record<string, string>
  openTabs: string[]
  selectedScriptId: string | null
}

function renderGuarded({ drafts, openTabs, selectedScriptId }: Setup): void {
  useAppStore.setState({
    scripts: [s1, s2],
    groups: [],
    selectedScriptId,
    openTabs,
    form: { type: 'none' },
    contentDrafts: drafts,
    contentFocusRequest: null,
    tabCloseRequest: null,
    alwaysDiscardTabClose: false
  })
  render(
    <ThemeProvider mode="light" onModeChange={() => undefined}>
      <ScriptDetail />
      <TabCloseGuard />
    </ThemeProvider>
  )
}

describe('关闭单个页签(X 按钮)', () => {
  it('干净的页签直接关,不弹确认', () => {
    renderGuarded({ drafts: {}, openTabs: ['s1'], selectedScriptId: 's1' })

    fireEvent.click(closeTabButton('脚本-s1'))

    expect(state().openTabs).toEqual([])
    expect(isModalClosed()).toBe(true)
  })

  it('带未保存草稿的页签:弹「保存更改？」确认框,页签暂不关闭', () => {
    renderGuarded({ drafts: { s1: 'echo changed' }, openTabs: ['s1'], selectedScriptId: 's1' })

    fireEvent.click(closeTabButton('脚本-s1'))

    expect(screen.getByText('保存更改？')).toBeTruthy()
    // 正文含脚本名(name 与说明文字分属不同节点,顺带断言文案结构)
    expect(screen.getByText(/有未保存的更改/).textContent).toContain('脚本-s1')
    expect(state().openTabs).toEqual(['s1'])
  })

  it('不保存:丢弃草稿并关闭页签,不走保存', () => {
    renderGuarded({ drafts: { s1: 'echo changed' }, openTabs: ['s1'], selectedScriptId: 's1' })
    fireEvent.click(closeTabButton('脚本-s1'))

    fireEvent.click(screen.getByRole('button', { name: '不保存' }))

    expect(state().openTabs).toEqual([])
    expect(state().contentDrafts).toEqual({})
    expect(api.update).not.toHaveBeenCalled()
    expect(isModalClosed()).toBe(true)
  })

  it('Cancel:页签与草稿都原样保留,弹窗收起', async () => {
    renderGuarded({ drafts: { s1: 'echo changed' }, openTabs: ['s1'], selectedScriptId: 's1' })
    fireEvent.click(closeTabButton('脚本-s1'))

    // antd 对恰好两个汉字的按钮自动插空格(autoInsertSpace),可访问名实际是「取 消」
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))

    await waitFor(() => expect(isModalClosed()).toBe(true))
    expect(state().openTabs).toEqual(['s1'])
    expect(state().contentDrafts).toEqual({ s1: 'echo changed' })
  })

  it('保存更改:按草稿值走 IPC 保存,成功后清草稿并关页签', async () => {
    renderGuarded({ drafts: { s1: 'echo changed' }, openTabs: ['s1'], selectedScriptId: 's1' })
    fireEvent.click(closeTabButton('脚本-s1'))

    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(state().openTabs).toEqual([]))
    expect(api.update).toHaveBeenCalledWith('s1', { content: 'echo changed' })
    expect(state().contentDrafts).toEqual({})
  })

  it('Save 失败:页签保留、草稿保留,弹窗收起', async () => {
    api.update.mockRejectedValueOnce(new Error('boom'))
    renderGuarded({ drafts: { s1: 'echo changed' }, openTabs: ['s1'], selectedScriptId: 's1' })
    fireEvent.click(closeTabButton('脚本-s1'))

    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(isModalClosed()).toBe(true))
    expect(state().openTabs).toEqual(['s1'])
    expect(state().contentDrafts).toEqual({ s1: 'echo changed' })
  })

  it('草稿改了又改回原样:不算未保存,直接关不弹窗', () => {
    renderGuarded({ drafts: { s1: 'echo s1' }, openTabs: ['s1'], selectedScriptId: 's1' })

    fireEvent.click(closeTabButton('脚本-s1'))

    expect(state().openTabs).toEqual([])
    expect(isModalClosed()).toBe(true)
  })

  it('Esc 关闭弹窗等价 Cancel:页签与草稿保留', async () => {
    renderGuarded({ drafts: { s1: 'echo changed' }, openTabs: ['s1'], selectedScriptId: 's1' })
    fireEvent.click(closeTabButton('脚本-s1'))
    expect(screen.getByText('保存更改？')).toBeTruthy()

    fireEvent.keyDown(document.querySelector('.ant-modal')!, { key: 'Escape', keyCode: 27 })

    await waitFor(() => expect(isModalClosed()).toBe(true))
    expect(state().openTabs).toEqual(['s1'])
    expect(state().contentDrafts).toEqual({ s1: 'echo changed' })
  })
})

describe('始终丢弃勾选(会话级)', () => {
  it('勾选后点动作按钮:后续再关脏页签直接静默丢弃,不再弹窗', async () => {
    renderGuarded({
      drafts: { s1: 'echo v1', s2: 'echo v2' },
      openTabs: ['s1', 's2'],
      selectedScriptId: 's1'
    })
    fireEvent.click(closeTabButton('脚本-s1'))

    // 勾选始终丢弃并丢弃 s1:只影响本次请求,s2 保持原样
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '不保存' }))
    await waitFor(() => expect(isModalClosed()).toBe(true))
    expect(state().openTabs).toEqual(['s2'])
    expect(state().contentDrafts).toEqual({ s2: 'echo v2' })
    expect(state().alwaysDiscardTabClose).toBe(true)

    // 再关 s2:会话级偏好已生效,不再弹窗,直接丢弃关闭
    fireEvent.click(closeTabButton('脚本-s2'))
    await waitFor(() => expect(state().openTabs).toEqual([]))
    expect(state().contentDrafts).toEqual({})
    expect(api.update).not.toHaveBeenCalled()
    expect(isModalClosed()).toBe(true)
  })

  it('勾选后点 Cancel:偏好不生效,再关仍是弹窗确认', async () => {
    renderGuarded({
      drafts: { s1: 'echo v1', s2: 'echo v2' },
      openTabs: ['s1', 's2'],
      selectedScriptId: 's1'
    })
    fireEvent.click(closeTabButton('脚本-s1'))

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    await waitFor(() => expect(isModalClosed()).toBe(true))
    expect(state().alwaysDiscardTabClose).toBe(false)
    expect(state().openTabs).toEqual(['s1', 's2'])

    // 再关 s1:仍然弹窗(勾选没被记住)
    fireEvent.click(closeTabButton('脚本-s1'))
    expect(screen.getByText('保存更改？')).toBeTruthy()
  })
})

describe('批量关闭(队列语义,经 requestTabClose)', () => {
  it('关闭全部:干净页签直接关,脏页签逐个弹确认,依次处理到清空', async () => {
    renderGuarded({
      drafts: { s2: 'echo v2' },
      openTabs: ['s1', 's2'],
      selectedScriptId: 's1'
    })

    act(() => useAppStore.getState().requestTabClose(['s1', 's2']))

    // s1 干净立即关;s2 脏,弹确认并停住
    await waitFor(() => expect(state().openTabs).toEqual(['s2']))
    expect(screen.getByText('保存更改？')).toBeTruthy()
    expect(screen.getByText(/有未保存的更改/).textContent).toContain('脚本-s2')

    fireEvent.click(screen.getByRole('button', { name: '不保存' }))
    await waitFor(() => expect(state().openTabs).toEqual([]))
    expect(state().contentDrafts).toEqual({})
  })

  it('批量队列里 Cancel:中止剩余关闭,未决页签保留', async () => {
    renderGuarded({
      drafts: { s1: 'echo v1', s2: 'echo v2' },
      openTabs: ['s1', 's2'],
      selectedScriptId: 's1'
    })

    act(() => useAppStore.getState().requestTabClose(['s1', 's2']))

    await waitFor(() => expect(screen.getByText('保存更改？')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))

    await waitFor(() => expect(isModalClosed()).toBe(true))
    expect(state().openTabs).toEqual(['s1', 's2'])
    expect(state().contentDrafts).toEqual({ s1: 'echo v1', s2: 'echo v2' })
  })

  it('批量队列里 Save 失败:失败页签保留,后续页签不再处理', async () => {
    renderGuarded({
      drafts: { s1: 'echo v1', s2: 'echo v2' },
      openTabs: ['s1', 's2'],
      selectedScriptId: 's1'
    })

    act(() => useAppStore.getState().requestTabClose(['s1', 's2']))
    await waitFor(() => expect(screen.getByText('保存更改？')).toBeTruthy())
    expect(screen.getByText(/有未保存的更改/).textContent).toContain('脚本-s1')

    api.update.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(isModalClosed()).toBe(true))
    expect(state().openTabs).toEqual(['s1', 's2'])
    expect(state().contentDrafts).toEqual({ s1: 'echo v1', s2: 'echo v2' })
  })

  it('批量关闭干净页签:选中按 closeTab 落点逐个右移,最终与批量动作语义一致', () => {
    renderGuarded({
      drafts: {},
      openTabs: ['s1', 's2'],
      selectedScriptId: 's1'
    })

    // 右键菜单「关闭左边」对 s2 的语义 = 关掉它左侧全部;切片由菜单层算好传入
    act(() => useAppStore.getState().requestTabClose(['s1']))

    expect(state().openTabs).toEqual(['s2'])
    expect(state().selectedScriptId).toBe('s2')
    expect(isModalClosed()).toBe(true)
  })
})

describe('右键菜单接线(UI 级)', () => {
  it('页签右键「关闭全部」把全部页签交给守卫处理', async () => {
    renderGuarded({ drafts: {}, openTabs: ['s1', 's2'], selectedScriptId: 's1' })

    // 用 title 定位页签:可访问名里混有关闭按钮的 aria-label,按名字精确匹配会落空
    fireEvent.contextMenu(screen.getByTitle('脚本-s1'))
    fireEvent.click(await screen.findByText('关闭全部'))

    await waitFor(() => expect(state().openTabs).toEqual([]))
    expect(isModalClosed()).toBe(true)
  })
})
