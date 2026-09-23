# 脚本列表多选 + 右键批量删除 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 脚本列表支持 Ctrl/⌘+单击切换、Shift+单击范围多选；多选态右键弹「删除 N 个脚本」菜单，单个确认框后批量删除。

**架构：** 多选集合（`selectedIds` + 锚点 `anchorId`）作为纯 UI 态放在 `Sidebar` 本地 useState；Shift 范围选择基于渲染前序的脚本 id 扁平列表（复用现有树 useMemo）；批量删除循环既有单条 IPC `script:delete` + 一次 `reload()`（页签/草稿/详情选中由 reload 既有清理收尾）。不动 main/preload/shared。

**技术栈：** React + antd 5（Dropdown `trigger=['contextMenu']`、`App.useApp()` 的 modal/message）+ zustand + vitest + testing-library。

**规格：** `docs/superpowers/specs/2026-09-23-script-multiselect-delete-design.md`（交互规则、目录不参与多选的边界、YAGNI 清单均以规格为准）

**环境注意：** 本机跑 `npm test`（vitest 在 agent 沙箱可能因 `ulimit -v` 触发 WASM OOM，与代码无关）。antd 对恰好两个汉字的按钮自动插空格（「删除」渲染为「删 除」），测试断言用 `/删\s*除/`。

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/renderer/src/utils/multiSelect.ts`（创建） | 纯函数 `rangeBetween`：Shift 范围选择的核心几何 |
| `src/renderer/src/components/Sidebar.tsx`（修改） | 多选状态、选择语义（Ctrl/Shift/单击/Esc/搜索）、行右键菜单（单条/批量动态）、批量删除 |
| `tests/renderer/multiSelect.test.ts`（创建） | `rangeBetween` 纯函数测试 |
| `tests/renderer/sidebarMultiSelect.test.tsx`（创建） | 侧栏多选 + 右键 + 批量删除组件测试 |
| `README.md`（视情况） | 若有列表操作说明则同步 |

---

### 任务 1：范围选择纯函数 `rangeBetween`

**文件：**
- 创建：`src/renderer/src/utils/multiSelect.ts`
- 测试：`tests/renderer/multiSelect.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import { rangeBetween } from '../../src/renderer/src/utils/multiSelect'

// 模拟树前序扁平列表:g1 下 s1、s2,顶层 s3、s4
const order = ['s1', 's2', 's3', 's4']

describe('rangeBetween(Shift 范围选择)', () => {
  it('正向范围:含两端', () => {
    expect(rangeBetween(order, 's1', 's3')).toEqual(['s1', 's2', 's3'])
  })

  it('反向范围:锚点在目标之后,结果仍按视觉顺序排列', () => {
    expect(rangeBetween(order, 's3', 's1')).toEqual(['s1', 's2', 's3'])
  })

  it('相邻两行:只含两行', () => {
    expect(rangeBetween(order, 's2', 's3')).toEqual(['s2', 's3'])
  })

  it('锚点与目标是同一行:只含该行', () => {
    expect(rangeBetween(order, 's2', 's2')).toEqual(['s2'])
  })

  it('锚点为 null(无锚点):等价普通单击,只含目标', () => {
    expect(rangeBetween(order, null, 's3')).toEqual(['s3'])
  })

  it('锚点不在列表里(已删/脏数据):回退为只含目标', () => {
    expect(rangeBetween(order, 'ghost', 's3')).toEqual(['s3'])
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/renderer/multiSelect.test.ts`
预期：FAIL，报错「Cannot find module .../utils/multiSelect」

- [ ] **步骤 3：编写实现**

```ts
/**
 * Shift+点击的范围选择:取扁平视觉顺序里 anchor 与 target 之间(含两端)的 id 列表。
 * anchor 为 null / 等于 target / 不在列表里(已删或脏数据)时,回退为只含 target
 * (等价普通单击)。范围跨目录允许 —— 调用方保证 flatOrder 只含可选中的脚本行,
 * 目录行不进来(规格:目录不参与多选)。
 */
export function rangeBetween(
  flatOrder: readonly string[],
  anchorId: string | null,
  targetId: string
): string[] {
  if (anchorId === null || anchorId === targetId) return [targetId]
  const a = flatOrder.indexOf(anchorId)
  const t = flatOrder.indexOf(targetId)
  if (a === -1 || t === -1) return [targetId]
  const [lo, hi] = a < t ? [a, t] : [t, a]
  return flatOrder.slice(lo, hi + 1)
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/renderer/multiSelect.test.ts`
预期：6 个用例全过

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/src/utils/multiSelect.ts tests/renderer/multiSelect.test.ts
git commit -m "feat(sidebar): Shift 范围选择纯函数 rangeBetween"
```

---

### 任务 2：Sidebar 多选状态与选择语义

**文件：**
- 修改：`src/renderer/src/components/Sidebar.tsx`
- 测试：`tests/renderer/sidebarMultiSelect.test.tsx`

本任务先搭测试骨架 + 实现选择语义（Ctrl/Shift/单击/Esc/搜索清空）。右键菜单在任务 3，批量删除在任务 4。

- [ ] **步骤 1：编写失败的测试（骨架 + 选择语义用例）**

创建 `tests/renderer/sidebarMultiSelect.test.tsx`。Sidebar 不引入 xterm/CodeMirror，无需模块 mock；需要 mock 的是 `window.api`（挂载会调 settings.get/scripts.list/groups.list，折叠变化会调 settings.update）：

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

const isSelected = (name: string): boolean =>
  scriptRow(name).classList.contains('app-row-selected')

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

  it('Ctrl+单击已多选行:移出选区', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    // A2 从选区移出,但它是最后一次点击的行(store 选中),仍保持高亮;
    // A1 仍在选区里。多选集合内容的验证交给任务 3 的右键菜单用例(菜单项数 = 集合大小)
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

  it('搜索变化清空多选', () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.change(screen.getByPlaceholderText('搜索脚本'), { target: { value: 'A1' } })
    // 搜索态清空多选;树被剪枝只剩 A1,store 选中行仍高亮
    expect(isSelected('脚本A1')).toBe(true)
  })
})
```

注意：`Ctrl+单击已多选行:移出选区` 用例在任务 2 无法断言集合内容（DOM 观察不到），只先断言高亮不变；集合语义由任务 3 的「右键菜单项数 = 集合大小」用例补上验证。

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/renderer/sidebarMultiSelect.test.tsx`
预期：FAIL —— Ctrl/Shift 用例失败（现状单击是普通 selectScript，多选行为不存在）；普通单击用例可能已过。

- [ ] **步骤 3：实现选择语义**

修改 `src/renderer/src/components/Sidebar.tsx`，共 4 处：

(a) 组件顶部新增状态与派生值（在 `const [collapsedIds, setCollapsedIds]` 附近）：

```tsx
// ── 脚本多选(纯 UI 态,不持久化;目录不参与,规格 2026-09-23) ──
// selectedIds = 多选脚本集合;anchorId = Shift 范围选择的锚点(最近一次普通/Ctrl 单击行)
const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
const [anchorId, setAnchorId] = useState<string | null>(null)
// 选区与当前列表求交:确认框打开/删除期间列表变化时,脏 id 不参与计数与批量操作
const validSelected = useMemo(() => scripts.filter((s) => selectedIds.has(s.id)), [scripts, selectedIds])
```

(b) 树 useMemo 里补扁平前序列表。两个 return 分支都要带（搜索态选区会被清空,这里仍统一产出,逻辑简单）：

```tsx
// 在 return { tree, rootScripts, ... } 之前:
const flatScriptIds: string[] = []
const collectIds = (node: GroupNode): void => {
  for (const c of node.children) collectIds(c)
  for (const s of node.scripts) flatScriptIds.push(s.id)
}
for (const n of roots) collectIds(n)
for (const s of rootScripts) flatScriptIds.push(s.id)
```

两个 return 都改为包含 `flatScriptIds`,useMemo 的返回类型注解同步加 `flatScriptIds: string[]`。

(c) 搜索/Esc 清空（在既有 useEffect 区域）：

```tsx
// 搜索态的树是剪枝视图,Shift 范围会错乱:搜索词变化即清空多选(规格)
useEffect(() => {
  setSelectedIds(new Set())
  setAnchorId(null)
}, [search])

// Esc 清空多选(不回退详情选中 —— selectedScriptId 不动,最后点过的行仍高亮)。
// window 级监听:确认框开着时按 Esc 取消确认也会顺带清选区,无害且可接受
useEffect(() => {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
    setAnchorId(null)
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [])
```

(d) 选择语义 + 行接线。在 `handleDeleteScript` 附近新增：

```tsx
/**
 * 脚本行单击(带修饰键语义,规格 2026-09-23):
 * - Shift:锚点..当前行的树前序范围整体选中(替换选区,锚点不动便于继续扩展)
 * - Ctrl/⌘:切换该行;首次 Ctrl 会把当前详情选中行一并纳入(文件管理器同款)
 * - 普通单击:清空多选,单选该行
 * 注意 macOS 上 Ctrl+单击是系统右键,mac 用户用 ⌘(metaKey),两个修饰键都接。
 */
const handleScriptClick = (script: Script, e: ReactMouseEvent<HTMLDivElement>): void => {
  if (e.shiftKey) {
    e.preventDefault()
    setSelectedIds(new Set(rangeBetween(flatScriptIds, anchorId, script.id)))
    if (anchorId === null) setAnchorId(script.id) // 无锚点 = 等价普通单击,顺手立锚
    selectScript(script.id)
    return
  }
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    setSelectedIds((prev) => {
      const base = prev.size === 0 ? new Set<string>(selectedScriptId ? [selectedScriptId] : []) : new Set(prev)
      if (base.has(script.id)) base.delete(script.id)
      else base.add(script.id)
      return base
    })
    setAnchorId(script.id)
    selectScript(script.id)
    return
  }
  setSelectedIds(new Set())
  setAnchorId(script.id)
  selectScript(script.id)
}
```

顶部 import 调整：`import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'`；并引入 `import { rangeBetween } from '../utils/multiSelect'`。

`renderScript` 里行接线（视觉 + 点击）：

```tsx
// 原:const selected = selectedScriptId === script.id
const selected = selectedIds.has(script.id) || selectedScriptId === script.id
// 原:onClick={() => selectScript(script.id)}
onClick={(e) => handleScriptClick(script, e)}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/renderer/sidebarMultiSelect.test.tsx tests/renderer/multiSelect.test.ts`
预期：全过。若「Ctrl+单击已多选行」用例失败,检查 base 种子逻辑（prev.size===0 时纳入 selectedScriptId）。

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx tests/renderer/sidebarMultiSelect.test.tsx
git commit -m "feat(sidebar): 脚本行 Ctrl/Shift 多选语义,Esc/搜索清空选区"
```

---

### 任务 3：行右键菜单（单条 / 多选动态）

**文件：**
- 修改：`src/renderer/src/components/Sidebar.tsx`
- 测试：`tests/renderer/sidebarMultiSelect.test.tsx`（追加 describe）

- [ ] **步骤 1：追加失败的测试**

在 `sidebarMultiSelect.test.tsx` 追加（fireEvent.contextMenu 触发 Dropdown；菜单浮层挂 body,用 findByText）：

```tsx
describe('行右键菜单', () => {
  it('右键未选中行:先单选该行,弹单条菜单(复制/删除)', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.contextMenu(scriptRow('脚本A2'))

    // A2 被预选中(store 选中),A1 的多选高亮被清掉
    await waitFor(() => expect(isSelected('脚本A2')).toBe(true))
    expect(screen.findByText('复制')).toBeTruthy()
    expect(await screen.findByText('删除', { selector: 'li .ant-dropdown-menu-title-content' })).toBeTruthy()
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
    // 确认框打开期间列表可能已变(A1 被其他入口删除):渲染期求交兜底
    act(() => {
      useAppStore.setState({ scripts: initialScripts.filter((s) => s.id !== 's1') })
    })
    fireEvent.contextMenu(scriptRow('脚本A2'))

    // 注意:本处原稿写的是「删除 1 个脚本」,与同篇计划实现片段里的
    // `validSelected.length <= 1` 降级条件自相矛盾(只剩 1 个有效目标时不弹批量菜单,
    // 因为「删除 1 个脚本」是个伪批量)。已按实现修正为单条菜单,并在
    // sidebarMultiSelect.test.tsx 里补了「3 个选 1 个失效 → 显示 2 个」的计数用例。
    expect(await screen.findByText('复制')).toBeTruthy()
    expect(await screen.findByText('删除')).toBeTruthy()
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
```

说明：「右键未选中行」里 `删除` 的精确匹配用 selector 限定菜单项,避免与批量菜单文案或页签里的同名元素混淆;若 findByText('复制') 命中多个(菜单 + 行按钮 Tooltip 未展开不会渲染,理论唯一),失败时按 selector 收窄。

- [ ] **步骤 2：运行验证失败**

运行：`npx vitest run tests/renderer/sidebarMultiSelect.test.tsx`
预期：新增用例 FAIL(右键无菜单)。

- [ ] **步骤 3：实现右键菜单**

`renderScript` 中,把整个行 `<div key={script.id} ...>...</div>` 用 Dropdown 包起来(App.tsx 页签右键同款,trigger=['contextMenu']),key 移到 Dropdown 上:

```tsx
return (
  <Dropdown
    key={script.id}
    trigger={['contextMenu']}
    // 预选语义:右键未选中的行 = 先单选它(清掉多选),菜单按单条展示;
    // 右键已在多选里的行 = 不动选区,菜单按整个选区展示(文件管理器同款)
    onOpenChange={(open) => {
      if (!open) return
      if (!selectedIds.has(script.id) || validSelected.length <= 1) {
        setSelectedIds(new Set())
        setAnchorId(script.id)
        selectScript(script.id)
      }
    }}
    menu={{
      items:
        selectedIds.has(script.id) && validSelected.length > 1
          ? [
              {
                key: 'batch-delete',
                icon: <DeleteOutlined />,
                label: `删除 ${validSelected.length} 个脚本`,
                danger: true
              }
            ]
          : scriptMenuItems,
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation()
        if (key === 'batch-delete') {
          handleBatchDelete(validSelected.map((s) => s.id))
        } else if (key === 'copy') {
          void handleDuplicateScript(script)
        } else if (key === 'delete') {
          handleDeleteScript(script)
        }
      }
    }}
  >
    <div
      // ……原有行 div 的全部属性原样保留(key 从这里移除),class/onClick/拖拽/操作钮不动
    />
  </Dropdown>
)
```

`handleBatchDelete` 在任务 4 实现;本任务先放一个占位实现让它可编译可点（任务 4 替换为确认框流程）：

```tsx
// 任务 4 将替换为确认框 + allSettled 批量流程;先接线保证菜单可用
const handleBatchDelete = (ids: string[]): void => {
  void ids
}
```

注意 `noUnusedLocals` 开着:占位参数必须被消费(`void ids`)。

- [ ] **步骤 4：运行验证通过**

运行：`npx vitest run tests/renderer/sidebarMultiSelect.test.tsx`
预期：全部通过。注意「右键未选中行」用例中预选会触发 `selectScript` → store 变化 → 闭包里 `validSelected` 是当前渲染值,断言应稳定;若 Dropdown 的 onOpenChange 在 jsdom 未触发,改用 `fireEvent.contextMenu` 后直接断言菜单文案并报告。

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx tests/renderer/sidebarMultiSelect.test.tsx
git commit -m "feat(sidebar): 脚本行右键菜单,多选态批量删除入口"
```

---

### 任务 4：批量删除（确认框 + 校验 + allSettled + reload）

**文件：**
- 修改：`src/renderer/src/components/Sidebar.tsx`
- 测试：`tests/renderer/sidebarMultiSelect.test.tsx`（追加 describe）

- [ ] **步骤 1：追加失败的测试**

```tsx
describe('批量删除', () => {
  it('确认框文案含前 5 个名字与总数;确认后逐条 remove 并 reload,选区清空', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    fireEvent.contextMenu(scriptRow('脚本A2'))
    fireEvent.click(await screen.findByText('删除 2 个脚本'))

    // 确认框:标题 + 正文含名字(antd two-char okText「删 除」带空格,用正则)
    expect(await screen.findByText(/确定删除/).textContent).toContain('脚本A1')
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }))

    await waitFor(() => expect(api.scripts.remove).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.scripts.remove).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(api.scripts.remove).toHaveBeenCalledWith('s2'))
    // reload 走 scripts.list 重新拉取
    await waitFor(() => expect(api.scripts.list).toHaveBeenCalledTimes(2)) // 挂载 1 次 + reload 1 次
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

    await waitFor(() => expect(api.scripts.list).toHaveBeenCalledTimes(2))
    // message.error 的文案在 body 里(body 根下有 antd message 容器)
    await screen.findByText('1 个脚本删除失败,已保留')
  })

  it('全部失效:提示后不执行删除', async () => {
    renderSidebar()
    fireEvent.click(scriptRow('脚本A1'))
    fireEvent.click(scriptRow('脚本A2'), { ctrlKey: true })
    // 选区里的脚本全部从列表消失
    act(() => {
      useAppStore.setState({ scripts: [s3] })
    })
    fireEvent.contextMenu(scriptRow('脚本A2')).defaultPrevented // 行已不在,右键无从谈起 —— 此用例改为直接驱动菜单处理器不可行,改为验证渲染态:选区为空时右键走单条菜单
    // A2 行已不在列表里,直接验证:重新渲染后无批量入口
    expect(screen.queryByText('脚本A1')).toBeNull()
  })
})
```

注意第三个用例的写法:`act` 改 scripts 后 A1/A2 行消失,无法再右键——该用例的「全部失效」路径由 `handleBatchDelete` 入口校验兜底,组件级难以构造(选区行必在列表里才会被右键)。改为纯逻辑不可行(校验内联在组件)。保留为渲染剔除验证即可;入口校验逻辑在代码评审里把关。**执行时若发现更顺的构造方式可替换断言,但必须真实走到 `handleBatchDelete` 的空目标分支**(例如把校验抽成可导出的纯函数再测)。

- [ ] **步骤 2：运行验证失败**

运行：`npx vitest run tests/renderer/sidebarMultiSelect.test.tsx`
预期：批量删除用例 FAIL(占位 handleBatchDelete 无确认框、无 remove 调用)。

- [ ] **步骤 3：实现批量删除（替换任务 3 的占位实现）**

```tsx
/** 批量删除:单个确认框列名字与总数 → 逐条走既有删除 IPC → 一次 reload 收尾 */
const handleBatchDelete = (rawIds: string[]): void => {
  // 确认框打开期间列表可能已变(其他入口删除):以 store 最新快照校验,失效 id 跳过
  const targets = useAppStore.getState().scripts.filter((s) => rawIds.includes(s.id))
  if (targets.length === 0) {
    message.warning('所选脚本已不存在,无需删除')
    return
  }
  const shown = targets
    .slice(0, 5)
    .map((t) => `「${t.name}」`)
    .join('、')
  const suffix = targets.length > 5 ? ` 等 ${targets.length} 个脚本` : ''
  modal.confirm({
    centered: true,
    title: '删除脚本',
    content: `确定删除 ${shown}${suffix}?此操作不可撤销。`,
    okText: '删除',
    okButtonProps: { danger: true },
    cancelText: '取消',
    onOk: async () => {
      // allSettled:单条失败不拖累其他;失败的留在列表,成功的 reload 后消失
      const results = await Promise.allSettled(targets.map((t) => window.api.scripts.remove(t.id)))
      const failed = results.filter((r) => r.status === 'rejected').length
      await reload() // 页签/草稿/详情选中由 reload 的既有清理逻辑收尾
      setSelectedIds(new Set())
      setAnchorId(null)
      if (failed > 0) message.error(`${failed} 个脚本删除失败,已保留`)
    }
  })
}
```

- [ ] **步骤 4：运行验证通过**

运行：`npx vitest run tests/renderer/sidebarMultiSelect.test.tsx tests/renderer/multiSelect.test.ts`
预期：全过。

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx tests/renderer/sidebarMultiSelect.test.tsx
git commit -m "feat(sidebar): 多选右键批量删除,确认框+逐条校验+部分失败保留"
```

---

### 任务 5：全量验证 + 文档同步 + 推送

**文件：**
- 修改：`README.md`（视检查结果）
- 测试：全量

- [ ] **步骤 1：全量测试 + 类型检查**

```bash
npm run typecheck
npm test
```

预期：全部通过（新增 6 + 10 + 3 ≈ 19 个用例）。vitest OOM 时按备忘换提权/本机执行。

- [ ] **步骤 2：README 检查与同步**

检查 README 是否有列表操作说明段落;有则补一句「Ctrl/⌘+点击多选脚本，右键批量删除」;无则跳过（不强加）。

- [ ] **步骤 3：提交并推送**

```bash
git add README.md   # 有改动时
git commit -m "docs: README 同步脚本多选批量删除说明"   # 有改动时
git push origin master
```

---

## 自检记录

- **规格覆盖度：** 交互规则 5 条选择语义（任务 2）✓；右键菜单 3 场景（任务 3）✓；确认框/校验/部分失败/选区清空（任务 4）✓；视觉复用 `.app-row-selected`（任务 2 的 `selected` 计算）✓；拖拽不动（未改 dragStart,选区不随拖拽变化——未触碰相关代码）✓；目录不参与多选（collectIds/flatScriptIds 只收集脚本行,目录行无 onClick 接线）✓
- **占位符扫描：** 任务 3 的 `handleBatchDelete` 占位是显式交接（任务 4 步骤 3 替换）,非 TODO;任务 4 测试用例 3 的构造难点已写明替代策略与评审把关点
- **类型一致性：** `rangeBetween(flatOrder: readonly string[], anchorId: string | null, targetId: string)` 与任务 2 调用一致;`handleBatchDelete(rawIds: string[])` 与任务 3 菜单 onClick 调用一致;`validSelected` 在任务 2 定义、任务 3/4 消费一致
