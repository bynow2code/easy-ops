# 目录行右键菜单设计

- 日期：2026-09-24
- 状态：用户已批准设计，待实现
- 相关文件：`src/renderer/src/components/Sidebar.tsx`、`tests/renderer/sidebar.test.tsx`

## 1. 背景与动机

脚本行已支持在整行上右键弹出菜单（`Dropdown trigger={['contextMenu']}`，见 `renderScript`）。目录行**没有**这个能力 —— 全文件 `contextMenu` 只出现 1 次。目录行的菜单目前只能通过行尾悬停出现的 `⋯` 按钮触发。

用户在文件管理器、Postman 等工具里习惯了「右键目录出菜单」，因此要求目录行也支持右键，且**与脚本行保持行为一致**。

## 2. 需求边界

### 做

- 目录行（分组头 `.app-group-head`）右键可弹出菜单。
- 右键**不**改变该目录的展开/收起状态。
- 右键**不**影响原有左键行为（左键仍折叠/展开）。
- 多个目录并存时，右键只打开被点中那一个的菜单。

### 不做（YAGNI）

- **不移除 `⋯` 按钮**：用户已确认保留。右键是新入口，`⋯` 是既有的可发现入口，两者共存。这也是脚本行的现状形态。
- **不改菜单项内容**：目录菜单保持现有的「新建子目录 / 重命名 / 删除目录（danger）」四项。不做「复制目录」等新功能 —— 目录与脚本是不同概念，强行对齐菜单项会造出语义不清的操作。
- **不做目录多选 / 批量删除**：这是独立特性，且需要先定义目录多选的语义（目录多选与脚本多选的选区是否共用？选中的子项是否参与？），超出本次范围。
- **不抽取共用的「行右键」组件**：脚本行的右键带预选语义（右键未选中行会先单选它），目录行没有这个概念；两行的菜单项、危险项、onOpenChange 逻辑都不同。抽象出来的参数会比调用点还多。

## 3. 方案选型

### 候选方案

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| A | 直接照抄脚本行：用 `<Dropdown trigger={['contextMenu']}>` 包住分组头 | 形态最同构，但对「右键不触发展开」缺乏显式控制点 |
| **B（采纳）** | 受控 `<Dropdown trigger={[]} open onOpenChange>` + 分组头自挂 `onContextMenu` | 显式接管右键，明确区分左右键语义 |
| C | 抽取公共行右键组件，两行共用 | 抽象收益为负（见 §2 不做的事） |

### 采纳 B 的理由

用户要求「行为一致」，但目录行的分组头与脚本行结构不同：分组头自身带 `onClick={toggleGroup}`、`role="button"`、`draggable`、`onKeyDown`。受控 `open` + 自挂 `onContextMenu` 让我们**显式**决定右键做什么（只开菜单）、左键做什么（照旧折叠），而不是依赖 antd 触发器内部的事件顺序。

### 机制假设的实测验证

设计阶段的三个假设已用探针脚本（jsdom 真实挂载）实测确认，非推测：

| 假设 | 实测结果 |
| --- | --- |
| 右键不触发分组头的 `onClick`（不会误折叠） | ✅ `toggleCalls` 保持 0 |
| 右键能打开菜单 | ✅ `menuOpen` → `true` |
| 左键仍正常折叠/展开 | ✅ `toggleCalls` → 1 |
| `trigger={[]}` 不额外包裹 DOM 层 | ✅ 与方案 A 形态的静态 HTML 逐字相同（均为 `<div role="button" class="ant-dropdown-trigger">`），`role="button"` 位置不变，既有测试的 `.closest()` 定位不受影响 |

## 4. 改动清单

改动集中在 `src/renderer/src/components/Sidebar.tsx`。

### 4.1 新增受控开合状态

在 `Sidebar` 组件内新增：

```tsx
/** 右键打开的目录菜单所属的目录 id;null = 无菜单打开 */
const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
```

**为什么用 id 而不是 boolean**：树是递归渲染的（`renderGroupNode` 每层都渲染一个分组头）。若用一个共享的 `boolean`，右键任一目录会让**所有**目录的菜单同时打开。

### 4.2 分组头包一层受控 Dropdown

`renderGroupNode` 中，把现有的 `.app-group-head` 节点用 `<Dropdown>` 包起来：

- `trigger={[]}` —— 不用 antd 自带触发器，完全由受控 `open` 驱动
- `open={menuOpenId === key}`
- `onOpenChange={(next) => setMenuOpenId(next ? key : null)}`
- `menu={{ items: groupMenuItems, onClick: <与 ⋯ 按钮同一份分发逻辑> }}`

分组头节点自身新增：

```tsx
onContextMenu={(e) => {
  e.preventDefault()
  setMenuOpenId(key)
}}
```

`e.preventDefault()` 用于抑制浏览器/Electron 的系统右键菜单。

### 4.3 菜单分发逻辑去重

`⋯` 按钮（`renderGroupActions`）与新增的右键菜单需要**同一份** `onClick` 分发。做法：把现有的分发逻辑提成一个局部函数（如 `handleGroupMenuClick(group, key)`），两处 `menu.onClick` 都调用它。

**这是本次唯一的结构性调整**，目的是避免「两份分发逻辑日后漂移」—— 这正是上一轮脚本菜单图标改动里踩过的同类问题（同一槽位两套定义）。

### 4.4 不动的部分

- `renderGroupActions` 的 `⋯` 按钮保持非受控 `trigger={['click']}`
- `groupMenuItems` 定义不变（仍为纯文字、删除项保留 `danger: true`）
- 分组头的 `onClick` / `onKeyDown` / `draggable` / `onDragOver` 等全部保持不变

## 5. 测试影响

新增 4 条回归用例到 `tests/renderer/sidebar.test.tsx`。每条都自带对照组，避免「断言恰好通过」的假绿。

| # | 用例 | 对照组 / 断言要点 |
| --- | --- | --- |
| 1 | 右键目录行弹出菜单 | 断言「新建子目录」可查（右键前不可查） |
| 2 | 右键**不**改变折叠状态 | 记录右键前后 `aria-expanded`，必须相等 |
| 3 | 左键仍正常折叠 | 左键后 `aria-expanded` 反转（保证 `onContextMenu` 没误伤原交互） |
| 4 | 两个目录时只开被右键那一个的菜单 | 断言只出现 1 份「新建子目录」菜单项 |

用例 2 是本次最关键的回归 —— 它锁住「右键 ≠ 折叠」，而这正是方案 B 相对方案 A 存在的全部理由。

### 定位约定（已核实现有测试的实际写法，非臆测）

- 分组头节点：`screen.getByText('wms').closest('.app-group-head')`。`sidebar.test.tsx` 已在 8 处使用这一写法。**不用** `getByLabelText('目录 wms')` —— 该 `aria-label` 虽然存在（`Sidebar.tsx:894`），但现有测试并不用它定位分组头，新用例跟随既有约定以免引入第二种定位风格。
- 折叠状态断言：读 `aria-expanded` 属性。
- **必须点/右键 `.app-group-head` 本体**：`sidebarMultiSelect.test.tsx:66` 的注释明确指出「折叠必须点它本体，内部的 Typography 文本节点不一定冒泡」。这条同样适用于 `contextMenu` 事件。

## 6. 验收标准

- [ ] 目录行右键可弹菜单，菜单项与 `⋯` 按钮完全一致
- [ ] 右键不改变折叠状态；左键行为不变
- [ ] 多目录时右键只打开一个菜单
- [ ] `⋯` 按钮仍可正常使用
- [ ] `tsc -p tsconfig.web.json` 与 `tsconfig.node.json` 均 0 错误
- [ ] 新增 4 条用例全绿，且既有用例无回归
- [ ] 回退验证：临时移除 `onContextMenu` → 用例 1/2/4 变红；恢复后全绿

## 7. 落地与验证记录

**状态：设计已批准，实现待开始。**

（实现完成后在此补充：实际改动的文件与行号、typecheck 结果、测试结果、回退验证记录）
