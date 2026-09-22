# EasyOps 脚本树形目录 + Postman 式交互 设计规格

日期：2026-09-22（v2,随实现对齐修订;初版 2026-09-21）
状态：已批准（用户确认路线 A）

## 背景与目标

参照 Postman 的页面交互改造 EasyOps 的脚本列表：

1. 目录支持**多级嵌套**（形态参照 Postman Collections：`wms > pda > 脚本`）。
2. 悬停交互：目录行出现 `＋`（在此目录新建脚本）和 `⋯` 菜单（新增子目录 / 重命名 / 删除）；脚本行出现 `执行`、`编辑` 和 `⋯` 菜单（复制 / 删除）。
3. 修复详情区页签与编辑区之间空隙过大的问题。

非目标（YAGNI）：多选操作、目录内搜索定位（按名称过滤已实现,定位跳转不在范围）。
拖拽排序/跨目录移动初版列为非目标,实现后经用户确认转正,见「树形交互」一节。

## 实现路线

采用**自研递归树 + 渐进改造**（方案 A），不换 antd Tree。理由：现有行样式（灰胶囊选中、悬停显隐按钮、计数 chip）刚打磨完成，antd Tree 的 template 机制难以承载这些自定义样式，换组件等于推倒重来。

## 数据模型

`Group` 增加字段（`src/shared/types.ts`）：

```ts
export interface Group {
  id: string
  name: string
  order: number
  parentId: string | null   // 新增:父目录 id,null = 顶层
  createdAt: string
}
```

- **向后兼容**：electron-store 读取旧数据时缺省 `parentId = null`，无需破坏性迁移（在 store 层做 normalize）。
- **IPC 变更**（`src/main/ipc/groups.ts` + `src/main/store/scripts.ts`）：
  - `group:create` 增加 `parentId` 参数（缺省 null）。
  - 新增 `group:move`（校验防环后更新 parentId）。
- **order 语义（定稿）**：`order` 是**兄弟内序号**（同一父目录下从 0 连续递增），不是全局序号。
  `listGroups()` 按父层重排后以树的前序（即显示顺序）返回;`deleteGroup` 把子目录拼接到被删目录
  原位后重排该层;`moveGroup` 对新旧两层各重排一次。脚本（Script）侧保持全局序号语义不变。
- **防环规则**：目录的 parentId 不能指向自己或自己的任意后代；创建时天然无环，仅 move 需要校验。校验失败返回明确错误文案。
  - **数据清洗（normalizeGroups sanitize）**：所有读取入口（读盘/导入）统一过一道清洗 ——
    `parentId` 非字符串/空串/悬空/自引用一律置 null,并用带 visited 的迭代上溯断开循环引用。
    环数据若落盘,防环 DFS 会挂死主进程、渲染层会把整棵子树静默渲染丢,这是硬性防线。
- **删除目录**：不级联删除。子目录与脚本**上移到被删目录的父级**（父级为顶层时落到顶层），弹确认框说明去向。
- **导入/导出**（`src/main/store/transfer.ts`）：导入旧格式（无 parentId）时同样 normalize 为 null；
  非法 parentId 不拒绝整份文件，由 normalizeGroups 清洗为顶层（宁可有损容错,不整体拒绝）。

## 树形交互（Sidebar 重构为递归渲染）

- **渲染**：`renderTree(nodes: TreeNode[])` 递归；`TreeNode = { type: 'group', group, children } | { type: 'script', script }`。缩进随深度递增（每层 `TREE_INDENT`，与现有 39px 常量一致）。
- **折叠**：沿用 `collapsedIds: Set<string>`，按目录 id 记忆；搜索时强制全部展开（现状保留）。仅渲染展开路径的子节点。选中脚本时沿**祖先链**逐级自动展开，保证选中行可见。
- **目录行**：`折叠箭头 + 文件夹图标 + 名称`，整行点击切换折叠。
  - ~~计数 chip~~：初版规格要求「直接子脚本数 + 子目录内脚本总数」chip，
    `13ca6ed` 对齐 Postman 视觉时**有意移除**（Postman 侧边栏无计数），规格随实现修订。
- **目录行悬停**：右侧显隐（沿用 `.app-group-actions` 的 CSS 显隐机制）：
  - `＋`：打开"新建脚本"弹窗，groupId = 当前目录 id
  - `⋯`：antd Dropdown 菜单 → 新增子目录 / 重命名 / 删除
- **脚本行悬停**：右侧显隐：`执行`、`编辑`、`⋯`（菜单 → 复制 / 删除）。现有 4 个平铺图标按钮收编为 2 按钮 + 1 菜单。
- **顶层入口**：顶部工具栏常驻「搜索 + 新建脚本（软底主操作）+ 新建分组（纯图标）」。
  初版规格的"保留新建按钮"演化为图标化（`aria-label` 可达,功能等价）。
- **搜索（Postman 式）**：按名称匹配（内容不参与）;脚本名命中显示其祖先目录链;
  目录名命中保留整棵子树;空分支剪枝。匹配用 trim 后的关键字,避免尾随空格造成假性 0 命中。
- **拖拽排序 / 跨目录移动（v2 纳入,初版列为非目标后经用户确认扩展）**：
  - 纯逻辑抽在 `utils/treeDnd.ts`（`computeDropAction` / `insertIntoSiblings`）,组件只做装配。
  - 目录行上/中/下三分 = 之前/移入/之后;脚本行上下对半 = 之前/之后;
    空目录引导块整块 = 移入;列表空白处 = 移到顶层（脚本置 groupId=null,目录 `group:move` 到 null）。
  - **防环双保险**：客户端预计算被拖目录的后代集合先行拦截（含空目录引导块路径——
    目录为空 ≠ 不是被拖目录的后代）,服务端 `moveGroup` 抛错兜底。
  - **搜索态整体禁用拖拽**：过滤后的树只含匹配子集,基于它算兄弟顺序会打乱未展示条目。
- **选中态**：沿用灰胶囊（`--app-row-selected-bg`）；执行/编辑后 `selectScript` 联动选中 + 开页签（现状保留）。
- **键盘可达**：菜单按钮天然可聚焦；行级操作保持现有 `focus-within` 显隐模式;
  分组头与详情页签可聚焦,Enter/Space 触发折叠/切换。

## 详情区间距修复

- `ScriptDetail`（App.tsx）flex gap 10 → 6。
- `ContentPanel`：无未保存改动时不再渲染空 header（省 22px + gap）；dirty 时才渲染「未保存」chip + 保存按钮行。
- 面板 padding 14 保持不变（视觉边框留白是刻意的）。

## 错误处理

- 防环校验失败：message.error 提示「不能移动到自己的子目录」。
- 删除有内容的目录：确认框明确写出「N 个脚本与 M 个子目录将上移到 xxx」。
- IPC 新旧参数兼容：preload 类型同步更新（`src/preload/index.d.ts`）。

## 测试

- **store 层**（`tests/main/`）：嵌套创建、normalize 旧数据、损坏数据清洗（环/悬空/自引用/非字符串 parentId）、
  删除目录子节点上移（中间层 + 顶层）、删除后子目录拼接原位、move 后两层 order 连续、move 防环、move 到顶层。
- **组件层**（`tests/renderer/`）：
  - 递归渲染：二层目录正确缩进与计数；
  - 目录菜单：点击「删除」触发确认框；「新增子目录」打开表单；
  - 脚本菜单：复制/删除经菜单触发；
  - 详情区：无 dirty 时不渲染 header；
  - 拖拽集成：同父重排 / 移入目录 / 拖到后代被拒（分组头 + 空目录引导块）/ 子目录拖到空白处移到顶层。
- 环境限制：vitest 在沙箱内无法运行（undici WASM），测试需在用户本机执行。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | Group.parentId |
| `src/main/store/scripts.ts` | create(parentId)、move、normalize、deleteGroup 上移 |
| `src/main/ipc/groups.ts` | group:create 参数、group:move |
| `src/preload/index.ts` + `index.d.ts` | api.groups 签名 |
| `src/main/store/transfer.ts` | 导入 normalize |
| `src/renderer/src/components/Sidebar.tsx` | 递归树 + hover 菜单 |
| `src/renderer/src/components/GroupFormModal.tsx` | 支持指定 parentId 创建 |
| `src/renderer/src/App.tsx` / `ContentPanel.tsx` | 间距修复 |
| `tests/main/*`、`tests/renderer/*` | 新增用例 |
