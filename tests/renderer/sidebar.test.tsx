import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Script } from '../../src/shared/types'
import { installJsdomShims } from './jsdomShims'

import { Sidebar } from '../../src/renderer/src/components/Sidebar'
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

const copy: Script = { ...script, id: 's1-copy', name: '构建 副本', order: 1 }

interface ApiMock {
  scripts: Record<string, ReturnType<typeof vi.fn>>
  groups: Record<string, ReturnType<typeof vi.fn>>
  pty: Record<string, ReturnType<typeof vi.fn>>
}

function setupApi(): ApiMock {
  const api: ApiMock = {
    scripts: {
      list: vi.fn(async () => [script]),
      duplicate: vi.fn(async () => copy),
      remove: vi.fn(async () => undefined),
      create: vi.fn(async () => script),
      update: vi.fn(async () => script),
      reorder: vi.fn(async () => undefined)
    },
    groups: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      reorder: vi.fn()
    },
    pty: { start: vi.fn(async () => ({ runId: 'r1', title: '构建' })) }
  }
  ;(window as unknown as { api: ApiMock }).api = api
  return api
}

/** antd 图标自带 aria-label(如 copy),用它定位行内按钮比按顺序取下标稳 */
function iconButton(name: string): HTMLElement {
  const icon = screen.getAllByLabelText(name)[0]
  const button = icon.closest('button')
  if (!button) throw new Error(`图标 ${name} 不在 button 内`)
  return button
}

beforeEach(() => {
  installJsdomShims()
  useAppStore.setState({
    scripts: [],
    groups: [],
    selectedScriptId: null,
    openTabs: [],
    form: { type: 'none' }
  })
})

afterEach(() => {
  cleanup()
})

describe('树形分组的折叠', () => {
  it('点击分组头收起脚本行,再点展开', async () => {
    setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByText('未分组'))
    expect(screen.queryByText('构建')).toBeNull()

    fireEvent.click(screen.getByText('未分组'))
    await screen.findByText('构建')
  })

  it('折叠状态下搜索,分组强制展开让结果可见', async () => {
    setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByText('未分组'))
    expect(screen.queryByText('构建')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('搜索脚本'), { target: { value: '构建' } })
    await screen.findByText('构建')
  })
})

describe('脚本行的复制按钮', () => {
  it('点击复制会请求生成副本,并选中新副本', async () => {
    const api = setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(iconButton('copy'))

    await waitFor(() => expect(api.scripts.duplicate).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(useAppStore.getState().selectedScriptId).toBe('s1-copy'))
  })

  it('点击复制不会打开编辑表单,也不会触发删除', async () => {
    const api = setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(iconButton('copy'))

    await waitFor(() => expect(api.scripts.duplicate).toHaveBeenCalled())
    expect(useAppStore.getState().form).toEqual({ type: 'none' })
    expect(api.scripts.remove).not.toHaveBeenCalled()
  })
})
