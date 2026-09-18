import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Script, ShellInfo } from '../../src/shared/types'

// CodeMirror 是重量级且与本用例关注的「Shell 字段」无关,用受控 textarea 替身隔离
vi.mock('../../src/renderer/src/components/ScriptEditor', () => ({
  ScriptEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element => (
    <textarea data-testid="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  )
}))

import { ScriptFormModal } from '../../src/renderer/src/components/ScriptFormModal'
import { useAppStore } from '../../src/renderer/src/store/useAppStore'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'
import { installJsdomShims } from './jsdomShims'

const zsh: ShellInfo = { id: 'zsh', name: 'zsh', path: '/bin/zsh', args: ['-i'], source: 'detected' }
const bash: ShellInfo = { id: 'bash', name: 'bash', path: '/bin/bash', args: ['-i'], source: 'detected' }

const script = (shellId: string | null): Script => ({
  id: 's1',
  name: '构建',
  content: 'echo build',
  groupId: null,
  shellId,
  order: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

interface ApiMock {
  shell: { detect: ReturnType<typeof vi.fn> }
  settings: { get: ReturnType<typeof vi.fn> }
  scripts: {
    list: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    reorder: ReturnType<typeof vi.fn>
  }
  groups: { list: ReturnType<typeof vi.fn> }
}

function setupApi(): ApiMock {
  const api: ApiMock = {
    shell: { detect: vi.fn(async () => [zsh, bash]) },
    settings: {
      get: vi.fn(async () => ({
        theme: 'light',
        shellId: 'bash',
        customShells: [],
        checkUpdateOnLaunch: true
      }))
    },
    scripts: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => script(null)),
      update: vi.fn(async () => script(null)),
      remove: vi.fn(async () => undefined),
      reorder: vi.fn(async () => undefined)
    },
    groups: { list: vi.fn(async () => []) }
  }
  ;(window as unknown as { api: ApiMock }).api = api
  return api
}

function renderModal(): void {
  render(
    <ThemeProvider mode="light" onModeChange={() => undefined}>
      <ScriptFormModal />
    </ThemeProvider>
  )
}

/** 打开 Shell 下拉:antd 的 Select 靠 mouseDown 展开,且弹窗内还有「分组」下拉,需按 label 定位 */
async function openShellSelect(): Promise<void> {
  const item = (await screen.findByText('Shell')).closest('.ant-form-item')
  if (!item) throw new Error('未找到 Shell 表单项')
  const selector = item.querySelector('.ant-select-selector')
  if (!selector) throw new Error('未找到 Shell 下拉')
  fireEvent.mouseDown(selector)
}

/** antd 会在两个中文字符间插入空格,可访问名实际是「保 存」 */
function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: /^保\s?存$/ })
}

beforeEach(() => {
  installJsdomShims()
  useAppStore.setState({ form: { type: 'none' }, scripts: [], groups: [] })
})

afterEach(() => {
  cleanup()
})

describe('脚本弹窗的 Shell 字段', () => {
  it('未打开表单时编辑器也保持挂载,不让挂载开销落进弹窗动画', () => {
    setupApi()
    useAppStore.setState({ form: { type: 'none' } })

    renderModal()

    // 常驻的弹窗在关闭态不渲染可见内容,但编辑器子树已经在位
    expect(document.querySelector('.ant-modal-wrap[style*="display: none"]')).toBeTruthy()
    expect(screen.getByTestId('editor')).toBeTruthy()
  })

  it('编辑脚本时回填该脚本已指定的 shell', async () => {
    setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script('zsh') } })

    renderModal()

    await waitFor(() => expect(screen.getByTitle('zsh · /bin/zsh')).toBeTruthy())
  })

  it('新建脚本时默认「跟随全局」', async () => {
    setupApi()
    useAppStore.setState({ form: { type: 'script-create', groupId: null } })

    renderModal()

    await waitFor(() => expect(screen.getByTitle('跟随全局')).toBeTruthy())
  })

  it('保存时把当前选择的 shell 一并提交', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script('zsh') } })

    renderModal()
    await openShellSelect()
    fireEvent.click(await screen.findByTitle('bash · /bin/bash'))
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.scripts.update).toHaveBeenCalledWith('s1', expect.objectContaining({ shellId: 'bash' }))
    )
  })

  it('新建时未指定 shell,提交 null 表示跟随全局', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-create', groupId: null } })

    renderModal()
    await waitFor(() => expect(screen.getByTitle('跟随全局')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('例如:启动本地服务'), {
      target: { value: '部署' }
    })
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'echo deploy' } })
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.scripts.create).toHaveBeenCalledWith({
        name: '部署',
        content: 'echo deploy',
        groupId: null,
        shellId: null
      })
    )
  })

  it('打开弹窗只探测一次可用 shell,编辑过程中的重渲染不会重复请求', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script('zsh') } })

    renderModal()
    await waitFor(() => expect(screen.getByTitle('zsh · /bin/zsh')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('例如:启动本地服务'), { target: { value: '构建 v2' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(api.scripts.update).toHaveBeenCalled())
    expect(api.shell.detect).toHaveBeenCalledTimes(1)
  })

  it('脚本指定的 shell 已不存在时,仍原样显示且保存不丢失', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script('custom:/opt/gone') } })

    renderModal()

    await waitFor(() => expect(screen.getByTitle('custom:/opt/gone(已不可用)')).toBeTruthy())
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.scripts.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ shellId: 'custom:/opt/gone' })
      )
    )
  })
})
