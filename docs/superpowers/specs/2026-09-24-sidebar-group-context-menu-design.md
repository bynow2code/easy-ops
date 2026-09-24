# 分组行右键菜单设计

- 日期：2026-09-24
- 状态：**已实现并通过验证**（方案 A 最终形态；另含术语统一，见 §7.7）
- 相关文件：`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/components/GroupFormModal.tsx`、`src/main/store/scripts.ts`、`tests/renderer/sidebar.test.tsx`

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

> ⚠️ **本节结论已修订（2026-09-24 晚）**：原采纳方案 B，实测后**推翻，改为方案 A**。原因见 §3.3 与 §7.6。

### 3.1 候选方案

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| **A（最终采纳）** | 直接照抄脚本行：用 `<Dropdown trigger={['contextMenu']}>` 包住分组头 | 形态最同构，且**自动获得鼠标定位与整套右键行为** |
| B（原采纳，已废弃） | 受控 `<Dropdown trigger={[]} open onOpenChange>` + 分组头自挂 `onContextMenu` | 绕开触发器 ⇒ 同时丢掉 `alignPoint` ⇒ 菜单不跟随鼠标 |
| C | 抽取公共行右键组件，两行共用 | 抽象收益为负（见 §2 不做的事） |

### 3.2 采纳 A 的理由

用户要求「目录右键效果和脚本右键一样，在目录的哪里右键，就在旁边出现菜单」。

**这是一个「对齐鼠标坐标」的需求，而坐标能力由 antd 触发器内部提供**。绕过触发器去手写 `onContextMenu`，等于主动放弃这套能力；而 antd 并未把这套能力拆成可单独复用的 API。

### 3.3 方案 B 为何失效（关键根因）

原采纳 B 的两个理由**经实测均不成立**：

1. 「显式控制，避免右键误折叠」—— 实测发现 antd 的 `contextMenu` 触发器在右键时**根本不触发** `onClick`（`aria-expanded` 保持不变），所以这个「风险」本来就不存在，不需要显式控制。
2. 「不依赖触发器内部的事件顺序」—— 方向恰好相反：**绕过触发器正是丢失行为的根因**。

根因链条（逐行读源码确认）：

```
antd/es/dropdown/dropdown.js:109
  const alignPoint = trigger.includes('contextMenu')
        ↓ 传给
@rc-component/trigger/es/index.js:181
        ↓ 用在
index.js:230  useAlign(mergedOpen, popupEle, alignPoint && mousePos !== null ? mousePos : targetEle, ...)
```

**关键陷阱**：`mousePos` 只在 `index.js:415` 的 `if (showActions.has('contextMenu'))` 内被写入，而 `showActions` 由 `action`（即 `trigger`）经 `useAction` 派生（`index.js:243-245`）。

我们传 `trigger={[]}` ⇒ `showActions` 不含 `contextMenu` ⇒ **`mousePos` 恒为 `null`** ⇒
`alignPoint && mousePos !== null` 恒为 `false` ⇒ `useAlign` 收到的仍是 `targetEle`（整行元素，不是鼠标坐标）。

**因此单独补一个 `alignPoint` 属性也是无效的** —— 它只改变浮层的 placement class 名（实测会变成 `ant-dropdown-placement-rightTop`，一度被误认为已修复），实际对齐目标未变。这是一次**假证据**教训。

### 3.4 机制假设的实测验证（方案 A 形态）

用 jsdom 真实挂载探针（两个同级分组头，各包 `<Dropdown trigger={['contextMenu']}>`）实测：

| 假设 | 实测结果 |
| --- | --- |
| 右键不触发分组头的 `onClick`（不会误折叠） | ✅ 右键前后 `aria-expanded` 均为 `true` |
| 浮层 placement 与脚本行一致 | ✅ `ant-dropdown-placement-rightTop` |
| 多个分组头并存时只开被右键那一个 | ✅ 可见浮层数 = 1，菜单项仅含被点分组 |
| 左键仍正常折叠/展开 | ✅ 由既有用例 3 持续守卫 |

## 4. 改动清单

改动集中在 `src/renderer/src/components/Sidebar.tsx`。

### 4.1 ~~新增受控开合状态~~（已废弃）

原设计新增 `menuOpenId` state 来驱动受控 `open`。**方案 A 不需要它** —— antd 触发器内部管理开合，且天然按「每个 Dropdown 实例」隔离，不会出现「右键一个、整棵树全开」的问题（探针已证：可见浮层数 = 1）。

故 **`menuOpenId` state 已删除**。

### 4.2 分组头包一层 Dropdown（方案 A 最终形态）

`renderGroupNode` 中，把现有的 `.app-group-head` 节点用 `<Dropdown>` 包起来：

- `trigger={['contextMenu']}` —— 与脚本行完全同构
- `menu={{ items: groupMenuItems, onClick: <与 ⋯ 按钮同一份分发逻辑> }}`
- **不写** `open` / `onOpenChange`
- 分组头节点**不写** `onContextMenu`（交给触发器）


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
| 1 | 右键分组行弹出菜单 | 断言「新建子分组」可查（右键前不可查） |
| 2 | 右键**不**改变折叠状态 | 记录右键前后 `aria-expanded`，必须相等 |
| 3 | 左键仍正常折叠 | 左键后 `aria-expanded` 反转（保证右键入口没误伤原交互） |
| 4 | 两个分组时只开被右键那一个的菜单 | 断言 `.ant-dropdown-menu-item` 中只出现 1 份「新建子分组」 |

用例 2 是本次最关键的回归 —— 它锁住「右键 ≠ 折叠」。

### 定位约定（已核实现有测试的实际写法，非臆测）

- 分组头节点：`screen.getByText('wms').closest('.app-group-head')`。`sidebar.test.tsx` 已在 8 处使用这一写法。**不用** `getByLabelText('目录 wms')` —— 该 `aria-label` 虽然存在（`Sidebar.tsx:894`），但现有测试并不用它定位分组头，新用例跟随既有约定以免引入第二种定位风格。
- 折叠状态断言：读 `aria-expanded` 属性。
- **必须点/右键 `.app-group-head` 本体**：`sidebarMultiSelect.test.tsx:66` 的注释明确指出「折叠必须点它本体，内部的 Typography 文本节点不一定冒泡」。这条同样适用于 `contextMenu` 事件。

## 6. 验收标准

- [x] 分组行右键可弹菜单，且**菜单出现在鼠标位置**（与脚本行一致）
- [x] 右键不改变折叠状态；左键行为不变
- [x] 多分组时右键只打开一个菜单
- [x] `⋯` 按钮仍可正常使用
- [x] `tsc -p tsconfig.web.json` 与 `tsconfig.node.json` 均 0 错误
- [x] 新增 4 条用例全绿，且既有用例无回归
- [x] 回退验证：`trigger` 改回 `[]` → 4 条变红；恢复后全绿
- [x] 用户可见文案统一为「分组」（§7.7）

## 7. 落地与验证记录

### 7.1 实际改动（最终形态 = 方案 A）

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `src/renderer/src/components/Sidebar.tsx` | `renderGroupActions` 之前（约 846 行） | 新增 `handleGroupMenuClick(group, key)`，从原内联 `onClick` 提取 |
| 同上 | `renderGroupActions` | `onClick` 改为调用 `handleGroupMenuClick`；`⋯` 按钮保持 `trigger={['click']}` |
| 同上 | `renderGroupNode` 分组头（约 895-920 行） | 分组头外包 `Dropdown trigger={['contextMenu']}`，与脚本行同构；**不**加 `onContextMenu` / `open` / `onOpenChange` |
| `tests/renderer/sidebar.test.tsx` | `悬停菜单` 块内 | 新增 4 条右键用例（31 → 35） |
| `tests/renderer/sidebarMultiSelect.test.tsx` | 原「右键目录行:无右键菜单」 | 断言反向为新行为（该用例锁定的旧行为被本需求有意推翻） |

**已废弃**：`menuOpenId` state（方案 B 的产物，方案 A 不需要，已删除）。

### 7.2 验证结果

- typecheck：`tsconfig.web.json` **0 错误**、`tsconfig.node.json` **0 错误**
- 16 文件套件全绿（`sidebar.test.tsx` 35/35、`sidebarMultiSelect.test.tsx` 26/26、其余 14 文件均无回归）
- 未纳入 shim 清单的两个主进程测试文件（`scripts-store.test.ts` / `scripts-ipc.test.ts`）中受影响的防环文案断言，已用独立探针（真实 store + 真实正则）单独复现：两条均 ✓

### 7.3 回退验证（方案 B 形态的记录，保留作历史）

**回退 A：移除 `onContextMenu` 那一段。**
结果：**4 条变红** —— `sidebar.test.tsx` 的用例 1/2/4 + `sidebarMultiSelect.test.tsx` 的反向用例；用例 3（左键仍正常折叠）保持绿。

**回退 B：在 `onContextMenu` 里额外调用 `toggleGroup(key)`**。
结果：**仅用例 2 变红**（`aria-expanded` 被改变），其余全绿。证明用例 2 是「右键 ≠ 折叠」的专属守卫。

### 7.3.1 回退验证（方案 A 最终形态）

**把 `trigger={['contextMenu']}` 改回 `trigger={[]}`**（等价于撤销右键入口）。
结果：**4 条变红** —— `sidebarMultiSelect.test.tsx` 1 条 + `sidebar.test.tsx` 3 条（用例 1/2/4）；
**用例 3（左键仍正常折叠）保持绿** —— 这正是它存在的意义：它守的是左键，不是右键。
恢复后 md5 与备份一致（`a25a77cb…`），套件回到全绿。

### 7.4 实施期间发现的两处计划缺陷（均已修正）

1. **计划误判了测试夹具**：用例 4 原写 `setupGrouped()`，但 `悬停菜单` 块内的该函数只造**一个**目录（`wms`）。双目录的 setup 在另一个 `describe` 里。已改为在用例内就地构造两个**同级**目录。
2. **「新建子分组」文字有两个来源**：空分组引导块里也有一个同名按钮（`Sidebar.tsx` 约 1059 行）。原断言 `getAllByText('新建子分组')` 会把它一起数进来，**测不出「两菜单同开」**这一目标 bug。已改为只统计 `.ant-dropdown-menu-item` 中的同名项。

第 2 条是典型的「断言测错了东西」—— 若不核查就会留下一条永远为绿的假测试。

### 7.5 既定行为变更（需知悉）

`tests/renderer/sidebarMultiSelect.test.tsx` 原有一条 `右键目录行:无右键菜单`，它**锁定的是「目录行不支持右键」这一旧行为**。本需求有意推翻它，故该用例改为断言新行为（右键弹出 `['新建子分组', '重命名', '删除分组']`）。这是一次**规格反转**，不是回归。

### 7.6 方案 B → A 的推翻过程（教训）

用户第一次反馈「目录右键效果要做的和脚本右键一样，在目录的哪里右键，就在旁边出现菜单」后，我做了两次失败的修复尝试：

1. **尝试 1：只加 `alignPoint`。** 探针显示 placement class 变成了 `ant-dropdown-placement-rightTop`，我**据此认为已修复**。随后读源码发现这是**假证据** —— `alignPoint` 只改 class 名，`mousePos` 因 `trigger={[]}` 恒为 `null`，真实对齐目标没变。
2. **尝试 2：手写 `align` + `menuPos` state。** 开始与 antd 内部实现搏斗，引入了未声明的变量，复杂度失控。

**按 systematic-debugging 的停止条件（连续 2 次失败）停下**，把 `Sidebar.tsx` 从备份还原到与 HEAD 逐字节一致，改回方案 A。

**教训**：

- **placement class 名 ≠ 对齐行为**。断言 UI 行为时要断言**坐标或可观察效果**，不要断言一个恰好会变的 class 名。
- **不要与框架内部实现搏斗**。当发现自己在给第三方组件补内部的私有状态（`mousePos`）时，说明用错了 API 层 —— 该回到框架提供的公开入口。
- 我最初为方案 B 写的两条理由（「显式控制」「不依赖内部顺序」）都是**事后合理化**。真正该问的是：「框架已经把这件事做对了，我为什么要绕开它？」

### 7.7 术语统一（同日追加）

用户要求「分组和目录名称不统一，统一用分组来命名」。已把所有**用户可见文案**中的「目录」改为「分组」：

| 位置 | 改动 |
| --- | --- |
| `Sidebar.tsx` `groupMenuItems` | `新建子目录` → `新建子分组`；`删除目录` → `删除分组` |
| `Sidebar.tsx` 删除确认框 | 标题 + 正文的「目录/子目录」→「分组/子分组」 |
| `Sidebar.tsx` ＋ 按钮 | `在此目录新建脚本` → `在此分组新建脚本`（`title` + `aria-label`） |
| `Sidebar.tsx` 分组头 | `aria-label={\`目录 ${name}\`}` → `\`分组 ${name}\`` |
| `Sidebar.tsx` 空分组引导块 | 按钮 `新建子目录` → `新建子分组`；说明文案同步 |
| `Sidebar.tsx` 根空态提示 | 「新建分组建目录…通过目录上的 ＋」→「新建分组建分组…通过分组上的 ＋」 |
| `GroupFormModal.tsx` | 标题 `新建子目录` → `新建子分组` |
| `src/main/store/scripts.ts` | 错误文案「不能把目录移动到自己」→「不能把分组移动到自己」；「…自己的子目录」→「…自己的子分组」 |

**刻意不动**：`src/renderer/src/editor/shellKeywords.ts` —— 那里的「切换目录 / 列出目录内容 / 创建目录」指的是**真实文件系统目录**，与本概念的「分组」无关。

内部注释与代码标识符（`renderGroupNode`、`groups`、`groupId` 等）本就是「分组」口径，无需改动。
