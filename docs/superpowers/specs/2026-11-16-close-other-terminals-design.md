# 终端卡片「关闭其他终端」设计

- **日期**：2026-11-16
- **状态**：设计已获用户批准，待编写实现计划
- **相关**：`src/renderer/src/components/TerminalDock.tsx`、`src/renderer/src/store/useTerminalStore.ts`、`tests/renderer/terminalDock.test.tsx`、`tests/renderer/terminalStore.test.ts`

---

## 1. 需求与决策

> 单个关闭终端增加功能：关闭其他终端。

现状：终端卡片头部只有「最大化」和「×（关闭此终端）」；工具条右上角有「关闭全部」。想让某个终端独占（例如排查一个脚本的输出）时，只能一个个点 ×。

用户澄清（选择题确认）：

| 决策点 | 用户选择 |
|---|---|
| 入口位置 | **卡片头部右键菜单**：零新增像素，与侧栏右键 / 批量删除的交互模型一致 |
| 二次确认 | **不确认，直接关闭**：与现有「关闭全部」一致，终端可重跑，同类操作不应两套规则 |
| 关闭后的状态 | **原样保留**：被右键的卡片保留并成为激活态；原本最大化则继续最大化，不做隐式状态变更 |
| 菜单构成 | **三项 + 保留工具条**：`关闭此终端` / `关闭其他终端` / `关闭全部`；工具条上的「关闭全部」不动 |

已确认的约束：极简风格（零新增常驻控件）、文案全中文、深浅主题无需新配色。

---

## 2. 背景：现状

- `TerminalDock.tsx` 结构：工具条（「N 个终端」/「关闭全部」）→ 列表 `data-testid="terminal-list"` → 卡片（头部 div：标题 + Badge/Tag + 最大化按钮 + 关闭按钮；下方 `TerminalView`）。
- 卡片头部目前**没有**任何 `Dropdown`；全项目右键菜单只有侧栏（`Sidebar.tsx`，`trigger={['contextMenu']}`）+ 受控 `openMenuKey` 互斥。
- `window.api.pty` 只有 `close(runId)` 与 `closeAll()`，没有批量关闭接口。
- 主进程 `manager.close(runId)` 对不存在的会话**直接 return，不抛错**（`src/main/pty/manager.ts:210`）；`manager.closeAll()` 就是 `Promise.all(map(destroy))`。
- `pty:exit` 早于 store 移除到达时，`markExited` 只 map 现存会话，找不到即 no-op，不会重建幽灵会话。
- store 现有 `remove(runId)` 已包含「active 回落 / maximized 清空」逻辑。

---

## 3. 交互设计

| 项 | 规则 |
|---|---|
| 触发区域 | 卡片**头部那一行**（标题 + 状态 + 两个按钮），右键弹出菜单；终端内容区（`TerminalView` 容器）**不接管**右键，留给 xterm / 将来的复制粘贴 |
| 菜单项 | `关闭此终端`、`关闭其他终端`、分隔线、`关闭全部`（`danger: true`） |
| 图标 | 一律不带图标、纯文字，与侧栏 `groupMenuItems` / `scriptMenuItems` 一致 |
| 危险色 | **只有「关闭全部」标红**。红色在本菜单表达「影响范围不受右键目标约束」；前两项都以被右键的卡片为参照，范围可预期 |
| 互斥 | 同一时刻最多一个菜单。沿用侧栏写法：单个 `openMenuId: string \| null`（值是卡片 runId），`onOpenChange` 关闭分支必须带 `prev === myId` 守卫 |
| 单项禁用 | `sessions.length < 2` 时「关闭其他终端」置 `disabled: true`（不隐藏，保持菜单位置稳定） |

边界行为：

| 场景 | 行为 |
|---|---|
| 只有 1 个终端 | 「关闭其他终端」禁用；「关闭此终端」「关闭全部」照常 |
| 其余会话已退出（`exited`） | 照样关掉：无进程可杀，只是清卡片 |
| 被右键的卡片处于最大化态 | 其余卡片 `display:none` 但仍在 `sessions` 里，同样被关闭；关闭后仍保持最大化，由用户点「还原」 |
| 右键落在 ×/最大化按钮上 | 冒泡到头部 → 同样弹菜单（不阻止，与侧栏行内按钮右键一致） |
| 某个 `pty.close` 失败 | 其余照常关闭，失败的卡片**留在列表**，`message.error` 提示，可再次右键重试 |

---

## 4. 实现方案

### 4.1 store：新增 `removeMany`，`remove` 收敛为其薄封装

`src/renderer/src/store/useTerminalStore.ts`：

```ts
export interface TerminalActions {
  // ...
  remove: (runId: string) => void
  /** 批量移除：一次过滤 + 一次状态回落，避免多次 setState 出现中间态 */
  removeMany: (runIds: string[]) => void
}
```

```ts
removeMany(runIds) {
  if (runIds.length === 0) return
  const ids = new Set(runIds)
  useTerminalStore.setState((state) => {
    const sessions = state.sessions.filter((s) => !ids.has(s.runId))
    return {
      sessions,
      activeRunId:
        state.activeRunId !== null && ids.has(state.activeRunId)
          ? (sessions[0]?.runId ?? null)
          : state.activeRunId,
      maximizedRunId:
        state.maximizedRunId !== null && ids.has(state.maximizedRunId) ? null : state.maximizedRunId
    }
  })
},

remove(runId) {
  terminalActions.removeMany([runId])
}
```

理由：现有 `remove` 的回落规则必须**只有一份**。批量路径自己写一套过滤，两处规则迟早漂移（例如以后 maximized 回落的策略一变，只改一处就出错）。

### 4.2 `TerminalDock.tsx`

新增状态（**声明区必须在空态早返回之前**，与现有 hooks 同区）：

```tsx
const [openMenuId, setOpenMenuId] = useState<string | null>(null)
```

菜单项构造（每张卡片的 `items`）：

```tsx
const terminalMenuItems: MenuProps['items'] = [
  { key: 'close-self', label: '关闭此终端' },
  { key: 'close-others', label: '关闭其他终端', disabled: sessions.length < 2 },
  { type: 'divider' },
  { key: 'close-all', label: '关闭全部', danger: true }
]
```

关闭其他：

```tsx
const handleCloseOthers = async (runId: string): Promise<void> => {
  const others = sessions.filter((s) => s.runId !== runId).map((s) => s.runId)
  if (others.length === 0) return

  const results = await Promise.allSettled(others.map((id) => window.api.pty.close(id)))
  const closed = others.filter((_, i) => results[i].status === 'fulfilled')

  // 先移除会话再清 writer/缓冲(与 handleClose 同一顺序):两步之间到达的迟到 chunk
  // 会被 usePtyEvents 数据回调里的「会话不存在」检查丢弃
  terminalActions.removeMany(closed)
  terminalActions.setActive(runId) // 规格:保留者成为激活态
  closed.forEach((id) => {
    writers.current.delete(id)
    buffers.current.delete(id)
  })

  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (rejected) {
    message.error(`${toUserMessage(rejected.reason)}(还有 ${others.length - closed.length} 个终端未关闭)`)
  }
}
```

- 两次 store 写（`removeMany` + `setActive`）在 `await` 之后触发；React 18 自动批处理下同一次提交生效，不会出现可见的中间帧。
- **不新增 IPC 批量接口**：`pty.close` 对未知 runId 是 no-op，N 个终端就是 N 次 invoke（N 通常 < 10），加 `pty:closeMany` 只是把 `Promise.all` 挪到主进程，收益为零。

头部改为受 Dropdown 包裹（**只加事件，不改样式**，Dropdown 用 `cloneElement` 注入 `onContextMenu`，不产生额外 DOM 层级）：

```tsx
<Dropdown
  trigger={['contextMenu']}
  open={openMenuId === s.runId}
  onOpenChange={(open) =>
    setOpenMenuId((prev) => (open ? s.runId : prev === s.runId ? null : prev))
  }
  menu={{
    items: terminalMenuItems,
    // 菜单浮层挂在 body 上;阻止冒泡,避免将来给头部加点击行为时被误触
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      if (key === 'close-self') void handleClose(s.runId)
      else if (key === 'close-others') void handleCloseOthers(s.runId)
      else if (key === 'close-all') void handleCloseAll()
    }
  }}
>
  <div style={/* 原头部样式一字不改 */}>
    {/* 标题 / Badge / 最大化 / × */}
  </div>
</Dropdown>
```

头部容器建议加 `data-testid={`card-head-${s.runId}`}`，供测试稳定定位右键目标（不依赖 class 名）。

import 变更：`antd` 增加 `Dropdown` 与类型 `MenuProps`（后者沿用侧栏的 `import type { MenuProps } from 'antd'` 写法）。

---

## 5. 测试设计

### 5.1 store（`tests/renderer/terminalStore.test.ts`，新增 `describe('removeMany')`）

1. 移除多个：`sessions` 只剩未列出的；未命中 id 的会话不受影响。
2. active 被移除 → 回落到剩余首个；active 不在移除集合 → 保持不变。
3. maximized 被移除 → `null`；不在移除集合 → 保持不变。
4. 空数组：状态引用不变（不制造无意义渲染）。
5. `remove(runId)` 与 `removeMany([runId])` 结果一致（锁住「单一回落规则」）。

### 5.2 TerminalDock（`tests/renderer/terminalDock.test.tsx`，新增 `describe('关闭其他终端')`）

jsdom 里右键走 `fireEvent.contextMenu(head)`；菜单浮层 portal 到 body，用 `screen.getByText('关闭其他终端')` 定位。

1. 右键卡片头部 → 三项菜单都在（`关闭此终端` / `关闭其他终端` / `关闭全部`）。
2. 三张卡片右键第二张 → 点「关闭其他终端」：`api.pty.close` 被调用 **2 次且都不含保留者**；`sessions` 只剩保留者；`activeRunId` 为保留者。
3. 单终端时该项 `disabled`（断言浮层内该项带 `ant-dropdown-menu-item-disabled`）。
4. 右键菜单互斥：打开 A 卡菜单后再右键 B 卡，只应存在一个可见菜单。
5. 失败保留：让其中一个 `pty.close` reject → 该卡片仍在 `sessions`，其余被移除。**此用例必须用 antd `<App>` 包裹渲染**——`App.useApp()` 的默认上下文是 `{ message: {} }`，无 `<App>` 时 `message.error` 是 `undefined`，失败路径会抛 `TypeError`（现有用例都没走错误分支，故一直没暴露）。

既有用例不受影响：`iconButtons('close')` / `('fullscreen')` 仍由图标 aria-label 定位，Dropdown 包裹不改变按钮可访问名；卡片子节点结构、`terminal-list` 直接子元素（卡片 div）均不变。

---

## 6. 不做的事（YAGNI）

- 不加「关闭左侧 / 右侧终端」。
- 不做终端标签栏 / 拖拽排序。
- 不加键盘快捷键（如 Cmd+Shift+W）。
- 不改工具条（「关闭全部」保留在原位）。
- 不动 `pty` 主进程接口。
- README 不新增条目。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 右键菜单发现性低（隐形操作） | 已确认接受；工具条「关闭全部」作为同类能力的可见锚点 |
| 受控 open 的守卫写错 → 两菜单同时开 / 全关 | 照抄侧栏 `prev === myId` 写法；用例 4 锁互斥 |
| 批量关闭时部分失败导致状态半更新 | `allSettled` + 只移除成功的 id；失败卡片可重试 |
| 错误分支在无 `<App>` 环境下抛错（测试基建缺口） | 用例 5 显式用 `<App>` 包裹渲染 |
| `remove` 与 `removeMany` 回落规则分叉 | `remove` 直接委托 `removeMany([runId])`，用例 5.1.5 锁住 |

---

## 8. 验收标准

1. 卡片头部右键弹出三项菜单，纯文字无图标，「关闭全部」标红，其余两项不标红。
2. 三张卡片时对第二张执行「关闭其他终端」：只剩第二张，它是激活态，其余终端进程终止。
3. 只有 1 个终端时该项禁用但可见。
4. 最大化状态下执行后仍保持最大化。
5. 某个终端关闭失败：该卡片留在列表，弹出错误提示。
6. `npm run typecheck` 通过；新增用例 + 既有用例全绿（最终以用户本机 `npm test` 为准）。
7. 回退验证：临时把 `handleCloseOthers` 改成只关一张 → 用例 2 变红；把 `remove` 的委托改回独立实现 → 用例 5.1.5 仍绿则说明该断言无效，需加强。
