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

/** 按目录名找分组头(.app-group-head;折叠必须点它本体,内部的 Typography 文本节点不一定冒泡) */
const groupHead = (name: string): HTMLElement =>
  [...document.querySelectorAll('.app-group-head')].find(
    (e) => e.getAttribute('aria-label') === `目录 ${name}`
  ) as HTMLElement

/** 按名称找脚本行(行是 .app-row,名字在 Typography.Text 里) */
const scriptRow = (name: string): HTMLElement => {
  const text = screen.getByText(name)
  const row = text.closest('.app-row') as HTMLElement
  expect(row).toBeTruthy()
  return row
}

const isSelected = (name: string): boolean => scriptRow(name).classList.contains('app-row-selected')

/**
 * 等右键菜单浮层渲染完并返回其可见菜单项文案。
 * 不用 `findByText('复制')`:antd 浮层是异步挂到 body 的,而 jsdom + testing-library
 * 的等待窗口与浮层的 motion 帧序不稳定,直接轮询 DOM 更可靠。
 * 只读**最后一个**浮层:antd 关闭后的浮层会留在 body 里(标 ant-dropdown-hidden),
 * 全文档查询会把上一个用例的残留项一起读进来。
 */
async function openContextMenuAndReadItems(row: HTMLElement): Promise<string[]> {
  fireEvent.contextMenu(row)
  for (let i = 0; i < 30; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const panels = [...document.querySelectorAll('.ant-dropdown')]
    const items = panels
      .slice(-1)
      .flatMap((p) => [...p.querySelectorAll('.ant-dropdown-menu-title-content')])
      .map((e) => e.textContent ?? '')
    if (items.length > 0) return items
  }
  return []
}

function renderSidebar(scripts = initialScripts, groups = initialGroups): void {
  // 挂载时 Sidebar 会 reload() → api.scripts.list / api.groups.list。
  // 若注入的夹具与 beforeEach 默认实现不一致,不同步改这两个 mock 就会被默认值覆盖
  // (表现为:传了 collapsedScripts 却渲染不出 s6,见审查 I-A 用例排查)。
  // 只在「传了非默认夹具」时改写,避免影响依赖默认 mock 时序的既有用例。
  if (scripts !== initialScripts || groups !== initialGroups) {
    const w = window as unknown as { api: { groups: { list: ReturnType<typeof vi.fn> } } }
    api.scripts.list.mockImplementation(async () => scripts)
    w.api.groups.list.mockImplementation(async () => groups)
  }
  useAppStore.setState({
    scripts,
    groups,
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

/**
 * 等挂载期的异步收尾完成。
 * Sidebar 挂载时会 `Promise.all([settings.get(), reload()])`,随后
 * `setCollapsedIds(从 settings 读回的折叠集合)` —— 这一步会**覆盖**在此之前发生的
 * 用户折叠操作(测试表现为「点了目录头却仍 expanded」)。真实 App 里这段等待极短,
 * 用户不可能抢在它前面点;测试必须显式对齐这个时序。
 */
async function flushMount(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
}

/**
 * 折叠态夹具:目录A(s1,s2) / 目录B(s3,s4,初始折叠) / 顶层 s5
 * 折叠后屏幕上只剩:A1、目录B 头、顶层 B1 —— s3/s4 不可见
 */
const gB = mkGroup('gB', '目录B', null, 1)
const s4 = mkScript('s4', '脚本B1', 'gB', 0)
const s5 = mkScript('s5', '脚本B2', 'gB', 1)
const s6 = mkScript('s6', '脚本C1', null, 3)
const collapsedScripts = [s1, s2, s4, s5, s6]
const collapsedGroups = [gA, gB]

function renderCollapsedSidebar(): void {
  renderSidebar(collapsedScripts, collapsedGroups)
  // 折叠 目录B:其脚本行 s3/s4 从 DOM 消失
  fireEvent.click(screen.getByText('目录B'))
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
    const items = await openContextMenuAndReadItems(scriptRow('脚本A2'))

    // A2 被预选中(store 选中),A1 的多选/详情高亮被清掉
    expect(isSelected('脚本A2')).toBe(true)
    expect(isSelected('脚本A1')).toBe(false)
    expect(items).toEqual(['复制', '删除'])
  })

  it('右键多选行:弹批量菜单「删除 N 个脚本」', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    const items = await openContextMenuAndReadItems(scriptRow('脚本A2'))

    expect(items).toEqual(['删除 2 个脚本'])
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
    const items = await openContextMenuAndReadItems(scriptRow('脚本A2'))

    expect(items).toEqual(['复制', '删除'])
  })

  it('脏 id 被剔除后的计数:3 个选 1 个失效 → 菜单显示 2 个', async () => {
    // 覆盖审查指出的缺口:此前只验证了「降级」,没验证「计数剔除」
    const scriptsWithC = [...initialScripts, mkScript('s4', '脚本C1', null, 3)]
    renderSidebar(scriptsWithC)
    // 先等挂载期的 reload 收尾:它内部已发出 list() 请求,若不先落地,
    // 下面换掉的 mockImplementation 影响不到「已在途」的那次 reload,
    // 它回来时会把全量(含 s1)写回 store,脏 id 就剔不掉了
    await flushMount()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.click(scriptRow('脚本C1'), { ctrlKey: true })
    // 模拟 脚本A1 被其他入口删除:列表与后续 reload 都不再含它
    // (只 setState 不够 —— reload 会走 mock 的 list() 把全量拉回来)
    const remaining = scriptsWithC.filter((s) => s.id !== 's1')
    api.scripts.list.mockImplementation(async () => remaining)
    act(() => {
      useAppStore.setState({ scripts: remaining })
    })
    await flushMount()
    const items = await openContextMenuAndReadItems(scriptRow('脚本A2'))

    expect(items).toEqual(['删除 2 个脚本'])
  })

  it('右键目录行:无右键菜单', async () => {
    renderSidebar()
    const head = document.querySelector('.app-group-head') as HTMLElement
    fireEvent.contextMenu(head)
    // 给浮层留一拍渲染窗口
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })
    expect(document.querySelectorAll('.ant-dropdown-menu-title-content').length).toBe(0)
    expect(screen.queryByText('删除目录')).toBeNull()
  })
})

describe('批量删除', () => {
  it('确认框只报总数不含名字;确认后逐条 remove 并 reload,选区清空', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    await openContextMenuAndReadItems(scriptRow('脚本A2'))
    fireEvent.click(screen.getByText('删除 2 个脚本'))

    // 确认框正文(2026-09-23 用户定稿):只报数量 + 不可撤销警示,不列脚本名
    const body = await screen.findByText(/确定删除/)
    expect(body.textContent).toBe('确定删除 2 个脚本?此操作不可撤销。')
    expect(body.textContent).not.toContain('脚本A1')
    expect(body.textContent).not.toContain('脚本A2')
    expect(body.textContent).not.toContain('「')
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }))

    await waitFor(() => expect(api.scripts.remove).toHaveBeenCalledTimes(2))
    expect(api.scripts.remove).toHaveBeenCalledWith('s1')
    expect(api.scripts.remove).toHaveBeenCalledWith('s2')
    // reload 走 scripts.list 重新拉取:挂载 1 次 + reload 1 次
    await waitFor(() => expect(api.scripts.list).toHaveBeenCalledTimes(2))
    // 选区清空:右键再开菜单回到单条语义
    const items = await openContextMenuAndReadItems(scriptRow('脚本A1'))
    expect(items).toEqual(['复制', '删除'])
  })

  it('部分失败:报错提示,成功的照常 reload', async () => {
    api.scripts.remove.mockImplementation(async (id: string) => {
      if (id === 's1') throw new Error('boom')
      return undefined
    })
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    await openContextMenuAndReadItems(scriptRow('脚本A2'))
    fireEvent.click(screen.getByText('删除 2 个脚本'))
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
    // 空目标分支本身已由 buildBatchDeletePlan 的单测覆盖(见 multiSelect.test.ts)
    const items = await openContextMenuAndReadItems(scriptRow('脚本B1'))
    expect(items).toEqual(['复制', '删除'])
  })
})

describe('多选回归(代码审查修复)', () => {
  it('折叠目录里的脚本不参与 Shift 范围:选区 = 屏幕上可见的行(C1)', async () => {
    renderCollapsedSidebar()
    // 折叠后 s4/s5(脚本B1/脚本B2)不在屏幕上,只剩 脚本A1、脚本A2、脚本C1
    expect(screen.queryByText('脚本B1')).toBeNull()
    expect(screen.queryByText('脚本B2')).toBeNull()

    fireEvent.click(scriptRow('脚本A1'))
    // 用户视角:从 脚本A1 Shift 点到屏幕上第 3 行的 脚本C1
    fireEvent.click(scriptRow('脚本C1'), { shiftKey: true })
    fireEvent.contextMenu(scriptRow('脚本C1'))

    // 选区只含可见的三行 —— 不得把折叠目录里的 2 个脚本偷偷算进来
    expect(await screen.findByText('删除 3 个脚本')).toBeTruthy()
  })

  it('Esc 清空后 Ctrl 单击只选该行:不把 stale 的详情选中行拉回选区(C2)', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.keyDown(window, { key: 'Escape' })
    // Esc 后详情选中仍是 脚本A1(规格:Esc 不回退详情选中)
    expect(isSelected('脚本A1')).toBe(true)

    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    const items = await openContextMenuAndReadItems(scriptRow('脚本A2'))

    // 期望:选区只有 脚本A2 → 单条菜单(而非「删除 2 个脚本」)
    expect(items).toContain('复制')
    expect(items.some((t) => /删除 \d+ 个脚本/.test(t))).toBe(false)
  })

  it('普通单击不算「主动清空」:随后首次 Ctrl 仍按既有语义播种', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'))
    fireEvent.click(scriptRow('脚本B1'), { ctrlKey: true })
    const items = await openContextMenuAndReadItems(scriptRow('脚本B1'))

    // 普通单击 = 重新开始选择,播种语义恢复 → 选区含上一个单击行 脚本A2
    expect(items).toEqual(['删除 2 个脚本'])
  })

  it('Esc 主动清空后再普通单击,首次 Ctrl 仍不播种(清空意图跨过中间点击仍生效)', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.keyDown(window, { key: 'Escape' })
    // 中间夹一次普通单击(此处若误判为「重新开始」则会把 A1 播种回来)
    fireEvent.click(scriptRow('脚本A2'))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(scriptRow('脚本B1'), { ctrlKey: true })
    const items = await openContextMenuAndReadItems(scriptRow('脚本B1'))

    expect(items).toEqual(['复制', '删除'])
  })

  it('首次 Ctrl 单击仍会把详情选中行纳入选区(既有语义不回归)', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    const items = await openContextMenuAndReadItems(scriptRow('脚本A2'))

    expect(items).toContain('删除 2 个脚本')
  })

  it('Ctrl 移出多选的行右键:按选区判定,不清掉仍在选区里的行(I1)', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    // 再 Ctrl 一次把 脚本A2 移出选区(它仍是详情选中行,视觉同为灰胶囊 —— 见下方视觉用例)
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    // 选中态区分靠 aria-selected(真实无障碍语义)而非自定义 data 属性,见审查 I-C:
    // 前者 screen reader 可读,且不会因 DOM 结构调整而静默失效。
    // 注意:视觉上两者现在无法区分(2026-09-23 用户要求去掉左侧主色条)
    expect(scriptRow('脚本A1').getAttribute('aria-selected')).toBe('true')
    expect(scriptRow('脚本A2').getAttribute('aria-selected')).toBe('false')

    // 右键「仅详情选中」的 脚本A2:按 inSelection 判定为「不在选区」→ 单选该行、清掉选区。
    // 这是规格内行为(右键未选中行 = 先单选该行);关键在于它不得误以为是多选而弹批量菜单
    const onMovedOut = await openContextMenuAndReadItems(scriptRow('脚本A2'))
    expect(onMovedOut).toEqual(['复制', '删除'])

    // 右键仍在选区里的 脚本A1:选区保持(此时选区只剩 1 个 → 按降级规则走单条菜单)
    const onInSelection = await openContextMenuAndReadItems(scriptRow('脚本A1'))
    expect(onInSelection).toEqual(['复制', '删除'])
    expect(scriptRow('脚本A1').getAttribute('aria-selected')).toBe('false')
  })

  it('选中行不画蓝色左侧竖条:主次选中只用灰胶囊(2026-09-23 用户要求去掉)', () => {
    renderSidebar()
    // 仅详情选中(不在多选选区):曾经会画 inset 2px 主色条,现已去掉
    fireEvent.click(scriptRow('脚本A2'))
    expect(scriptRow('脚本A2').style.boxShadow).not.toContain('inset 2px')
    expect(scriptRow('脚本A2').style.boxShadow).not.toContain('--app-primary')
    // 灰胶囊仍在(选中态的**唯一**视觉)
    expect(isSelected('脚本A2')).toBe(true)

    // 在多选选区里的行同样不画
    fireEvent.click(scriptRow('脚本A1'), { ctrlKey: true })
    expect(scriptRow('脚本A1').style.boxShadow).not.toContain('inset 2px')
    expect(scriptRow('脚本A1').getAttribute('aria-selected')).toBe('true')
  })

  it('确认框打开期间目标被删除:按执行时刻重新求交,不误报失败(I2)', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.contextMenu(scriptRow('脚本A2'))
    fireEvent.click(await screen.findByText('删除 2 个脚本'))

    // 确认框打开期间:脚本A1 被其他入口删掉(列表变化)
    act(() => {
      useAppStore.setState({ scripts: [s2, s3] })
    })
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }))

    // 只对仍存在的 脚本A2 调 remove;不存在的 id 静默跳过,不得报「1 个删除失败」
    await waitFor(() => expect(api.scripts.remove).toHaveBeenCalledTimes(1))
    expect(api.scripts.remove).toHaveBeenCalledWith('s2')
    expect(screen.queryByText(/个脚本删除失败/)).toBeNull()
  })

  it('锚点所在目录被折叠后 Shift:按无锚点处理,不塌缩成空选区(I-A)', async () => {
    // 展开态可见前序 = [脚本A1, 脚本A2, 脚本B1, 脚本B2, 脚本C1]
    renderSidebar(collapsedScripts, collapsedGroups)
    await flushMount()

    // Shift 立锚在 目录A 里的 脚本A2 上(此时锚点可见)
    fireEvent.click(scriptRow('脚本A2'), { shiftKey: true })
    expect(scriptRow('脚本A2').getAttribute('aria-selected')).toBe('true')

    // 折叠 目录A:锚点 s2 从可见前序里消失(屏幕上不再渲染该行)。
    // 必须点 .app-group-head 本体:getByText 命中的是内部已省略的 Typography 节点,
    // 在 jsdom 下不一定能把 click 冒泡到绑定的父元素
    fireEvent.click(groupHead('目录A'))
    await waitFor(() => expect(groupHead('目录A').getAttribute('aria-expanded')).toBe('false'))

    // Shift 点顶层 脚本C1:锚点已不可用 → 按无锚点处理(等价普通单击),
    // 修复前这里会 setSelectedIds(new Set([])) 得到空选区,而 selectionClearedRef
    // 已被清成 false —— 用户接着右键旧选区行仍会弹出「删除 N 个脚本」(不可逆的误删风险)
    fireEvent.click(scriptRow('脚本C1'), { shiftKey: true })
    expect(scriptRow('脚本C1').getAttribute('aria-selected')).toBe('true')

    // 选区非空的直接证据:右键该行时它确实在选区里 → 因只剩 1 个而降级为单条菜单
    // (若选区为空,右键未选中行也是单条菜单;两者的区别由下一行断言锁住 —— 
    //  修复前选区为空时 脚本C1 的 aria-selected 会是 'true' 但选区里其实没有它,
    //  表现为选区计数为 0,故这里再补一条「不是空选区」的间接证据:点击别的行会清空它)
    const items = await openContextMenuAndReadItems(scriptRow('脚本C1'))
    expect(items).toEqual(['复制', '删除'])
  })

  it('锚点所在目录折叠后 Shift 不产生空选区:后续 Shift 范围仍可用(I-A)', async () => {
    // 这条用例把「选区是空的」与「选区只含 C1」区分开:
    // 两者在 aria-selected 上看着一样,但 Ctrl 单击时的播种语义不同 ——
    // 空选区 + 未主动清空 → 播种把详情选中行纳入;非空选区 → 在现有选区上增删。
    renderSidebar(collapsedScripts, collapsedGroups)
    await flushMount()
    fireEvent.click(scriptRow('脚本A2'), { shiftKey: true })
    fireEvent.click(groupHead('目录A'))
    await waitFor(() => expect(groupHead('目录A').getAttribute('aria-expanded')).toBe('false'))
    fireEvent.click(scriptRow('脚本C1'), { shiftKey: true })
    // 锚点失效被当作「无锚点」处理 → 等价普通单击:C1 成为选区唯一成员。
    // 再 Shift 到 脚本B2:锚点应是 C1(已被重设),范围 = [B2, C1] 共 2 个
    fireEvent.click(scriptRow('脚本B2'), { shiftKey: true })
    expect(scriptRow('脚本B2').getAttribute('aria-selected')).toBe('true')
    expect(scriptRow('脚本C1').getAttribute('aria-selected')).toBe('true')
  })

  it('锚点仍可见时 Shift 范围照常展开(防修过头)', async () => {
    // 折叠的目录不含锚点 → 锚点仍在可见前序里,范围选择必须正常工作。
    // 这条用来防止 I-A 的修复「一刀切地把所有 Shift 都降级成单选」
    renderSidebar(collapsedScripts, collapsedGroups)
    await flushMount()
    // 折叠 目录B:可见前序变成 [脚本A1, 脚本A2, 脚本C1]
    fireEvent.click(groupHead('目录B'))
    await waitFor(() => expect(groupHead('目录B').getAttribute('aria-expanded')).toBe('false'))
    // 用 脚本A1 立锚(仍在可见前序里),Shift 到 脚本C1 → 范围 = [A1, A2, C1] 共 3 个
    fireEvent.click(scriptRow('脚本A1'), { shiftKey: true })
    fireEvent.click(scriptRow('脚本C1'), { shiftKey: true })
    const items = await openContextMenuAndReadItems(scriptRow('脚本C1'))
    expect(items).toContain('删除 3 个脚本')
  })
})
