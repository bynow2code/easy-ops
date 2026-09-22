import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Script } from '../../src/shared/types'
import { installJsdomShims } from './jsdomShims'

// CodeMirror 在 jsdom 里跑不动;这里只关心页签的未保存点显隐,用替身隔离编辑器
vi.mock('../../src/renderer/src/components/ScriptEditor', () => ({
  ScriptEditor: ({ value }: { value: string }): JSX.Element => (
    <textarea data-testid="editor" value={value} readOnly />
  )
}))

// import App 会把整条依赖图带进模块加载期,其中 TerminalDock → TerminalView →
// @xterm/xterm 在模块作用域就调 canvas.getContext,jsdom 未实现会刷 stderr。
// 本用例只渲染 ScriptDetail,不碰终端区,按 terminalDock 用例同款替身截断这条链
vi.mock('../../src/renderer/src/components/TerminalDock', () => ({
  TerminalDock: (): JSX.Element => <div />
}))

import { ScriptDetail } from '../../src/renderer/src/App'
import { useAppStore } from '../../src/renderer/src/store/useAppStore'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'

const script: Script = {
  id: 's1',
  name: '构建',
  content: 'echo build',
  groupId: null,
  shellId: 'bash',
  order: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

beforeEach(() => {
  installJsdomShims()
  ;(window as unknown as { api: unknown }).api = {
    app: { info: vi.fn(async () => ({ version: '0.8.1', repo: '', platform: 'linux', packaged: false })), openExternal: vi.fn(async () => undefined) },
    scripts: {
      list: vi.fn(async () => [script]),
      update: vi.fn(async () => script),
      create: vi.fn(),
      remove: vi.fn(),
      duplicate: vi.fn(),
      reorder: vi.fn()
    },
    groups: { list: vi.fn(async () => []) }
  }
})

afterEach(() => {
  cleanup()
})

function renderTabs(drafts: Record<string, string>): void {
  useAppStore.setState({
    scripts: [script],
    groups: [],
    selectedScriptId: 's1',
    openTabs: ['s1'],
    form: { type: 'none' },
    contentDrafts: drafts,
    contentFocusRequest: null
  })
  render(
    <ThemeProvider mode="light" onModeChange={() => undefined}>
      <ScriptDetail />
    </ThemeProvider>
  )
}

describe('页签未保存点', () => {
  it('草稿与已存内容不一致:显示未保存点,关闭符也仍在(同一槽位,靠 CSS 切换)', () => {
    renderTabs({ s1: 'echo changed' })

    expect(screen.getByLabelText('未保存 构建')).toBeTruthy()
    expect(screen.getByLabelText('关闭页签 构建')).toBeTruthy()
  })

  it('草稿与已存内容一致(改了又改回去):不算未保存,不显示点', () => {
    renderTabs({ s1: 'echo build' })

    expect(screen.queryByLabelText('未保存 构建')).toBeNull()
  })

  it('没有草稿:不显示点', () => {
    renderTabs({})

    expect(screen.queryByLabelText('未保存 构建')).toBeNull()
  })

  it('页签条走滚动而非裁切:overflow 落 auto(滚动条由 CSS 隐藏),内容放得下时两端无渐隐', () => {
    renderTabs({})

    const strip = document.querySelector('.app-tabstrip') as HTMLElement | null
    expect(strip).not.toBeNull()
    expect(strip!.style.overflowX).toBe('auto')
    expect(document.querySelector('.app-tabstrip-fade-left')).toBeNull()
    expect(document.querySelector('.app-tabstrip-fade-right')).toBeNull()
  })

  it('滚轮接管在页签条出现之后挂载也能生效(回归:空依赖 effect 曾错过首次出现)', () => {
    // 复现真实时序:先空态渲染(无页签条),再打开页签 —— 滚轮监听必须在那时补挂
    useAppStore.setState({
      scripts: [script],
      groups: [],
      selectedScriptId: null,
      openTabs: [],
      form: { type: 'none' },
      contentDrafts: {},
      contentFocusRequest: null
    })
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <ScriptDetail />
      </ThemeProvider>
    )
    expect(document.querySelector('.app-tabstrip')).toBeNull()

    act(() => useAppStore.getState().selectScript('s1'))

    const strip = document.querySelector('.app-tabstrip') as HTMLElement
    // jsdom 没有布局,手动给条一个「溢出」的几何,滚轮接管才有活干
    Object.defineProperty(strip, 'scrollWidth', { value: 600, configurable: true })
    Object.defineProperty(strip, 'clientWidth', { value: 200, configurable: true })

    fireEvent.wheel(strip, { deltaY: 120 })

    expect(strip.scrollLeft).toBe(120)
  })
})
