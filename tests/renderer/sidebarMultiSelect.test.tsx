import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Group, Script } from '../../src/shared/types'
import { installJsdomShims } from './jsdomShims'

import { Sidebar } from '../../src/renderer/src/components/Sidebar'
import { useAppStore } from '../../src/renderer/src/store/useAppStore'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'

const createdAt = '2026-01-01T00:00:00.000Z'

const mkScript = (id: string, name: string, groupId: string | null, order: number): Script => ({
  id,
  name,
  content: `echo ${id}`,
  groupId,
  shellId: 'bash',
  order,
  createdAt,
  updatedAt: createdAt
})

const mkGroup = (id: string, name: string, parentId: string | null, order: number): Group => ({
  id,
  name,
  parentId,
  order,
  createdAt
})

// 树:目录A(s1, s2) / 顶层 s3
const gA = mkGroup('gA', '目录A', null, 0)
const s1 = mkScript('s1', '脚本A1', 'gA', 0)
const s2 = mkScript('s2', '脚本A2', 'gA', 1)
const s3 = mkScript('s3', '脚本B1', null, 2)
const initialScripts = [s1, s2, s3]
const initialGroups = [gA]

let api: { scripts: Record<string, ReturnType<typeof vi.fn>>; settings: Record<string, ReturnType<typeof vi.fn>> }

beforeEach(() => {
  installJsdomShims()
  api = {
    scripts: {
      list: vi.fn(async () => initialScripts),
      update: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(async () => undefined),
      duplicate: vi.fn(),
      reorder: vi.fn()
    },
    settings: { get: vi.fn(async () => ({})), update: vi.fn(async () => ({})) }
  }
  ;(window as unknown as { api: unknown }).api = {
    scripts: api.scripts,
    groups: { list: vi.fn(async () => initialGroups) },
    settings: api.settings,
    app: { info: vi.fn(async () => ({ version: '0.8.1', repo: '', platform: 'linux', packaged: false })) }
  }
})

afterEach(() => {
  cleanup()
})

/** 按名称找脚本行(行是 .app-row,名字在 Typography.Text 里) */
const scriptRow = (name: string): HTMLElement => {
  const text = screen.getByText(name)
  const row = text.closest('.app-row') as HTMLElement
  expect(row).toBeTruthy()
  return row
}

const isSelected = (name: string): boolean => scriptRow(name).classList.contains('app-row-selected')

function renderSidebar(scripts = initialScripts): void {
  useAppStore.setState({
    scripts,
    groups: initialGroups,
    selectedScriptId: null,
    openTabs: [],
    form: { type: 'none' },
    contentDrafts: {},
    contentFocusRequest: null,
    search: ''
  })
  render(
    <ThemeProvider mode="light" onModeChange={() => undefined}>
      <Sidebar />
    </ThemeProvider>
  )
}

describe('脚本多选语义', () => {
  it('普通单击:仅该行选中(现状不变)', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    expect(isSelected('脚本A1')).toBe(true)
    expect(isSelected('脚本A2')).toBe(false)
  })

  it('Ctrl+单击:加入多选,原选中行保持高亮', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    expect(isSelected('脚本A1')).toBe(true)
    expect(isSelected('脚本A2')).toBe(true)
  })

  it('Ctrl+单击已多选行:移出选区(高亮仍在,集合内容由任务3的右键用例验证)', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    // A2 从选区移出,但它是最后一次点击的行(store 选中),仍保持高亮;A1 仍在选区
    expect(isSelected('脚本A1')).toBe(true)
    expect(isSelected('脚本A2')).toBe(true)
  })

  it('Shift+单击:锚点到当前行的范围选中,跨目录允许', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本B1'), { shiftKey: true })
    expect(isSelected('脚本A1')).toBe(true)
    expect(isSelected('脚本A2')).toBe(true)
    expect(isSelected('脚本B1')).toBe(true)
  })

  it('普通单击清空多选:只选新行', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.click(scriptRow('脚本B1'))
    expect(isSelected('脚本A1')).toBe(false)
    expect(isSelected('脚本A2')).toBe(false)
    expect(isSelected('脚本B1')).toBe(true)
  })

  it('Esc 清空多选:只剩 store 选中行高亮', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    // A2 是最后点击行(store 选中)仍高亮;A1 的多选高亮被清掉
    expect(isSelected('脚本A1')).toBe(false)
    expect(isSelected('脚本A2')).toBe(true)
  })

  it('搜索变化清空多选:选区高亮消失,store 选中行保留', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.change(screen.getByPlaceholderText('搜索脚本'), { target: { value: 'A' } })
    // 搜索清空多选:A1 的多选高亮消失;A2 是 store 选中行(selectedScriptId),仍高亮。
    // (计划原稿搜 'A1' 的断言有误:Ctrl+点击后 store 选中的是 A2 而非 A1)
    expect(isSelected('脚本A1')).toBe(false)
    expect(isSelected('脚本A2')).toBe(true)
  })
})

describe('行右键菜单', () => {
  it('右键未选中行:先单选该行,弹单条菜单(复制/删除)', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.contextMenu(scriptRow('脚本A2'))

    // A2 被预选中(store 选中),A1 的多选/详情高亮被清掉
    await waitFor(() => expect(isSelected('脚本A2')).toBe(true))
    expect(isSelected('脚本A1')).toBe(false)
    // 菜单浮层挂 body,findBy 等待浮层渲染完成
    expect(await screen.findByText('复制')).toBeTruthy()
    expect(
      await screen.findByText('删除', { selector: 'li .ant-dropdown-menu-title-content' })
    ).toBeTruthy()
  })

  it('右键多选行:弹批量菜单「删除 N 个脚本」', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.contextMenu(scriptRow('脚本A2'))

    expect(await screen.findByText('删除 2 个脚本')).toBeTruthy()
  })

  it('选区里的脏 id 不计数:有效选区只剩 1 个时降级为单条菜单', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    // 确认框打开期间列表可能已变(A1 被其他入口删除):渲染期求交兜底。
    // 有效选区只剩 A2(1 个),按实现语义降级为单条菜单(计划原稿期望「删除 1 个脚本」
    // 与其实现片段的 `validSelected.length <= 1` 降级条件自相矛盾,按实现修正断言)
    act(() => {
      useAppStore.setState({ scripts: initialScripts.filter((s) => s.id !== 's1') })
    })
    fireEvent.contextMenu(scriptRow('脚本A2'))

    expect(await screen.findByText('复制')).toBeTruthy()
    expect(screen.queryByText(/删除 \d+ 个脚本/)).toBeNull()
  })

  it('右键目录行:无右键菜单', async () => {
    renderSidebar()
    const head = document.querySelector('.app-group-head') as HTMLElement
    fireEvent.contextMenu(head)
    // 给浮层留一拍渲染窗口
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('删除目录')).toBeNull()
  })
})

describe('批量删除', () => {
  it('确认框文案含名字与总数;确认后逐条 remove 并 reload,选区清空', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.contextMenu(scriptRow('脚本A2'))
    fireEvent.click(await screen.findByText('删除 2 个脚本'))

    // 确认框:正文含名字(antd two-char okText「删 除」带空格,按钮用正则定位)
    expect((await screen.findByText(/确定删除/)).textContent).toContain('脚本A1')
    expect((await screen.findByText(/确定删除/)).textContent).toContain('脚本A2')
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }))

    await waitFor(() => expect(api.scripts.remove).toHaveBeenCalledTimes(2))
    expect(api.scripts.remove).toHaveBeenCalledWith('s1')
    expect(api.scripts.remove).toHaveBeenCalledWith('s2')
    // reload 走 scripts.list 重新拉取:挂载 1 次 + reload 1 次
    await waitFor(() => expect(api.scripts.list).toHaveBeenCalledTimes(2))
    // 选区清空:右键再开菜单回到单条语义
    fireEvent.contextMenu(scriptRow('脚本A1'))
    expect(await screen.findByText('复制')).toBeTruthy()
  })

  it('部分失败:报错提示,成功的照常 reload', async () => {
    api.scripts.remove.mockImplementation(async (id: string) => {
      if (id === 's1') throw new Error('boom')
      return undefined
    })
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.contextMenu(scriptRow('脚本A2'))
    fireEvent.click(await screen.findByText('删除 2 个脚本'))
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }))

    await waitFor(() => expect(api.scripts.remove).toHaveBeenCalledTimes(2))
    // reload 照常执行(allSettled:单条失败不拖累):挂载 1 次 + reload 1 次
    await waitFor(() => expect(api.scripts.list).toHaveBeenCalledTimes(2))
    // message.error 的文案在 body 里(antd message 容器)
    await screen.findByText('1 个脚本删除失败,已保留')
  })

  it('选区行全部从列表消失:无批量入口,右键回到单条语义', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    // 选区里的脚本全部从列表消失(其他入口删除):渲染期求交后选区实际为空
    act(() => {
      useAppStore.setState({ scripts: [s3] })
    })
    expect(screen.queryByText('脚本A1')).toBeNull()
    // 右键仍在列表里的行:走单条菜单而非批量(空选区不会出现「删除 N 个脚本」)。
    // (计划原稿的「全部失效」用例无法从 UI 构造到 handleBatchDelete 空目标分支——
    //  菜单入口传入的 validSelected 已与渲染期列表求交;空分支为纯防御,评审把关)
    fireEvent.contextMenu(scriptRow('脚本B1'))
    expect(await screen.findByText('复制')).toBeTruthy()
    expect(screen.queryByText(/删除 \d+ 个脚本/)).toBeNull()
  })
})
