# 嵌套树形脚本列表 + Postman 式交互 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 脚本列表支持多级嵌套目录（Group.parentId），行悬停交互改为 Postman 式（目录行 `＋`/`⋯` 菜单，脚本行 `执行`/`编辑`/`⋯` 菜单），并修复详情区页签与编辑区的空隙。

**架构：** Group 增加 `parentId` 字段，store 层做读取时 normalize（旧数据兼容）；Sidebar 改为递归渲染的树；删除目录时子节点上移到父级（不级联删除）；move 时做防环校验。

**技术栈：** Electron + TypeScript + electron-store（主进程持久化）+ React + antd + zustand + vitest。

**规格：** `docs/superpowers/specs/2026-09-21-nested-tree-sidebar-design.md`

**环境注意：** vitest 在 agent 沙箱内无法运行（Node 22 undici WASM + ulimit -v 4GB 的环境限制，与本计划无关）；`npm run typecheck` 可用。执行者若在沙箱内无法跑测试，以 typecheck 把关并在 commit message 中注明，最终由用户本机跑 `npm test`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/shared/types.ts`（修改） | `Group.parentId` 字段 |
| `src/main/store/scripts.ts`（修改） | createGroup 带 parentId、moveGroup 防环、deleteGroup 上移子节点、读取 normalize |
| `src/main/ipc/groups.ts`（修改） | `group:create` 增参、新增 `group:move` 通道 |
| `src/preload/index.ts` / `index.d.ts`（修改） | `api.groups` 签名同步 |
| `src/main/store/transfer.ts`（修改） | 导入数据 normalize parentId |
| `src/renderer/src/store/useAppStore.ts`（修改） | `NameFormState` 支持 `group-create` 带 parentId |
| `src/renderer/src/components/Sidebar.tsx`（重写渲染部分） | 递归树渲染 + hover 菜单 |
| `src/renderer/src/components/GroupFormModal.tsx`（修改） | 创建时带 parentId |
| `src/renderer/src/App.tsx` / `components/ContentPanel.tsx`（修改） | 详情区间距修复 |
| `tests/main/scripts-store.test.ts`（增补） | 嵌套/防环/上移/normalize 用例 |
| `tests/renderer/sidebar.test.tsx`（增补） | 递归渲染与菜单用例 |

---

### 任务 1：store 层嵌套能力（数据模型 + 防环 + 上移）

**文件：**
- 修改：`src/shared/types.ts:12-17`
- 修改：`src/main/store/scripts.ts`
- 测试：`tests/main/scripts-store.test.ts`

- [ ] **步骤 1.1：编写失败的测试**

在 `tests/main/scripts-store.test.ts` 的「分组」describe 内追加：

```ts
describe('嵌套分组', () => {
  it('创建子分组挂在父分组下,order 在兄弟间递增', () => {
    const root = store.createGroup('wms')
    const child1 = store.createGroup('pda', root.id)
    const child2 = store.createGroup('pda2', root.id)
    expect(child1.parentId).toBe(root.id)
    expect(child2.parentId).toBe(root.id)
    expect(child1.order).toBe(0)
    expect(child2.order).toBe(1)
  })

  it('不传 parentId 时创建顶层分组,parentId 为 null', () => {
    expect(store.createGroup('顶层').parentId).toBeNull()
  })

  it('创建时父分组不存在则抛错', () => {
    expect(() => store.createGroup('孤儿', 'nope')).toThrowError(/父分组不存在/)
  })

  it('moveGroup 换父', () => {
    const a = store.createGroup('a')
    const b = store.createGroup('b')
    store.moveGroup(a.id, b.id)
    expect(store.listGroups().find((g) => g.id === a.id)!.parentId).toBe(b.id)
  })

  it('moveGroup 不能把目录移到自己或自己的后代(防环)', () => {
    const root = store.createGroup('root')
    const child = store.createGroup('child', root.id)
    const grand = store.createGroup('grand', child.id)
    expect(() => store.moveGroup(root.id, root.id)).toThrowError(/自己/)
    expect(() => store.moveGroup(root.id, grand.id)).toThrowError(/子目录/)
  })

  it('删除中间目录:子分组与脚本上移到父级,不级联删除', () => {
    const root = store.createGroup('root')
    const mid = store.createGroup('mid', root.id)
    const leaf = store.createGroup('leaf', mid.id)
    const s = store.createScript({ name: 'a', content: 'echo', groupId: mid.id })
    store.deleteGroup(mid.id)
    const groups = store.listGroups()
    expect(groups.find((g) => g.id === leaf.id)!.parentId).toBe(root.id)
    expect(store.listScripts().find((x) => x.id === s.id)!.groupId).toBe(root.id)
    expect(groups.some((g) => g.id === mid.id)).toBe(false)
  })

  it('读取旧数据(无 parentId)时 normalize 为 null', () => {
    data = {
      scripts: [],
      // 模拟旧版本落盘:groups 没有 parentId 字段
      groups: [{ id: 'g1', name: '旧', order: 0, createdAt: '2026-01-01T00:00:00.000Z' }] as Group[]
    }
    expect(store.listGroups()[0].parentId).toBeNull()
  })
})
```

- [ ] **步骤 1.2：运行测试验证失败**

运行：`npx vitest run tests/main/scripts-store.test.ts`
预期：FAIL —— `createGroup` 不接受第二参数、`moveGroup` 不存在、`parentId` 断言失败。

- [ ] **步骤 1.3：实现 store 层**

`src/shared/types.ts` 的 `Group` 增加：

```ts
export interface Group {
  id: string
  name: string
  order: number
  /** 父目录 id;null = 顶层。旧数据读取时 normalize 为 null */
  parentId: string | null
  createdAt: string
}
```

`src/main/store/scripts.ts`：

(a) 接口与 normalize：

```ts
export interface ScriptsStore {
  // …原有成员不变…
  createGroup: (name: string, parentId?: string | null) => Group
  moveGroup: (id: string, parentId: string | null) => void
  // …
}

/** 旧版本落盘的 groups 没有 parentId,读取时统一补成 null */
function normalizeGroups(groups: Group[]): Group[] {
  return groups.map((g) => ({ ...g, parentId: g.parentId ?? null }))
}
```

`state()` 里 groups 分支改为 `groups: normalizeGroups(Array.isArray(raw?.groups) ? raw.groups : [])`。

(b) `createGroup` 换成：

```ts
createGroup(name, parentId = null) {
  const nameCheck = validateGroupName(name)
  if (!nameCheck.ok) throw new Error(nameCheck.message)
  const data = state()
  const parent = parentId ?? null
  if (parent && !data.groups.some((g) => g.id === parent)) {
    throw new Error(`父分组不存在: ${parent}`)
  }
  // order 只在兄弟之间递增,嵌套后全局混排会让子目录 order 虚高
  const siblings = data.groups.filter((g) => (g.parentId ?? null) === parent)
  const group: Group = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    parentId: parent,
    order: nextOrder(siblings),
    createdAt: nowIso()
  }
  commit({ ...data, groups: [...data.groups, group] })
  return group
}
```

(c) 新增 `moveGroup`（放在 `updateGroup` 之后）：

```ts
moveGroup(id, parentId) {
  const target = parentId ?? null
  if (id === target) throw new Error('不能把目录移动到自己')
  const data = state()
  if (!data.groups.some((g) => g.id === id)) throw new Error(`分组不存在: ${id}`)
  if (target && !data.groups.some((g) => g.id === target)) {
    throw new Error(`父分组不存在: ${target}`)
  }
  // 防环:目标父目录不能是自己旗下任意后代。先建「父 → 子」索引,再从 id 往下走
  const childrenOf = new Map<string | null, string[]>()
  for (const g of data.groups) {
    const key = g.parentId ?? null
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), g.id])
  }
  const stack = [...(childrenOf.get(id) ?? [])]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === target) throw new Error('不能把目录移动到自己的子目录')
    stack.push(...(childrenOf.get(cur) ?? []))
  }
  commit({ ...data, groups: data.groups.map((g) => (g.id === id ? { ...g, parentId: target } : g)) })
},
```

(d) `deleteGroup` 改为「上移子节点」：

```ts
deleteGroup(id) {
  const data = state()
  const target = data.groups.find((g) => g.id === id)
  if (!target) throw new Error(`分组不存在: ${id}`)
  // 不级联删除:子目录与脚本都上移到被删目录的父级,数据零丢失
  const parent = target.parentId ?? null
  commit({
    groups: data.groups
      .map((g) => (g.parentId === id ? { ...g, parentId: parent } : g))
      .filter((g) => g.id !== id),
    scripts: data.scripts.map((s) => (s.groupId === id ? { ...s, groupId: parent } : s))
  })
},
```

(e) `replaceAll` 的 groups 分支套一层 `normalizeGroups(...)`（导入旧配置时兜底）。

- [ ] **步骤 1.4：运行测试验证通过**

运行：`npx vitest run tests/main/scripts-store.test.ts`
预期：PASS（沙箱内无法运行时改为 `npm run typecheck:node` + 注明）。

- [ ] **步骤 1.5：Commit**

```bash
git add src/shared/types.ts src/main/store/scripts.ts tests/main/scripts-store.test.ts
git commit -m "feat: 分组支持嵌套(parentId),删除目录子节点上移,move 防环"
```

---

### 任务 2：IPC 通道 + preload 签名同步

**文件：**
- 修改：`src/main/ipc/groups.ts`
- 修改：`src/preload/index.ts:23-29`
- 修改：`src/preload/index.d.ts`（若有对应声明则同步；`Api = typeof api` 时自动推导，无需手改）
- 测试：`tests/main/scripts-ipc.test.ts`（增补）

- [ ] **步骤 2.1：编写失败的测试**

参照 `tests/main/scripts-ipc.test.ts` 现有 mock 模式（`ipcMain.handle` 收集进 handlers Map），追加：

```ts
it('group:create 透传 parentId,group:move 校验后落盘', async () => {
  const handle = (channel: string) => electronMock.__handlers.get(channel)
  const parent = await handle('group:create')(_e, { name: '父' })
  const child = await handle('group:create')(_e, { name: '子', parentId: parent.id })
  expect(child.parentId).toBe(parent.id)

  const g = await handle('group:create')(_e, { name: '移动我' })
  await handle('group:move')(_e, { id: g.id, parentId: parent.id })
  const listed = await handle('group:list')()
  expect(listed.find((x: Group) => x.id === g.id)!.parentId).toBe(parent.id)

  await expect(handle('group:move')(_e, { id: parent.id, parentId: g.id })).rejects.toThrow(/子目录/)
})
```

（`_e` 与 handlers 取法以该文件现有用例的实际写法为准，保持一致。）

- [ ] **步骤 2.2：运行测试验证失败**

运行：`npx vitest run tests/main/scripts-ipc.test.ts`
预期：FAIL —— `group:move` 未注册。

- [ ] **步骤 2.3：实现 IPC 与 preload**

`src/main/ipc/groups.ts`：

```ts
export function registerGroupIpc(store: ScriptsStore): void {
  ipcMain.handle('group:list', () => store.listGroups())
  ipcMain.handle('group:create', (_event, payload: { name: string; parentId?: string | null }) =>
    store.createGroup(payload.name, payload.parentId ?? null)
  )
  ipcMain.handle('group:update', (_event, payload: { id: string; name: string }) =>
    store.updateGroup(payload.id, payload.name)
  )
  ipcMain.handle('group:delete', (_event, payload: { id: string }) => {
    store.deleteGroup(payload.id)
  })
  ipcMain.handle('group:move', (_event, payload: { id: string; parentId: string | null }) =>
    store.moveGroup(payload.id, payload.parentId ?? null)
  )
  ipcMain.handle('group:reorder', (_event, payload: { ids: string[] }) => {
    store.reorderGroups(payload.ids)
  })
}
```

`src/preload/index.ts` 的 `groups`：

```ts
groups: {
  list: (): Promise<Group[]> => ipcRenderer.invoke('group:list'),
  create: (name: string, parentId?: string | null): Promise<Group> =>
    ipcRenderer.invoke('group:create', { name, parentId: parentId ?? null }),
  update: (id: string, name: string): Promise<Group> => ipcRenderer.invoke('group:update', { id, name }),
  remove: (id: string): Promise<void> => ipcRenderer.invoke('group:delete', { id }),
  move: (id: string, parentId: string | null): Promise<void> =>
    ipcRenderer.invoke('group:move', { id, parentId: parentId ?? null }),
  reorder: (ids: string[]): Promise<void> => ipcRenderer.invoke('group:reorder', { ids })
},
```

- [ ] **步骤 2.4：运行测试验证通过**

运行：`npx vitest run tests/main/scripts-ipc.test.ts`（沙箱内改跑 `npm run typecheck`）

- [ ] **步骤 2.5：Commit**

```bash
git add src/main/ipc/groups.ts src/preload/index.ts tests/main/scripts-ipc.test.ts
git commit -m "feat: group:create 带 parentId,新增 group:move IPC"
```

---

### 任务 3：Sidebar 递归树渲染

**文件：**
- 修改：`src/renderer/src/components/Sidebar.tsx`
- 测试：`tests/renderer/sidebar.test.tsx`

- [ ] **步骤 3.1：编写失败的测试**

`tests/renderer/sidebar.test.tsx` 增补（api mock 的 `groups.list` 需返回带 parentId 的嵌套数据）：

```tsx
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
  })
})
```

- [ ] **步骤 3.2：运行测试验证失败**

运行：`npx vitest run tests/renderer/sidebar.test.tsx`
预期：FAIL —— 当前实现把 `pda` 渲染成顶层分组（不嵌套）。

- [ ] **步骤 3.3：实现递归树**

`Sidebar.tsx` 渲染数据层替换（保留 `matches`、`grouped` 思路，改为整树构建）：

```tsx
interface GroupNode {
  group: Group
  /** 直接子目录(按 order 排) */
  children: GroupNode[]
  /** 直接挂的脚本(按 order 排) */
  scripts: Script[]
  /** 该目录下所有脚本总数(含子目录),用于计数 chip */
  total: number
}

const tree = useMemo((): GroupNode[] => {
  const nodes = new Map<string, GroupNode>()
  for (const g of [...groups].sort((a, b) => a.order - b.order)) {
    nodes.set(g.id, { group: g, children: [], scripts: [], total: 0 })
  }
  const roots: GroupNode[] = []
  for (const node of nodes.values()) {
    const parentKey = node.group.parentId
    const parent = parentKey ? nodes.get(parentKey) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  for (const s of visible) {
    const key = s.groupId && nodes.has(s.groupId) ? s.groupId : null
    if (key) nodes.get(key)!.scripts.push(s)
  }
  // 后序遍历:total = 直接脚本数 + 子目录 total 之和
  const fill = (node: GroupNode): number => {
    node.total = node.scripts.length + node.children.reduce((sum, c) => sum + fill(c), 0)
    return node.total
  }
  for (const root of roots) fill(root)
  return roots
}, [groups, visible])
```

渲染递归（替换现有 `groups.map(...) + renderGroupRow('__ungrouped__', ...)`）：

```tsx
const renderGroupNode = (node: GroupNode, depth: number): JSX.Element => {
  const key = node.group.id
  const expanded = isExpanded(key)
  const indent = depth * TREE_INDENT
  return (
    <div key={key} style={{ marginBottom: 6 }}>
      {/* 分组头:箭头 + 文件夹 + 名称 + 总数 chip,整行点击折叠;操作区在任务 4 里替换为菜单 */}
      <div
        className="app-group-head"
        onClick={() => toggleGroup(key)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', paddingLeft: 4 + indent,
                 borderRadius: 'var(--app-radius)', cursor: 'pointer', userSelect: 'none' }}
      >
        <Space size={6} align="center" style={{ minWidth: 0 }}>
          <CaretRightOutlined rotate={expanded ? 90 : 0} style={{ fontSize: 10, opacity: 0.45, transition: 'transform 0.12s ease' }} />
          <FolderOutlined style={{ fontSize: 13, opacity: 0.65 }} />
          <Typography.Text ellipsis style={{ fontSize: 13, opacity: 0.85, minWidth: 0 }}>{node.group.name}</Typography.Text>
          <span style={countChipStyle}>{node.total}</span>
        </Space>
        {/* actions 悬停区,任务 4 填充 */}
      </div>
      {expanded ? (
        <div>
          {node.children.map((c) => renderGroupNode(c, depth + 1))}
          {node.scripts.map((s) => renderScript(s, depth + 1))}
          {node.children.length === 0 && node.scripts.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: TREE_INDENT + depth * TREE_INDENT }}>
              暂无脚本
            </Typography.Text>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const renderScript = (s: Script, depth: number): JSX.Element => {
  // 现有 renderScript 主体保留(选中/hover/操作按钮),仅把 marginLeft 改为按深度缩进:
  // marginLeft: depth * TREE_INDENT + (TREE_INDENT - 8)
}
```

顶层渲染：

```tsx
{tree.map((node) => renderGroupNode(node, 0))}
{/* 未分组脚本(无 groupId 或 groupId 指向已删分组)仍是一个可折叠的顶层节点 */}
{renderScript(未分组脚本..., 0)}
```

「未分组」沿用现有 `__ungrouped__` 处理：从 `grouped.get(null)` 取，作为 depth 0 的伪分组渲染（实现时可直接保留旧 `renderGroupRow` 只服务未分组，或并入 tree 结构——并入优先）。

折叠记忆、搜索强制展开、自动展开新脚本所在目录的三个 `useMemo/useEffect` 全部保留，逻辑不变。

- [ ] **步骤 3.4：运行测试验证通过**

运行：`npx vitest run tests/renderer/sidebar.test.tsx`（沙箱内改跑 `npm run typecheck:web`）

- [ ] **步骤 3.5：Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx tests/renderer/sidebar.test.tsx
git commit -m "feat: 侧栏改为递归树渲染,支持多级目录"
```

---

### 任务 4：Postman 式悬停菜单

**文件：**
- 修改：`src/renderer/src/store/useAppStore.ts`（NameFormState）
- 修改：`src/renderer/src/components/Sidebar.tsx`
- 修改：`src/renderer/src/components/GroupFormModal.tsx`
- 测试：`tests/renderer/sidebar.test.tsx`

- [ ] **步骤 4.1：编写失败的测试**

```tsx
describe('悬停菜单', () => {
  it('脚本行菜单里有复制与删除,点复制走 duplicate', async () => {
    setupApi() // 现有 mock
    render(<ThemeProvider mode="light" onModeChange={() => undefined}><Sidebar /></ThemeProvider>)
    await screen.findByText('构建')

    // 菜单触发点是 ⋯ 按钮(aria-label),复制/删除不再平铺在行上
    expect(screen.queryByLabelText('copy')).toBeNull()
    fireEvent.click(screen.getByLabelText('更多操作'))
    fireEvent.click(await screen.findByText('复制'))

    await waitFor(() => expect(useAppStore.getState().api ?? null).toBeNull()) // 按实际 mock 断言
    await waitFor(() => expect(vi.mocked((window as any).api.scripts.duplicate)).toHaveBeenCalledWith('s1'))
  })

  it('目录行菜单:新增子目录打开带 parentId 的表单', async () => {
    // groups.list 返回一个顶层分组
    // 点击其 ⋯(aria-label="分组操作")→ 菜单「新建子目录」
    // 断言 useAppStore.getState().form === { type: 'group-create', parentId: 'g1' }
  })

  it('目录行悬停 + 号直接打开新建脚本表单且 groupId 指向该目录', async () => {
    // 断言 form === { type: 'script-create', groupId: 'g1' }
  })
})
```

（后两条测试的完整断言在编写时按第一条的既有 mock 模式展开，断言核心是 `useAppStore.getState().form` 的值。）

- [ ] **步骤 4.2：运行测试验证失败**

运行：`npx vitest run tests/renderer/sidebar.test.tsx` —— FAIL：菜单不存在。

- [ ] **步骤 4.3：实现**

(a) `useAppStore.ts` 的表单状态：

```ts
export type NameFormState =
  | { type: 'none' }
  | { type: 'group-create'; parentId: string | null }
  | { type: 'group-edit'; group: Group }
  | { type: 'script-create'; groupId: string | null }
  | { type: 'script-edit'; script: Script }
```

（现有两处 `openForm({ type: 'group-create' })` 顶层入口改为 `{ type: 'group-create', parentId: null }`。）

(b) `GroupFormModal.tsx`：`isCreate` 时 `setName('')` 不变；`handleOk` 创建分支改为：

```ts
if (isCreate && form.type === 'group-create') {
  await window.api.groups.create(name, form.parentId ?? null)
}
```

弹窗标题随层级变化：`title={isCreate ? (form.type === 'group-create' && form.parentId ? '新建子目录' : '新建分组') : '编辑分组'}`。

(c) `Sidebar.tsx`：

- 脚本行操作区改为：`执行`（PlayCircleOutlined）、`编辑`（EditOutlined）、`更多`（MoreOutlined，`aria-label="更多操作"`）——antd `Dropdown` 包裹，`menu={{ items: [{ key: 'copy', icon: <CopyOutlined />, label: '复制' }, { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true }], onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); key === 'copy' ? void handleDuplicateScript(script) : handleDeleteScript(script) } }}`。`Dropdown` 需 `trigger={['click']}`。
- 目录行操作区：`＋`（PlusOutlined，`aria-label="在此目录新建脚本"`，onClick stopPropagation + `openForm({ type: 'script-create', groupId: key })`）+ `⋯`（MoreOutlined，`aria-label="分组操作"`），菜单项：

```tsx
const groupMenuItems = [
  { key: 'add-subgroup', icon: <FolderAddOutlined />, label: '新建子目录' },
  { key: 'rename', icon: <EditOutlined />, label: '重命名' },
  { type: 'divider' as const },
  { key: 'delete', icon: <DeleteOutlined />, label: '删除目录', danger: true }
]
// onClick:
//   add-subgroup → openForm({ type: 'group-create', parentId: key }) 并自动展开该目录
//   rename       → openForm({ type: 'group-edit', group })
//   delete       → 确认框文案:「删除目录『x』?其下 N 个脚本与 M 个子目录将上移到 <父目录名|顶层>。」
```

- 删除确认框需要统计：直接用任务 3 构建的 `GroupNode.total`（脚本数）与递归子目录数，在 `handleDeleteGroup` 内从 tree 里找对应 node 计算。
- 删除后 `reload()`；被删目录若在页签里，`reload` 的 openTabs 过滤已兜底（脚本上移不掉）。

- [ ] **步骤 4.4：运行测试验证通过**

运行：`npx vitest run tests/renderer/sidebar.test.tsx`（沙箱内改跑 `npm run typecheck:web`）

- [ ] **步骤 4.5：Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/GroupFormModal.tsx src/renderer/src/store/useAppStore.ts tests/renderer/sidebar.test.tsx
git commit -m "feat: Postman 式悬停菜单(目录 +/⋯、脚本 执行/编辑/⋯)"
```

---

### 任务 5：详情区间距修复

**文件：**
- 修改：`src/renderer/src/App.tsx:139`（ScriptDetail 根节点 gap）
- 修改：`src/renderer/src/components/ContentPanel.tsx:88-116`
- 测试：`tests/renderer/contentPanel.test.tsx`（增补）

- [ ] **步骤 5.1：编写失败的测试**

```tsx
it('无未保存改动时不渲染空 header 行(页签与编辑区间距来源之一)', () => {
  setupApi()
  renderPanel()
  expect(screen.getByTestId('editor')).toBeTruthy()
  // header 仅在 dirty 时渲染:干净状态不应存在「未保存」chip,保存按钮也不存在
  expect(screen.queryByText('未保存')).toBeNull()
  expect(screen.queryByText('保存')).toBeNull()
})
```

（现有用例已断言后两者,新增断言可并入现有「无改动时没有保存按钮」用例，避免重复用例名。）

- [ ] **步骤 5.2：运行验证失败 → 实现**

`App.tsx` ScriptDetail 根节点：`gap: 10` → `gap: 6`。

`ContentPanel.tsx`：把「永远渲染的 header」改为条件渲染（去掉 `minHeight: 22` 的占位）：

```tsx
{dirty ? (
  <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flex: '0 0 auto' }}>
    <span style={{ /* 现有未保存 chip 样式不变 */ }}>未保存</span>
    <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => void save()}>保存</Button>
  </header>
) : null}
```

副作用说明：dirty 状态切换会让编辑器高度跳动约 28px，可接受（保存动作是低频瞬间事件；若跳动刺眼，后续可给 header 加 28px 固定占位但视觉上仍要求贴紧）。

- [ ] **步骤 5.3：运行测试验证通过 → Commit**

```bash
npm run typecheck
git add src/renderer/src/App.tsx src/renderer/src/components/ContentPanel.tsx tests/renderer/contentPanel.test.tsx
git commit -m "fix: 详情区页签与编辑区间距收窄(gap 10→6,干净状态不渲染空 header)"
```

---

## 自检记录

- 规格覆盖度：嵌套模型(T1)、IPC/preload(T2)、递归树(T3)、hover 菜单(T4)、间距(T5)、导入 normalize(T1e/T2)、防环(T1)、删除上移(T1)、计数聚合(T3) —— 全部有对应任务。
- 占位符扫描：任务 4.1 的测试第 2、3 条为「按第一条模式展开」的半展开写法,执行者在 TDD 步骤内必须先写成完整可运行代码再继续；其余步骤均有实际代码。
- 类型一致性：`Group.parentId`(T1) → IPC payload(T2) → preload 签名(T2) → Sidebar/GroupFormModal(T3/T4) 命名一致;`NameFormState.group-create.parentId` 与 T4 使用一致。
