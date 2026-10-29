import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { installJsdomShims } from './jsdomShims'

// xterm 在 jsdom 里跑不起来(canvas/字符测量),这里用替身把「按键 → 剪贴板」这条接线测住:
// TerminalView 的复制能力全靠 attachCustomKeyEventHandler 注册的回调,替身把它交出来直接调。
// 替身状态挂在 globalThis 上 —— vi.mock 工厂会被提升,拿不到用例作用域里的变量。
vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    focus(): void {}
    dispose(): void {}
    onData(): { dispose: () => void } {
      return { dispose: (): void => undefined }
    }
    getSelection(): string {
      return (globalThis as unknown as { __termSelection: string }).__termSelection
    }
    attachCustomKeyEventHandler(fn: (ev: KeyboardEvent) => boolean): void {
      ;(globalThis as unknown as { __copyHandler: (ev: KeyboardEvent) => boolean }).__copyHandler = fn
    }
  }
  return { Terminal: FakeTerminal, default: FakeTerminal }
})

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  }
}))

vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))

import { TerminalView } from '../../src/renderer/src/components/TerminalView'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'

interface CopyHandler {
  __copyHandler?: (ev: KeyboardEvent) => boolean
  __termSelection?: string
}

const g = globalThis as unknown as CopyHandler

interface ApiMock {
  pty: Record<string, ReturnType<typeof vi.fn>>
  clipboard: { writeText: ReturnType<typeof vi.fn> }
}

function setupApi(): ApiMock {
  const off = (): void => undefined
  const api: ApiMock = {
    pty: {
      onData: vi.fn(() => off),
      onExit: vi.fn(() => off),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    },
    clipboard: { writeText: vi.fn() }
  }
  ;(window as unknown as { api: ApiMock }).api = api
  return api
}

function renderView(): void {
  render(
    <ThemeProvider mode="light" onModeChange={() => undefined}>
      <TerminalView runId="r1" active onRegisterWriter={() => undefined} />
    </ThemeProvider>
  )
}

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init)

beforeEach(() => {
  installJsdomShims()
  g.__termSelection = ''
  g.__copyHandler = undefined
})

afterEach(() => {
  cleanup()
})

describe('终端复制接线', () => {
  it('Ctrl+Shift+C 把选中的文本写进剪贴板', () => {
    const api = setupApi()
    g.__termSelection = 'line-one alpha'
    renderView()

    act(() => {
      g.__copyHandler?.(key({ code: 'KeyC', key: 'C', ctrlKey: true, shiftKey: true }))
    })

    expect(api.clipboard.writeText).toHaveBeenCalledWith('line-one alpha')
    // 复制键不能被当成输入送给 pty(那会把正在跑的程序 ^C 掉)
    expect(api.pty.write).not.toHaveBeenCalled()
  })

  it('没有选中内容时既不写剪贴板,也不把按键送进 pty', () => {
    const api = setupApi()
    renderView()

    let handled = true
    act(() => {
      handled = g.__copyHandler?.(key({ code: 'KeyC', key: 'C', ctrlKey: true, shiftKey: true })) ?? true
    })

    expect(api.clipboard.writeText).not.toHaveBeenCalled()
    expect(api.pty.write).not.toHaveBeenCalled()
    // 返回 false = xterm 不再处理该按键:否则 Ctrl+Shift+C 会被解析成 ^C 送进 pty
    expect(handled).toBe(false)
  })

  it('Ctrl+C 仍然交回 xterm —— SIGINT 不能被复制抢走', () => {
    setupApi()
    g.__termSelection = 'some text'
    renderView()

    let handled = false
    act(() => {
      handled = g.__copyHandler?.(key({ code: 'KeyC', key: 'c', ctrlKey: true })) ?? false
    })

    expect(handled).toBe(true)
  })
})
