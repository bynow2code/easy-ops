import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import type { Script } from '../../src/shared/types'
import { installJsdomShims } from './jsdomShims'

// CodeMirror 在 jsdom 里跑不动;这里只关心面板的「草稿-保存」逻辑,用替身隔离
vi.mock('../../src/renderer/src/components/ScriptEditor', () => ({
  ScriptEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element => (
    <textarea data-testid="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  )
}))

import { ContentPanel } from '../../src/renderer/src/components/ContentPanel'
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

interface ApiMock {
  scripts: Record<string, ReturnType<typeof vi.fn>>
  groups: Record<string, ReturnType<typeof vi.fn>>
}

function setupApi(updatedContent?: string): ApiMock {
  const api: ApiMock = {
    scripts: {
      list: vi.fn(async () => [{ ...script, content: updatedContent ?? script.content }]),
      update: vi.fn(async () => ({ ...script, content: updatedContent ?? script.content })),
      create: vi.fn(),
      remove: vi.fn(),
      duplicate: vi.fn(),
      reorder: vi.fn()
    },
    groups: { list: vi.fn(async () => []) }
  }
  ;(window as unknown as { api: ApiMock }).api = api
  return api
}

beforeEach(() => {
  installJsdomShims()
  useAppStore.setState({
    scripts: [script],
    groups: [],
    selectedScriptId: 's1',
    openTabs: [],
    form: { type: 'none' },
    contentDrafts: {},
    contentFocusRequest: null
  })
})

afterEach(() => {
  cleanup()
})

function renderPanel(): void {
  render(
    <ThemeProvider mode="light" onModeChange={() => undefined}>
      <ContentPanel script={script} />
    </ThemeProvider>
  )
}

describe('内容面板', () => {
  it('无改动时没有「保存」按钮,也不标记未保存', () => {
    setupApi()
    renderPanel()

    expect(screen.getByTestId('editor')).toBeTruthy()
    expect(screen.queryByText('保存')).toBeNull()
    expect(screen.queryByText('未保存')).toBeNull()
  })

  it('编辑后出现「保存」按钮与未保存标记,草稿进 store', () => {
    setupApi()
    renderPanel()

    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'echo changed' } })

    expect(screen.getByText('保存')).toBeTruthy()
    expect(screen.getByText('未保存')).toBeTruthy()
    expect(useAppStore.getState().contentDrafts.s1).toBe('echo changed')
  })

  it('点保存把草稿写到对应脚本,并清掉草稿', async () => {
    const api = setupApi('echo changed')
    renderPanel()

    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'echo changed' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(api.scripts.update).toHaveBeenCalledWith('s1', { content: 'echo changed' }))
    await waitFor(() => expect(useAppStore.getState().contentDrafts.s1).toBeUndefined())
  })

  it('保存飞行期间继续输入,新输入不丢(草稿保留为未保存增量)', async () => {
    const api = setupApi('echo changed')
    // update 挂起,模拟 IPC 往返期间用户还在编辑器里敲字
    let resolveUpdate: (value: Script) => void = () => undefined
    api.scripts.update.mockImplementationOnce(
      () => new Promise<Script>((resolve) => { resolveUpdate = resolve })
    )
    renderPanel()

    const editor = screen.getByTestId('editor')
    fireEvent.change(editor, { target: { value: 'echo changed' } })
    fireEvent.click(screen.getByText('保存'))
    expect(api.scripts.update).toHaveBeenCalledWith('s1', { content: 'echo changed' })

    // 飞行期间继续输入 → 草稿变成更新的内容
    fireEvent.change(editor, { target: { value: 'echo changed & more' } })
    resolveUpdate({ ...script, content: 'echo changed' })

    // 等 save 走到 reload(list 被调用),再冲刷微任务让 clearContentDraft(若会执行)落地,
    // 然后断言「终态」——不能用 waitFor 直接等草稿值,它会在保存流程跑完前被中间态骗过
    await waitFor(() => expect(api.scripts.list).toHaveBeenCalled())
    await act(async () => {})

    // 保存只应落定「保存时的值」;飞行期间的新输入必须留在草稿里
    expect(useAppStore.getState().contentDrafts.s1).toBe('echo changed & more')
  })

  it('草稿按脚本 id 存:切走再切回来,没保存的改动还在', () => {
    setupApi()
    useAppStore.setState({ contentDrafts: { s1: 'echo draft' } })
    renderPanel()

    expect((screen.getByTestId('editor') as HTMLTextAreaElement).value).toBe('echo draft')
    expect(screen.getByText('保存')).toBeTruthy()
  })

  it('选中的是另一个脚本时,显示的是那个脚本的内容而不是别人的草稿', () => {
    setupApi()
    useAppStore.setState({ contentDrafts: { s1: 'echo draft' } })
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <ContentPanel script={{ ...script, id: 's2', name: '部署', content: 'echo deploy' }} />
      </ThemeProvider>
    )

    expect((screen.getByTestId('editor') as HTMLTextAreaElement).value).toBe('echo deploy')
    expect(screen.queryByText('保存')).toBeNull()
  })
})
