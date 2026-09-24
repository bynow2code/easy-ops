# 设计规格：侧栏「新建分组」图标调整

- **日期**：2026-09-24
- **范围**：`src/renderer/src/components/Sidebar.tsx`
- **性质**：纯图标 / 视觉调整，无行为变更

---

## 1. 背景与动机

侧栏顶部工具栏在搜索框右侧有一个「新建分组」图标按钮，当前用的是 `FolderAddOutlined`
（文件夹 + 小加号）。用户反馈**这个图标不合适**，希望换成单纯的「+」。

排查发现「新建分组 / 新建子目录」这条动线上一共有三处入口，图标使用不统一：

| # | 位置 | 现状图标 | 形式 |
|---|---|---|---|
| 1 | 工具栏「新建分组」 | `FolderAddOutlined` | 纯图标按钮（带 Tooltip） |
| 2 | 目录行「＋」 | `PlusOutlined` | 纯图标按钮（带 Tooltip） |
| 3 | 目录行 ⋯ 菜单「新建子目录」 | `FolderAddOutlined` | 菜单项（有文字） |
| 4 | 空目录引导块「新建子目录」 | `FolderAddOutlined` | 带文字的按钮 |

`FolderAddOutlined` 的图形元素密集（文件夹轮廓 + 小加号），在 14px 下细节糊在一起，
视觉偏重；同一动线里既出现「文件夹+号」又出现「纯加号」，语义也不一致。

---

## 2. 决策（用户确认）

| 决策点 | 结论 |
|---|---|
| 工具栏「新建分组」图标 | 换成纯 `PlusOutlined` |
| 工具栏是否要描边圆形 `PlusCircleOutlined` | 否，要**纯 `+`**，与目录行的 `＋` 一致 |
| 目录行 ⋯ 菜单「新建子目录」 | **去掉图标**（不换成 `+`），走「方案 B」 |
| 菜单其余两项（重命名 / 删除目录）的图标 | **一并去掉** —— 只去一项会导致该项文字左移、与另两项错位；全去掉才对齐 |
| 空目录引导块「新建子目录」按钮 | **去掉图标**，只留文字 |

**语义定稿：`+` = 新建。** 具体新建什么由所在位置决定
（工具栏 = 顶层分组；目录行 = 该目录下的脚本），不再用不同的图形去区分。

---

## 3. 改动清单

### 3.1 工具栏「新建分组」

```tsx
<Tooltip title="新建分组">
  <Button
    size="small"
    type="text"
    icon={<PlusOutlined />}          // 原: <FolderAddOutlined />
    aria-label="新建分组"
    onClick={() => openForm({ type: 'group-create', parentId: null })}
  />
</Tooltip>
```

`Tooltip` 文案、`aria-label`、`onClick` 行为**均不变**。

### 3.2 目录行 ⋯ 菜单

`groupMenuItems` 去掉全部 `icon` 字段，只留 `key` / `label` / `danger`：

```tsx
const groupMenuItems: MenuProps['items'] = [
  { key: 'add-subgroup', label: '新建子目录' },
  { key: 'rename', label: '重命名' },
  { type: 'divider' },
  { key: 'delete', label: '删除目录', danger: true }
]
```

- `key` 保持原值：`onClick` 按 key 分发，不动分发逻辑。
- `danger: true` 保留 —— 红色是删除项唯一的警示手段，去掉图标后更需要它。
- `type: 'divider'` 保留。

### 3.3 空目录引导块

```tsx
<Button
  size="small"
  onClick={() => openForm({ type: 'group-create', parentId: node.group.id })}
>
  新建子目录
</Button>
```

去掉 `icon={<FolderAddOutlined />}`，其余不动。

### 3.4 连带清理 import

三处去掉后 `FolderAddOutlined` 在本文件**再无使用点**，必须从 `@ant-design/icons`
的 import 列表里删除，否则 `tsc` 报「已声明但从未读取」（`noUnusedLocals`）。

`PlusOutlined` 保留（工具栏 + 目录行两处仍在用）。

---

## 4. 不做的事（YAGNI）

- **不动**目录行「＋」按钮 —— 它本来就是 `PlusOutlined`，正是本次要对齐的目标形态。
- **不动**脚本行 ⋯ 菜单（`scriptMenuItems`）—— 不是本次动线，其图标保留。
- **不重构** `groupMenuItems` 为函数或加参数 —— 它仍是静态常量，无需变化。
- **不加**新的图标常量化 / 抽象层 —— 两处 `PlusOutlined` 直写即可，过早抽象。
- **不改**任何交互行为、快捷键、Tooltip 文案、`aria-label`。

---

## 5. 测试影响

现有断言（`tests/renderer/sidebar.test.tsx:491`）：

```tsx
expect(screen.getByLabelText('新建分组')).toBeTruthy()
```

用的是 **`aria-label` 而非图标内容**，因此换图标**不会**打破该断言。

菜单相关测试按**文字**定位（`'新建子目录'` / `'重命名'` / `'删除目录'`），
去掉 `icon` 不影响文字节点，同样不会破。

**结论：预期现有测试全绿，无需改断言。**

新增验证（本次补）：

- 工具栏「新建分组」按钮的 `aria-label` 仍存在且可点击生效（回归保护）。
- 断言菜单项**不渲染** `.anticon` 图标节点，锁住「去图标」这一决定 ——
  否则将来有人手滑加回来不会有任何反馈。

---

## 6. 验收标准

1. 工具栏搜索框右侧是一个纯 `+`，与目录行 `＋` 形态一致。
2. 目录行 ⋯ 菜单三项均为纯文字，三行文字左对齐。
3. 空目录引导块的「新建子目录」按钮只有文字。
4. `npm run typecheck` 通过，`FolderAddOutlined` 无残留引用。
5. 现有测试全绿；新增的去图标断言通过。
6. 点「+」仍能正常打开「新建分组」弹窗（顶层分组）。
