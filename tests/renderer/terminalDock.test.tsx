import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installJsdomShims } from './jsdomShims'

// xterm 在 jsdom 里跑不起来,且本用例只关心「卡片怎么排布与操作」,用替身隔离
vi.mock('../../src/renderer/src/components/TerminalView', () => ({
  TerminalView: ({ runId }: { runId: string }): JSX.Element => <div data-testid={`view-${runId}`} />
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

  it('没有终端时给出空态提示', () => {
    setupApi()
    renderDock()

    expect(screen.getByText(/还没有运行中的终端/)).toBeTruthy()
  })
})
