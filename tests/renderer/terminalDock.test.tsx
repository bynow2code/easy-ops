import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { installJsdomShims } from './jsdomShims'

// xterm 在 jsdom 里跑不起来,且本用例只关心「卡片怎么排布与操作」,用替身隔离。
// active 必须透出来:卡片层不再有视觉标记之后,「谁是激活」只剩这条 prop 往下传
// (它触发 term.focus() → 光标闪烁);mock 把它丢掉的话,删掉传递也不会红
vi.mock('../../src/renderer/src/components/TerminalView', () => ({
  TerminalView: ({ runId, active }: { runId: string; active: boolean }): JSX.Element => (
    <div data-testid={`view-${runId}`} data-active={String(active)} />
  )
}))

import { TerminalDock } from '../../src/renderer/src/components/TerminalDock'
import { useTerminalStore, type TerminalSessionView } from '../../src/renderer/src/store/useTerminalStore'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'

const session = (runId: string, title: string): TerminalSessionView => ({
  runId,
  title,
  scriptId: `s-${runId}`,
  exited: false,
  exitCode: null
})

interface ApiMock {
  pty: Record<string, ReturnType<typeof vi.fn>>
}

function setupApi(): ApiMock {
  const off = (): void => undefined
  const api: ApiMock = {
    pty: {
      onData: vi.fn(() => off),
      onExit: vi.fn(() => off),
      close: vi.fn(async () => undefined),
      closeAll: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined)
    }
  }
  ;(window as unknown as { api: ApiMock }).api = api
  return api
}

function renderDock(): void {
  render(
    <ThemeProvider mode="light" onModeChange={() => undefined}>
      <TerminalDock />
    </ThemeProvider>
  )
}

function iconButtons(name: string): HTMLElement[] {
  return screen.queryAllByLabelText(name).map((icon) => {
    const button = icon.closest('button')
    if (!button) throw new Error(`图标 ${name} 不在 button 内`)
    return button
  })
}

/** 渲染时包一层 antd App：关闭失败分支会调 message.error，无 App 上下文时它是 undefined 会抛 TypeError */
function renderDockInApp(): void {
  render(
    <App>
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <TerminalDock />
      </ThemeProvider>
    </App>
  )
}

/**
 * 菜单项元素（antd 把 role="menuitem" 挂在 .ant-dropdown-menu-item 上）。
 * 必须在菜单浮层内查：「关闭全部」既是菜单项、也是工具条上的按钮，
 * 直接 screen.getByText 会撞成 multiple elements。
 */
function menuItem(label: string): HTMLElement {
  const overlay = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden)')
  if (!overlay) throw new Error('没有可见的菜单浮层')
  const el = Array.from(overlay.querySelectorAll('.ant-dropdown-menu-item')).find(
    (item) => item.textContent?.trim() === label
  )
  if (!el) throw new Error(`菜单项「${label}」不存在`)
  return el as HTMLElement
}

/** 回顶按钮的查询入口(queryBy* 形式:显隐两侧断言都用它) */
function backTopButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: '回到顶部' })
}

/** jsdom 无真实滚动:用数据属性替身改写 scrollTop 再补发 scroll 事件,模拟列表滚动 */
function scrollListTo(list: HTMLDivElement, value: number): void {
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value })
  fireEvent.scroll(list)
}

beforeEach(() => {
  installJsdomShims()
  useTerminalStore.setState({ sessions: [], activeRunId: null, maximizedRunId: null })
})

afterEach(() => {
  cleanup()
})

/** 沿祖先链检查有没有被 display:none 藏起来 —— 瀑布流的判据是「真的看得见」而非「在 DOM 里」 */
function isHiddenByAncestor(element: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node) {
    if (node.style?.display === 'none') return true
    node = node.parentElement
  }
  return false
}

describe('终端瀑布流', () => {
  it('所有终端同时可见,而不是只显示其中一个', () => {
    setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B'), session('r3', 'C')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    renderDock()

    for (const runId of ['r1', 'r2', 'r3']) {
      expect(isHiddenByAncestor(screen.getByTestId(`view-${runId}`))).toBe(false)
    }
  })

  it('终端列表横向只排一列', () => {
    setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B'), session('r3', 'C')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    renderDock()

    expect(screen.getByTestId('terminal-list').style.gridTemplateColumns).toBe('1fr')
  })

  it('每张卡片都带自己的标题与操作按钮', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', '构建'), session('r2', '部署')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()

    expect(screen.getAllByText('构建').length).toBeGreaterThan(0)
    expect(screen.getAllByText('部署').length).toBeGreaterThan(0)
    // 两张卡片各有一个关闭按钮与一个最大化按钮
    expect(iconButtons('close')).toHaveLength(2)
    expect(iconButtons('fullscreen')).toHaveLength(2)
  })

  it('工具条显示终端数量并可关闭全部', async () => {
    const api = setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    expect(screen.getByText('2 个终端')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /关\s?闭\s?全\s?部/ }))

    await waitFor(() => expect(api.pty.closeAll).toHaveBeenCalled())
    expect(useTerminalStore.getState().sessions).toEqual([])
  })

  it('关闭单张卡片只关掉那一个终端', async () => {
    const api = setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    fireEvent.click(iconButtons('close')[1])

    await waitFor(() => expect(api.pty.close).toHaveBeenCalledWith('r2'))
    expect(useTerminalStore.getState().sessions.map((s) => s.runId)).toEqual(['r1'])
  })

  it('点卡片的最大化会把该终端标记为最大化', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    fireEvent.click(iconButtons('fullscreen')[1])

    expect(useTerminalStore.getState().maximizedRunId).toBe('r2')
  })

  it('点击最大化按钮后提示立即收起 —— 鼠标仍停在按钮上也不残留', async () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const btn = iconButtons('fullscreen')[0]

    // hover:提示展开
    fireEvent.mouseEnter(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip).toBeTruthy()
      expect(tip?.classList.contains('ant-tooltip-hidden')).toBe(false)
    })

    // 点击后提示必须收起 —— 用户报的正是「点完按钮提示一直挂在按钮上方」。
    // antd 默认只在 mouseleave 时关闭,点击不关;这条断言锁住「点击即关」的行为
    fireEvent.click(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip === null || tip.classList.contains('ant-tooltip-hidden')).toBe(true)
    })

    // 修复不能把提示「焊死」:移出再悬停必须能再次展开(受控 open 的典型回归)
    fireEvent.mouseLeave(btn)
    fireEvent.mouseEnter(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip).toBeTruthy()
      expect(tip?.classList.contains('ant-tooltip-hidden')).toBe(false)
    })
  })

  it('激活态不在卡片层留任何视觉标记 —— 焦点交给 xterm 自己闪的光标', () => {
    setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r2',
      maximizedRunId: null
    })

    renderDock()

    const cards = Array.from(screen.getByTestId('terminal-list').children) as HTMLElement[]
    expect(cards).toHaveLength(2)
    // cards[0] = r1(未激活)、cards[1] = r2(激活):两者外观必须完全一致。
    // 激活与否只影响 TerminalView 的 focus(→ 光标闪烁),不经由卡片边框/投影表达。
    const [idle, active] = cards
    expect(active.style.border).toBe(idle.style.border)
    expect(active.style.boxShadow).toBe(idle.style.boxShadow)
    expect(active.style.boxShadow).toBe('')

    // 卡片层零标记之后,「谁是激活」只剩这条 prop 在传 —— 它触发 term.focus(),也就是光标闪烁本身。
    // 没有这两条断言,把 active 传丢/传错(`active={true}`、传错 runId)全部用例照样绿
    expect(screen.getByTestId('view-r2').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('view-r1').getAttribute('data-active')).toBe('false')
  })

  it('没有终端时给出空态提示', () => {
    setupApi()
    renderDock()

    expect(screen.getByText(/还没有运行中的终端/)).toBeTruthy()
  })
})

describe('卡片头部右键菜单', () => {
  it('右键卡片头部弹出三项关闭菜单,且是纯文字(无图标)', async () => {
    setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    renderDock()
    // 对照组:右键前菜单项不存在,证明后面的断言确实来自这一次右键
    expect(screen.queryByText('关闭其他终端')).toBeNull()

    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))

    expect(await screen.findByText('关闭其他终端')).toBeTruthy()

    for (const label of ['关闭此终端', '关闭其他终端', '关闭全部']) {
      const item = menuItem(label)
      expect(item).toBeTruthy()
      expect(item.querySelector('.anticon')).toBeNull()
    }
    // 危险色只给范围不受右键目标约束的那一项
    expect(menuItem('关闭全部').className).toContain('danger')
    expect(menuItem('关闭其他终端').className).not.toContain('danger')
    expect(menuItem('关闭此终端').className).not.toContain('danger')
  })

  it('关闭其他终端:只保留被右键的那张,并让它成为激活态', async () => {
    const api = setupApi()
    useTerminalStore.setState({
      sessions: [session('r3', 'C'), session('r2', 'B'), session('r1', 'A')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))
    fireEvent.click(await screen.findByText('关闭其他终端'))

    await waitFor(() => expect(useTerminalStore.getState().sessions.map((s) => s.runId)).toEqual(['r2']))
    // 其余两个各关一次,保留者一次都不关
    const closedIds = api.pty.close.mock.calls.map((c) => c[0]).sort()
    expect(closedIds).toEqual(['r1', 'r3'])
    expect(useTerminalStore.getState().activeRunId).toBe('r2')
  })

  it('只剩一个终端时「关闭其他终端」禁用但仍在菜单里', async () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('card-head-r1'))

    // 「关闭其他终端」禁用但仍在菜单里(不隐藏,菜单位置才稳定)
    expect(await screen.findByText('关闭其他终端')).toBeTruthy()
    expect(menuItem('关闭其他终端').className).toContain('ant-dropdown-menu-item-disabled')
    // 「关闭此终端」「关闭全部」不受影响
    expect(menuItem('关闭此终端').className).not.toContain('disabled')
    expect(menuItem('关闭全部').className).not.toContain('disabled')
  })

  it('最大化态下关闭其他:隐藏的卡片同样被关,保留者仍保持最大化', async () => {
    const api = setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r1',
      maximizedRunId: 'r2'
    })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))
    fireEvent.click(await screen.findByText('关闭其他终端'))

    await waitFor(() => expect(api.pty.close).toHaveBeenCalledWith('r1'))
    expect(useTerminalStore.getState().sessions.map((s) => s.runId)).toEqual(['r2'])
    expect(useTerminalStore.getState().maximizedRunId).toBe('r2')
  })

  it('某个终端关不掉时:其余照关,失败的卡片留在列表并提示', async () => {
    const api = setupApi()
    api.pty.close.mockImplementation(async (runId: string) => {
      if (runId === 'r1') throw new Error('会话不存在')
      return undefined
    })
    useTerminalStore.setState({
      sessions: [session('r3', 'C'), session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    // 错误分支会调 message.error：必须包 App,否则 useApp 拿到空 message 对象
    renderDockInApp()
    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))
    fireEvent.click(await screen.findByText('关闭其他终端'))

    await waitFor(() => expect(useTerminalStore.getState().sessions.map((s) => s.runId)).toEqual(['r1', 'r2']))
    await waitFor(() => expect(document.querySelector('.ant-message')).toBeTruthy())
  })

  it('同一时刻只有一个菜单:右键 B 之后 A 的菜单关闭', async () => {
    setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('card-head-r1'))
    await screen.findByText('关闭其他终端')

    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))

    // 可见菜单（排除 .ant-dropdown-hidden）必须只有一个
    await waitFor(() => {
      const visible = Array.from(document.querySelectorAll('.ant-dropdown')).filter(
        (el) => !el.classList.contains('ant-dropdown-hidden')
      )
      expect(visible.length).toBe(1)
    })
  })

  it('终端内容区右键不弹关闭菜单', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('view-r1'))

    expect(screen.queryByText('关闭其他终端')).toBeNull()
  })
})

describe('回到顶部按钮', () => {
  it('顶部时不出现 —— 列表没滚动过就没有这个按钮', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()

    expect(backTopButton()).toBeNull()
  })

  it('滚动超过阈值后浮现', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    scrollListTo(screen.getByTestId('terminal-list') as HTMLDivElement, 300)

    expect(backTopButton()).toBeTruthy()
  })

  it('点击回顶按钮以平滑方式滚回顶部', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    // jsdom 没有 Element.scrollTo,必须打桩,否则点击处理器抛 TypeError
    const scrollToSpy = vi.fn()
    Object.defineProperty(list, 'scrollTo', { configurable: true, value: scrollToSpy })
    scrollListTo(list, 300)

    fireEvent.click(screen.getByRole('button', { name: '回到顶部' }))

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('回到顶部附近自动收起', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    scrollListTo(list, 300)
    expect(backTopButton()).toBeTruthy()

    scrollListTo(list, 0)

    expect(backTopButton()).toBeNull()
  })

  it('内容变短(scrollTop 被浏览器夹回)后状态主动同步 —— 不依赖 scroll 事件', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    scrollListTo(list, 300)
    expect(backTopButton()).toBeTruthy()

    // 模拟「关闭终端 / 切最大化后,浏览器把 scrollTop 夹回 0 且不补发 scroll 事件」:
    // 直接改写值,再让会话数变化触发同步 effect
    list.scrollTop = 0
    act(() => {
      useTerminalStore.setState({ sessions: [session('r1', 'A')], activeRunId: 'r1', maximizedRunId: null })
    })

    expect(backTopButton()).toBeNull()
  })

  it('点击回顶按钮后提示立即收起 —— 鼠标仍停在按钮上也不残留', async () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    // jsdom 没有 Element.scrollTo,必须打桩,否则点击处理器抛 TypeError
    Object.defineProperty(list, 'scrollTo', { configurable: true, value: vi.fn() })
    scrollListTo(list, 300)

    const btn = screen.getByRole('button', { name: '回到顶部' })

    // hover:提示展开
    fireEvent.mouseEnter(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip).toBeTruthy()
      expect(tip?.classList.contains('ant-tooltip-hidden')).toBe(false)
    })

    // 点击后提示必须收起 —— 与最大化按钮同款受控 open 行为(antd 默认只在 mouseleave 时关闭)
    fireEvent.click(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip === null || tip.classList.contains('ant-tooltip-hidden')).toBe(true)
    })

    // 防「焊死」:移出再悬停必须能再次展开(受控 open 的典型回归)
    fireEvent.mouseLeave(btn)
    fireEvent.mouseEnter(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip).toBeTruthy()
      expect(tip?.classList.contains('ant-tooltip-hidden')).toBe(false)
    })
  })

  it('切最大化后按钮不出现 —— 列表不可滚,状态由 effect 同步', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    scrollListTo(list, 300)
    expect(backTopButton()).toBeTruthy()

    // 浏览器会把 scrollTop 夹回(jsdom 不夹,手工模拟);让 maximizedRunId 成为唯一变化量
    list.scrollTop = 0
    act(() => {
      useTerminalStore.setState({ maximizedRunId: 'r1' })
    })

    expect(backTopButton()).toBeNull()
  })

  it('按钮消失后再出现,提示不残留 —— 无悬停不自弹', async () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    scrollListTo(list, 300)
    const btn = screen.getByRole('button', { name: '回到顶部' })

    // 悬停展开提示(此时受控 open 为 true)
    fireEvent.mouseEnter(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip).toBeTruthy()
      expect(tip?.classList.contains('ant-tooltip-hidden')).toBe(false)
    })

    // 悬停中滚动越过阈值:按钮卸载(antd 不会回调 onOpenChange;不复位则状态残留)
    scrollListTo(list, 0)
    // 再滚回:按钮重挂。修复后提示不应无悬停自弹
    scrollListTo(list, 300)

    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip === null || tip.classList.contains('ant-tooltip-hidden')).toBe(true)
    })
  })
})
