import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Group, Script } from '../../src/shared/types'
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
  /** 一个顶层分组「wms」+ 其下脚本「构建」,供折叠相关用例共用 */
  function setupGrouped(): ApiMock {
    const api = setupApi()
    const g1: Group = { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' }
    const grouped: Script = { ...script, groupId: 'g1' }
    api.groups.list.mockResolvedValue([g1])
    api.scripts.list.mockResolvedValue([grouped])
    return api
  }

  it('点击分组头收起脚本行,再点展开', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByText('wms'))
    expect(screen.queryByText('构建')).toBeNull()

    fireEvent.click(screen.getByText('wms'))
    await screen.findByText('构建')
  })

  it('折叠状态下搜索,分组强制展开让结果可见', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByText('wms'))
    expect(screen.queryByText('构建')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('搜索脚本'), { target: { value: '构建' } })
    await screen.findByText('构建')
  })
})

describe('脚本行更多操作菜单', () => {
  // 复制/删除已收编进「更多操作」菜单,平铺按钮不复存在,走菜单路径验证同一行为
  it('菜单里点复制会请求生成副本,并选中新副本', async () => {
    const api = setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByLabelText('更多操作'))
    fireEvent.click(await screen.findByText('复制'))

    await waitFor(() => expect(api.scripts.duplicate).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(useAppStore.getState().selectedScriptId).toBe('s1-copy'))
  })

  it('菜单里点复制不会打开编辑表单,也不会触发删除', async () => {
    const api = setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByLabelText('更多操作'))
    fireEvent.click(await screen.findByText('复制'))

    await waitFor(() => expect(api.scripts.duplicate).toHaveBeenCalled())
    expect(useAppStore.getState().form).toEqual({ type: 'none' })
    expect(api.scripts.remove).not.toHaveBeenCalled()
  })
})

describe('嵌套树渲染', () => {
  function setupNested(): void {
    const parent: Group = { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' }
    const child: Group = { id: 'g2', name: 'pda', order: 0, parentId: 'g1', createdAt: '' }
    const s1: Script = { ...script, id: 's1', name: '拣货', groupId: 'g2' }
    ;(window as unknown as { api: unknown }).api = {
      scripts: { list: vi.fn(async () => [s1]) },
      groups: { list: vi.fn(async () => [parent, child]) }
    }
  }

  it('子目录缩进渲染在父目录下,脚本挂到子目录', async () => {
    setupNested()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')
    expect(screen.getByText('pda')).toBeTruthy()
    expect(screen.getByText('拣货')).toBeTruthy()
    // 父目录计数 = 其下所有脚本总数(含子目录)
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1)

    // 嵌套结构断言:pda 的分组头在 wms 的展开容器内(平铺实现下两者是兄弟,此断言失败)
    const wmsHead = screen.getByText('wms').closest('.app-group-head') as HTMLElement
    const pdaHead = screen.getByText('pda').closest('.app-group-head') as HTMLElement
    expect(wmsHead.parentElement!.contains(pdaHead)).toBe(true)
    // 层级缩进:depth 1 的分组头 paddingLeft = 4 + 1 * TREE_INDENT
    expect(pdaHead.style.paddingLeft).toBe('43px')
    // 脚本行与所在分组头名称左对齐:depth 1 的脚本 marginLeft = 1 * TREE_INDENT + 31,
    // 加上行内 padding 8 后文字起点 = 78px,与 pda 分组名文字起点(43 + 35)一致
    const row = screen.getByText('拣货').closest('.app-row') as HTMLElement
    expect(row.style.marginLeft).toBe('70px')

    // 层级对齐线:每层展开容器各一条,与本层折叠箭头中心对齐(4 + depth*39 + 5)
    const guides = [...document.querySelectorAll('.app-guide')] as HTMLElement[]
    expect(guides.length).toBe(2)
    expect(guides.map((g) => g.style.left).sort()).toEqual(['48px', '9px'])
  })
})

describe('悬停菜单', () => {
  /** 一个顶层分组 + 一条直接挂载的脚本,供目录行/脚本行菜单测试共用 */
  function setupGrouped(): ApiMock {
    const api = setupApi()
    const g1: Group = { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' }
    const s1: Script = { ...script, id: 's1', groupId: 'g1' }
    api.groups.list.mockResolvedValue([g1])
    api.scripts.list.mockResolvedValue([s1])
    return api
  }

  it('脚本行菜单里有复制与删除,点复制走 duplicate', async () => {
    const api = setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    // 菜单触发点是 ⋯ 按钮(aria-label),复制/删除不再平铺在行上
    expect(screen.queryByLabelText('copy')).toBeNull()
    fireEvent.click(screen.getByLabelText('更多操作'))
    fireEvent.click(await screen.findByText('复制'))

    await waitFor(() => expect(api.scripts.duplicate).toHaveBeenCalledWith('s1'))
  })

  it('目录行菜单:新增子目录打开带 parentId 的表单', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')

    fireEvent.click(screen.getByLabelText('分组操作'))
    fireEvent.click(await screen.findByText('新建子目录'))

    await waitFor(() =>
      expect(useAppStore.getState().form).toEqual({ type: 'group-create', parentId: 'g1' })
    )
  })

  it('目录行悬停 + 号直接打开新建脚本表单且 groupId 指向该目录', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')

    fireEvent.click(screen.getByLabelText('在此目录新建脚本'))

    await waitFor(() =>
      expect(useAppStore.getState().form).toEqual({ type: 'script-create', groupId: 'g1' })
    )
  })

  it('无分组脚本直接渲染为顶层行,不再有「未分组」伪目录', async () => {
    setupApi() // 一条 groupId 为 null 的脚本
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    // 顶部按钮已移除,「新建脚本」入口只存在于目录行悬停 ＋
    expect(screen.queryByText('新建脚本')).toBeNull()
    expect(screen.getByText('新建分组')).toBeTruthy()

    // 伪目录已移除:行直接在顶层,不再套「未分组」折叠头
    expect(screen.queryByText('未分组')).toBeNull()
    const row = screen.getByText('构建').closest('.app-row') as HTMLElement
    expect(row.style.marginLeft).toBe('31px') // depth 0:0*39 + 31,与顶层分组名对齐
  })

  it('有分组但 0 个脚本时,树仍然渲染(分组行上的 ＋ 是唯一建脚本入口)', async () => {
    const api = setupApi()
    api.scripts.list.mockResolvedValue([])
    api.groups.list.mockResolvedValue([
      { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' }
    ])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')

    // 回归:这里若显示「没有匹配的脚本」占位,树不渲染,用户将没有任何建脚本入口
    expect(screen.queryByText('没有匹配的脚本')).toBeNull()
    expect(screen.getByLabelText('在此目录新建脚本')).toBeTruthy()
    expect(screen.getByText('暂无脚本')).toBeTruthy()
  })
})
