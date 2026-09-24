import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  settings: Record<string, ReturnType<typeof vi.fn>>
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
      move: vi.fn(async () => undefined),
      reorder: vi.fn()
    },
    pty: { start: vi.fn(async () => ({ runId: 'r1', title: '构建' })) },
    settings: {
      // Sidebar 挂载会读入折叠状态并防抖写回,默认空集合 + 空实现
      get: vi.fn(async () => ({ collapsedGroupIds: [] })),
      update: vi.fn(async () => undefined)
    }
  }
  ;(window as unknown as { api: ApiMock }).api = api
  return api
}

beforeEach(() => {
  installJsdomShims()
  useAppStore.setState({
    scripts: [],
    groups: [],
    // search 也必须复位:搜索用例会把它留在上一个关键词上,污染后续用例的树
    search: '',
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

  it('选中深层脚本时,祖先目录仍可手动折叠(自动展开不得撤销用户的折叠操作)', async () => {
    // 复现「点击 OMS 无法合并」:OMS > 后端 > OMS-后端-DEV(选中态,对应截图)
    const api = setupApi()
    api.groups.list.mockResolvedValue([
      { id: 'g-oms', name: 'OMS', order: 0, parentId: null, createdAt: '' },
      { id: 'g-be', name: '后端', order: 0, parentId: 'g-oms', createdAt: '' }
    ])
    api.scripts.list.mockResolvedValue([
      { ...script, id: 's-dev', name: 'OMS-后端-DEV', groupId: 'g-be' }
    ])
    useAppStore.setState({ selectedScriptId: 's-dev', openTabs: ['s-dev'] })
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('OMS-后端-DEV')

    fireEvent.click(screen.getByText('OMS'))
    // 修复前:折叠动作本身触发自动展开 effect,把 OMS 立即顶回展开态,脚本行依然可见
    expect(screen.queryByText('OMS-后端-DEV')).toBeNull()

    fireEvent.click(screen.getByText('OMS'))
    await screen.findByText('OMS-后端-DEV')
  })

  it('搜索选中深层脚本后清空搜索,祖先链保持展开,选中行可见', async () => {
    const api = setupApi()
    api.groups.list.mockResolvedValue([
      { id: 'g-oms', name: 'OMS', order: 0, parentId: null, createdAt: '' },
      { id: 'g-be', name: '后端', order: 0, parentId: 'g-oms', createdAt: '' }
    ])
    api.scripts.list.mockResolvedValue([
      { ...script, id: 's-dev', name: 'OMS-后端-DEV', groupId: 'g-be' }
    ])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('OMS-后端-DEV')

    // 先折叠 OMS,模拟「搜索前用户收起过顶层」
    fireEvent.click(screen.getByText('OMS'))
    expect(screen.queryByText('OMS-后端-DEV')).toBeNull()

    // 搜索命中深层脚本(强制展开),点击选中
    fireEvent.change(screen.getByPlaceholderText('搜索脚本'), { target: { value: 'DEV' } })
    await screen.findByText('OMS-后端-DEV')
    fireEvent.click(screen.getByText('OMS-后端-DEV'))

    // 清空搜索 → 祖先链保持展开,选中行可见(只展开直接父目录时 OMS 仍折叠,行看不见)
    fireEvent.change(screen.getByPlaceholderText('搜索脚本'), { target: { value: '' } })
    await screen.findByText('OMS-后端-DEV')
  })

  it('在折叠的目录上点 ＋ 新建脚本,目录自动展开让落点可见', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByText('wms'))
    expect(screen.queryByText('构建')).toBeNull()

    // ＋ 的事件驱动展开:与「新建子目录」菜单行为一致,不依赖自动展开 effect
    fireEvent.click(screen.getByLabelText('在此目录新建脚本'))
    await waitFor(() =>
      expect(useAppStore.getState().form).toEqual({ type: 'script-create', groupId: 'g1' })
    )
    await screen.findByText('构建')
  })
})

describe('折叠状态持久化', () => {
  /** 顶层分组 g1 + 其下脚本,settings.get 返回指定折叠集合 */
  function setupPersisted(collapsed: string[]): ApiMock {
    const api = setupApi()
    api.settings.get.mockResolvedValue({ collapsedGroupIds: collapsed })
    api.groups.list.mockResolvedValue([
      { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' }
    ])
    api.scripts.list.mockResolvedValue([{ ...script, id: 's1', groupId: 'g1' }])
    return api
  }

  it('挂载时读入设置里的折叠状态,对应目录初始收起', async () => {
    setupPersisted(['g1'])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')
    // 读入生效:g1 初始即为折叠(读入与列表加载是并发的,用 waitFor 消除时序抖动)
    await waitFor(() => expect(screen.queryByText('构建')).toBeNull())
    // 内存态与读入态一致地工作:点开即展开
    fireEvent.click(screen.getByText('wms'))
    await screen.findByText('构建')
  })

  it('折叠变化后防抖写回设置,只包含现存目录 id', async () => {
    const api = setupPersisted([])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByText('wms'))
    // 防抖 300ms 后写回;读入基线守卫保证启动路径不会插入幂等写,last call 即用户折叠的结果
    await waitFor(() => expect(api.settings.update).toHaveBeenCalled())
    const calls = api.settings.update.mock.calls as Array<[{ collapsedGroupIds: string[] }]>
    const lastPatch = calls[calls.length - 1][0]
    expect(lastPatch.collapsedGroupIds).toEqual(['g1'])
  })

  it('写回前滤除已删除目录的 id,存量死 id 不会回流盘上', async () => {
    // 'dead' 目录已不存在:读入时被 prune 掉,展开 g1 后写回只剩现存 id
    const api = setupPersisted(['g1', 'dead'])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    // g1 初始折叠(死 id 不影响折叠语义)
    await screen.findByText('wms')
    await waitFor(() => expect(screen.queryByText('构建')).toBeNull())

    // 展开最后一个折叠目录 → 折叠集合变空 → 防抖写回
    fireEvent.click(screen.getByText('wms'))
    await screen.findByText('构建')
    await waitFor(() => expect(api.settings.update).toHaveBeenCalled())
    const calls = api.settings.update.mock.calls as Array<[{ collapsedGroupIds: string[] }]>
    const lastPatch = calls[calls.length - 1][0]
    expect(lastPatch.collapsedGroupIds).toEqual([])
    // 死 id 从未出现在任何一次写回里
    for (const [patch] of calls) {
      expect(patch.collapsedGroupIds).not.toContain('dead')
    }
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
      groups: { list: vi.fn(async () => [parent, child]) },
      settings: { get: vi.fn(async () => ({ collapsedGroupIds: [] })), update: vi.fn(async () => undefined) }
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

    // 嵌套结构断言:pda 的分组头在 wms 的展开容器内(平铺实现下两者是兄弟,此断言失败)
    const wmsHead = screen.getByText('wms').closest('.app-group-head') as HTMLElement
    const pdaHead = screen.getByText('pda').closest('.app-group-head') as HTMLElement
    expect(wmsHead.parentElement!.contains(pdaHead)).toBe(true)
    // 层级缩进(截图实测:每级 8px):depth 1 的分组头 paddingLeft = 4 + 1 * 8
    expect(pdaHead.style.paddingLeft).toBe('12px')
    // 脚本名与同级目录名同列:depth 2 的名称列 = 39(箭头10+gap6+图标13+gap6) + 2 * 8
    const row = screen.getByText('拣货').closest('.app-row') as HTMLElement
    expect(row.style.paddingLeft).toBe('55px')
    // 不再用 marginLeft 内缩:悬停胶囊从行首开始铺满,与目录行一致
    expect(row.style.marginLeft).toBe('')

    // 层级对齐线:画在**本目录**箭头中心列(4 + depth*8 + 5),贯通整个子项块
    // wms(depth0) 的线在 9px,pda(depth1) 的线在 17px
    const guides = [...document.querySelectorAll('.app-guide')] as HTMLElement[]
    expect(guides.length).toBe(2)
    expect(guides.map((g) => g.style.left).sort()).toEqual(['17px', '9px'])
    // 关键回归:线落在父项箭头中心(旧实现落在子项箭头中心,线会穿过子项箭头字形)
    expect(parseFloat(guides[0].style.left)).toBe(parseFloat(wmsHead.style.paddingLeft) + 5)
  })
})

describe('Postman 式搜索', () => {
  /** wms > pda > 拣货导入;wms 直挂 盘点/巡检 */
  function setupTree(): ApiMock {
    const api = setupApi()
    const g1: Group = { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' }
    const g2: Group = { id: 'g2', name: 'pda', order: 0, parentId: 'g1', createdAt: '' }
    const s1: Script = { ...script, id: 's1', name: '拣货导入', groupId: 'g2' }
    const s2: Script = { ...script, id: 's2', name: '盘点', groupId: 'g1' }
    const s3: Script = { ...script, id: 's3', name: '巡检', groupId: 'g1' }
    api.groups.list.mockResolvedValue([g1, g2])
    api.scripts.list.mockResolvedValue([s1, s2, s3])
    return api
  }

  const search = async (keyword: string): Promise<void> => {
    fireEvent.change(screen.getByPlaceholderText('搜索脚本'), { target: { value: keyword } })
    await waitFor(() => expect(useAppStore.getState().search).toBe(keyword))
  }

  it('命中脚本时展示祖先目录链,未命中的兄弟脚本隐藏', async () => {
    setupTree()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')
    await search('导入')

    expect(screen.getByText('拣货导入')).toBeTruthy()
    // 祖先目录作为路径保留
    expect(screen.getByText('wms')).toBeTruthy()
    expect(screen.getByText('pda')).toBeTruthy()
    // 未命中的兄弟脚本与空目录噪音全部隐藏
    expect(screen.queryByText('盘点')).toBeNull()
    expect(screen.queryByText('巡检')).toBeNull()
    expect(screen.queryByText('暂无脚本')).toBeNull()
  })

  it('目录名命中时整棵子树保留(含未命中的脚本)', async () => {
    setupTree()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')
    await search('wms')

    expect(screen.getByText('wms')).toBeTruthy()
    expect(screen.getByText('pda')).toBeTruthy()
    expect(screen.getByText('拣货导入')).toBeTruthy()
    expect(screen.getByText('盘点')).toBeTruthy()
    expect(screen.getByText('巡检')).toBeTruthy()
  })

  it('完全无命中显示占位,且不再渲染任何目录行', async () => {
    setupTree()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')
    await search('zzz')

    expect(screen.getByText('没有匹配的脚本')).toBeTruthy()
    expect(screen.queryByText('wms')).toBeNull()
    expect(screen.queryByText('暂无脚本')).toBeNull()
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

    // 顶部工具栏:搜索 + 新建分组图标;新建脚本已收敛到层级内(目录 ＋ / 空目录引导块)
    expect(screen.queryByText('新建脚本')).toBeNull()
    expect(screen.queryByLabelText('新建脚本')).toBeNull()
    expect(screen.getByLabelText('新建分组')).toBeTruthy()
    // 伪目录已移除:行直接在顶层,不再套「未分组」折叠头
    expect(screen.queryByText('未分组')).toBeNull()
    const row = screen.getByText('构建').closest('.app-row') as HTMLElement
    // depth 0 的脚本名与同级目录名同列:4(行内边距) + 10(箭头) + 6 + 13(图标) + 6
    expect(row.style.paddingLeft).toBe('39px')
  })

  it('工具栏「新建分组」用纯 + 图标,不用文件夹+号(2026-09-24 用户要求)', async () => {
    setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    const btn = screen.getByLabelText('新建分组')
    // ant-plus 是 PlusOutlined 的图标类名;ant-folder-add 是 FolderAddOutlined 的。
    // 断言在前者、不在后者 —— 否则将来有人把图标换回文件夹+号不会有任何反馈。
    expect(btn.querySelector('.anticon-plus')).toBeTruthy()
    expect(btn.querySelector('.anticon-folder-add')).toBeNull()
  })

  it('目录行 ⋯ 菜单是纯文字:三项都不渲染图标,但删除项保留红色警示', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')

    fireEvent.click(screen.getByLabelText('分组操作'))
    await screen.findByText('新建子目录')

    const menuItem = (label: string): HTMLElement =>
      screen.getByText(label).closest('.ant-dropdown-menu-item') as HTMLElement

    // 菜单项内不得出现任何图标节点(.anticon)。刻意「全去」而非「只去新建子目录」:
    // 只去一项会让该项文字左移、与其余各项错开(antd 按项计算左对齐),见规格 2026-09-24。
    for (const label of ['新建子目录', '重命名', '删除目录']) {
      expect(menuItem(label).querySelector('.anticon')).toBeNull()
    }

    // 对照组:去掉图标后,红色是「删除目录」唯一的危险提示,不能被一并优化掉
    expect(menuItem('删除目录').className).toContain('danger')
    expect(menuItem('新建子目录').className).not.toContain('danger')
    expect(menuItem('重命名').className).not.toContain('danger')
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
    // 空目录展开后给一行提示,不再是一片空白
    expect(screen.getByText('暂无脚本')).toBeTruthy()
  })

  it('空目录引导块的「新建子目录」按钮只有文字,不带图标(2026-09-24)', async () => {
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

    // 同屏还有「新建脚本」按钮(它保留 ＋ 图标),所以按文字精确定位到子目录那个
    const guide = screen.getByText('新建子目录').closest('button') as HTMLElement
    expect(guide).toBeTruthy()
    expect(guide.querySelector('.anticon')).toBeNull()
    // 对照组:旁边「新建脚本」按钮的图标是本次范围外的东西,不应被误伤
    const scriptBtn = screen.getByText('新建脚本').closest('button') as HTMLElement
    expect(scriptBtn.querySelector('.anticon-plus')).toBeTruthy()
  })

  it('脚本行 ⋯ 菜单是纯文字:复制/删除都不渲染图标,但删除项保留红色警示', async () => {
    setupApi()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    fireEvent.click(screen.getByLabelText('更多操作'))
    await screen.findByText('复制')
    // 与目录行菜单同一口径:全去而非只去一项,否则文字左右跳动(antd 按项计算左对齐)
    for (const label of ['复制', '删除']) {
      const item = screen.getByText(label).closest('.ant-dropdown-menu-item') as HTMLElement
      expect(item.querySelector('.anticon')).toBeNull()
    }
    // 对照组:去掉图标后,红色是「删除」唯一的危险提示,不能被一并优化掉
    const del = screen.getByText('删除').closest('.ant-dropdown-menu-item') as HTMLElement
    expect(del.className).toContain('danger')
    const copy = screen.getByText('复制').closest('.ant-dropdown-menu-item') as HTMLElement
    expect(copy.className).not.toContain('danger')
  })

  it('批量删除菜单项同样不带图标(与单条菜单共用槽位,留图标会左右跳动)', async () => {
    const api = setupApi()
    // 批量菜单要两条以上有效选区才会出现
    api.scripts.list.mockResolvedValue([script, copy])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('构建')

    // 与 sidebarMultiSelect.test.tsx 同一套行定位约定:按名字找 .app-row
    const row = (name: string): HTMLElement =>
      screen.getByText(name).closest('.app-row') as HTMLElement
    fireEvent.click(row('构建'))
    fireEvent.click(row('构建 副本'), { ctrlKey: true })

    // 多选后右键任一行,菜单项切换成「删除 N 个脚本」
    fireEvent.contextMenu(row('构建 副本'))
    const batchItem = (await screen.findByText(/删除 \d+ 个脚本/)).closest(
      '.ant-dropdown-menu-item'
    ) as HTMLElement
    expect(batchItem).toBeTruthy()
    expect(batchItem.querySelector('.anticon')).toBeNull()
    // 危险语义仍要保留:去掉图标后,红色是它唯一的警示
    expect(batchItem.className).toContain('danger')
  })

  it('「暂无脚本」提示只出现在真正空的那一层,折叠后不显示', async () => {
    const api = setupApi()
    api.scripts.list.mockResolvedValue([])
    api.groups.list.mockResolvedValue([
      { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' },
      { id: 'g2', name: 'pda', order: 0, parentId: 'g1', createdAt: '' }
    ])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    const pdaHead = (await screen.findByText('pda')).closest('.app-group-head') as HTMLElement

    // wms 有子目录,所以只有 pda 那层提示
    const hints = screen.getAllByText('暂无脚本')
    expect(hints.length).toBe(1)
    // 引导块挂在自己那一层的子项容器里(分组头之后紧跟的兄弟节点)
    const block = hints[0].parentElement as HTMLElement
    expect(pdaHead.nextElementSibling!.contains(block)).toBe(true)
    // 左沿对齐子项的图标列:4 + 箭头10 + gap6 + 2 * 8(depth1 的子项 = depth2)
    expect(block.style.paddingLeft).toBe('36px')

    // 引导块带两个直达按钮,替代「目录行悬停 ＋」这条唯一入口的不可发现性
    fireEvent.click(screen.getByText('新建脚本'))
    await waitFor(() => expect(useAppStore.getState().form).toEqual({ type: 'script-create', groupId: 'g2' }))

    // 收起后该层不渲染任何内容,提示随之消失
    fireEvent.click(screen.getByText('pda'))
    expect(screen.queryByText('暂无脚本')).toBeNull()
    expect(screen.queryByText('新建脚本')).toBeNull()
  })

  it('把顶层脚本拖到空目录引导块 = 移入该目录,而不是被树容器接管成「移到顶层」', async () => {
    const api = setupApi() // 一条 groupId 为 null 的顶层脚本「构建」
    api.groups.list.mockResolvedValue([
      { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' }
    ])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')
    const row = screen.getByText('构建').closest('.app-row') as HTMLElement
    const block = screen.getByText('暂无脚本').parentElement as HTMLElement

    const dt = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => '') }
    fireEvent.dragStart(row, { dataTransfer: dt })
    fireEvent.dragOver(block, { dataTransfer: dt })
    fireEvent.drop(block, { dataTransfer: dt })

    await waitFor(() => expect(api.scripts.update).toHaveBeenCalledWith('s1', { groupId: 'g1' }))
  })
})

describe('拖拽排序与跨目录移动(组件级)', () => {
  /** 两条顶层脚本:构建(order 0) / 盘点(order 1) */
  function setupTwoScripts(): ApiMock {
    const api = setupApi()
    const s1: Script = { ...script, id: 's1', name: '构建', groupId: null, order: 0 }
    const s2: Script = { ...script, id: 's2', name: '盘点', groupId: null, order: 1 }
    api.scripts.list.mockResolvedValue([s1, s2])
    return api
  }

  it('拖到同级脚本行的后半段 = 同父重排,order 序列按插入结果计算', async () => {
    const api = setupTwoScripts()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('盘点')
    const dragRow = screen.getByText('构建').closest('.app-row') as HTMLElement
    const overRow = screen.getByText('盘点').closest('.app-row') as HTMLElement

    const dt = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => '') }
    fireEvent.dragStart(dragRow, { dataTransfer: dt })
    // jsdom 的 rect 全 0:ratio = clientY / max(height,1),clientY 传 1 → ratio ≥ 0.5 → 落点 after
    fireEvent.dragOver(overRow, { dataTransfer: dt, clientY: 1 })
    fireEvent.drop(overRow, { dataTransfer: dt })

    await waitFor(() => expect(api.scripts.reorder).toHaveBeenCalledWith(['s2', 's1']))
  })

  it('拖到目录行的中间区域 = 移入该目录,order 追加到新兄弟末尾', async () => {
    const api = setupApi()
    api.groups.list.mockResolvedValue([
      { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' }
    ])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('wms')
    const row = screen.getByText('构建').closest('.app-row') as HTMLElement
    const head = screen.getByText('wms').closest('.app-group-head') as HTMLElement

    const dt = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => '') }
    fireEvent.dragStart(row, { dataTransfer: dt })
    // clientY 0.5 落在目录行中间 1/3 → into
    fireEvent.dragOver(head, { dataTransfer: dt, clientY: 0.5 })
    fireEvent.drop(head, { dataTransfer: dt })

    await waitFor(() => expect(api.scripts.update).toHaveBeenCalledWith('s1', { groupId: 'g1' }))
    await waitFor(() => expect(api.scripts.reorder).toHaveBeenCalledWith(['s1']))
  })

  it('把目录拖到自己的后代上,UI 拒绝落点且不发起移动(分组头与空目录引导块两条路径)', async () => {
    const api = setupApi()
    api.groups.list.mockResolvedValue([
      { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' },
      { id: 'g2', name: 'pda', order: 0, parentId: 'g1', createdAt: '' }
    ])
    api.scripts.list.mockResolvedValue([])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('pda')
    const g1Head = screen.getByText('wms').closest('.app-group-head') as HTMLElement
    const g2Head = screen.getByText('pda').closest('.app-group-head') as HTMLElement
    const block = screen.getByText('暂无脚本').parentElement as HTMLElement

    const dt = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => '') }
    fireEvent.dragStart(g1Head, { dataTransfer: dt })

    // 后代分组头:dragOver 不 preventDefault = 拒绝落点,dropHint 不会出现,drop 无动作
    fireEvent.dragOver(g2Head, { dataTransfer: dt })
    fireEvent.drop(g2Head, { dataTransfer: dt })
    // 空目录引导块同样要拒绝(回归:曾因「空目录没有后代」的错误注释漏判,
    // 把顶层目录拖到它自己的空子目录引导块上,先高亮承诺可放、落下才报防环错误)
    fireEvent.dragOver(block, { dataTransfer: dt })
    fireEvent.drop(block, { dataTransfer: dt })

    expect(api.groups.move).not.toHaveBeenCalled()
    expect(api.groups.reorder).not.toHaveBeenCalled()
  })

  it('把子目录拖到列表空白处 = 移到顶层,与脚本行为对称', async () => {
    const api = setupApi()
    api.groups.list.mockResolvedValue([
      { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' },
      { id: 'g2', name: 'pda', order: 0, parentId: 'g1', createdAt: '' }
    ])
    api.scripts.list.mockResolvedValue([])
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('pda')
    const g2Head = screen.getByText('pda').closest('.app-group-head') as HTMLElement
    const tree = document.querySelector('.app-tree') as HTMLElement

    const dt = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => '') }
    fireEvent.dragStart(g2Head, { dataTransfer: dt })
    fireEvent.dragOver(tree, { dataTransfer: dt })
    fireEvent.drop(tree, { dataTransfer: dt })

    await waitFor(() => expect(api.groups.move).toHaveBeenCalledWith('g2', null))
  })
})
describe('删除目录确认框', () => {
  /** 顶层「wms」+ 子目录「pda」+ pda 下脚本,供删除确认框用例共用 */
  function setupTree(): ApiMock {
    const api = setupApi()
    api.groups.list.mockResolvedValue([
      { id: 'g1', name: 'wms', order: 0, parentId: null, createdAt: '' },
      { id: 'g2', name: 'pda', order: 0, parentId: 'g1', createdAt: '' }
    ])
    api.scripts.list.mockResolvedValue([
      { ...script, id: 's2', name: '同步', groupId: 'g2', order: 0 }
    ])
    return api
  }

  /** 打开指定目录行的 ⋯ 菜单并点「删除目录」,弹出确认框 */
  async function openDeleteConfirm(name: string): Promise<void> {
    const head = screen.getByText(name).closest('.app-group-head') as HTMLElement
    fireEvent.click(within(head).getByRole('button', { name: '分组操作' }))
    fireEvent.click(await screen.findByText('删除目录'))
  }

  // 超时放宽到 15s(默认 5s):用例要串起 Dropdown → Modal 两层浮层,
  // jsdom 下 antd 各浮层的 motion 定时器 + 全量并行负载会把单步推到秒级
  it('确认框交代级联删除后果且不列数量,确认后 remove(id)', { timeout: 15000 }, async () => {
    const api = setupTree()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    await screen.findByText('pda')
    await openDeleteConfirm('pda')

    // 文案定稿:只交代「连子目录与脚本一并删」+ 不可撤销,不列数量
    const body = await screen.findByText(/删除目录『pda』/)
    expect(body.textContent).toBe('删除目录『pda』?其下脚本与子目录将一并删除,此操作不可撤销。')

    fireEvent.click(screen.getByRole('button', { name: /^删\s?除$/ }))
    await waitFor(() => expect(api.groups.remove).toHaveBeenCalledWith('g2'))
  })
})
