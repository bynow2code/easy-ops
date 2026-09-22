import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Script } from '../../src/shared/types'
import { installJsdomShims } from './jsdomShims'

// CodeMirror 在 jsdom 里跑不动;这里只关心页签的未保存点显隐,用替身隔离编辑器
vi.mock('../../src/renderer/src/components/ScriptEditor', () => ({
  ScriptEditor: ({ value }: { value: string }): JSX.Element => (
    <textarea data-testid="editor" value={value} readOnly />
  )
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
})
