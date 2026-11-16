# 终端卡片「关闭其他终端」实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 终端卡片头部右键菜单提供「关闭此终端 / 关闭其他终端 / 关闭全部」三项，其中「关闭其他终端」保留被右键的卡片并使其成为激活态。

**架构：** store 新增 `removeMany(runIds)` 承担唯一的「移除 + 状态回落」规则，`remove` 收敛为其薄封装；`TerminalDock` 用受控 `Dropdown trigger={['contextMenu']}` 包裹卡片头部，批量关闭走 `Promise.allSettled` 逐个 `pty.close`，只移除成功的会话。不新增 IPC。

**技术栈：** React 18 + TypeScript、antd `Dropdown`/`App.useApp`、zustand、vitest + @testing-library/react（jsdom）。

**规格来源：** `docs/superpowers/specs/2026-11-16-close-other-terminals-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/renderer/src/store/useTerminalStore.ts` | 终端的唯一状态源。新增 `removeMany`，把「移除会话 → active 回落 → maximized 清空」收敛成一份规则 | 修改 |
| `src/renderer/src/components/TerminalDock.tsx` | 终端卡片列表与所有关闭交互。新增头部右键菜单、`handleCloseOthers`、菜单互斥状态 | 修改 |
| `tests/renderer/terminalStore.test.ts` | store 纯逻辑用例 | 修改（追加 describe） |
| `tests/renderer/terminalDock.test.tsx` | 卡片渲染与交互用例 | 修改（追加 describe + 顶部 import） |

不新建文件：本次改动是既有两文件的职责内延伸，拆成新模块只会让「关闭终端」的语义散落两处。

---

## 环境准备（每个任务都适用）

- **沙箱里跑单文件用例的固定命令**（vitest 本体在沙箱内起不来）：

```bash
bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalStore.test.ts
node .workbuddy/verify/drive.mjs terminalStore.test.bundle.mjs terminalStore
# 末尾行形如：[terminalStore] 8/8 通过
```

- **类型检查**（可跑，约 30s，无输出即通过）：

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json
```

- **测试与构建最终以用户本机 `npm test` / `npm run typecheck` 为准**，沙箱结果只作为开发期快反馈。

---

### 任务 1：store 新增 `removeMany`，`remove` 收敛为薄封装

**文件：**
- 修改：`src/renderer/src/store/useTerminalStore.ts:23-52`
- 测试：`tests/renderer/terminalStore.test.ts`（在文件末尾追加）

- [ ] **步骤 1：编写失败的测试**

在 `tests/renderer/terminalStore.test.ts` 末尾追加（文件顶部已 import `terminalActions` / `useTerminalStore`，`beforeEach` 已重置状态，无需改动其他部分）：

```ts
describe('批量移除终端', () => {
  /** 铺三张卡片:r3 在最上(最新),r1 在最下,与 add 的插入顺序语义一致 */
  const seedThree = (): void => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.add({ runId: 'r3', title: 'c', scriptId: 's3' })
  }

  it('一次移除多个,未列出的会话原样保留', () => {
    seedThree()
    terminalActions.removeMany(['r1', 'r3'])
    expect(terminalActions.get().sessions.map((s) => s.runId)).toEqual(['r2'])
  })

  it('活动项被移除时回落到剩余的第一个', () => {
    seedThree()
    terminalActions.setActive('r3')
    terminalActions.removeMany(['r2', 'r3'])
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('活动项不在移除集合里就保持不变', () => {
    seedThree()
    terminalActions.setActive('r1')
    terminalActions.removeMany(['r2', 'r3'])
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('最大化项被移除时清空最大化状态', () => {
    seedThree()
    terminalActions.setMaximized('r1', true)
    terminalActions.removeMany(['r1', 'r2'])
    expect(terminalActions.get().maximizedRunId).toBeNull()
  })

  it('最大化项不在移除集合里就继续保持最大化', () => {
    seedThree()
    terminalActions.setMaximized('r1', true)
    terminalActions.removeMany(['r2', 'r3'])
    expect(terminalActions.get().maximizedRunId).toBe('r1')
  })

  it('空数组不产生新的状态对象(避免无意义渲染)', () => {
    seedThree()
    const before = useTerminalStore.getState()
    terminalActions.removeMany([])
    // 同一引用 = zustand 不会通知订阅者
    expect(useTerminalStore.getState()).toBe(before)
  })

  it('单个 remove 与 removeMany([id]) 结果完全一致 —— 回落规则只有一份', () => {
    seedThree()
    terminalActions.setActive('r2')
    terminalActions.setMaximized('r2', true)
    terminalActions.remove('r2')
    const byOne = useTerminalStore.getState()

    useTerminalStore.setState({ sessions: [], activeRunId: null, maximizedRunId: null })
    seedThree()
    terminalActions.setActive('r2')
    terminalActions.setMaximized('r2', true)
    terminalActions.removeMany(['r2'])
    const byMany = useTerminalStore.getState()

    expect(byMany).toEqual(byOne)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

```bash
bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalStore.test.ts
node .workbuddy/verify/drive.mjs terminalStore.test.bundle.mjs terminalStore
```

预期：7 条新用例全红，前 6 条报 `terminalActions.removeMany is not a function`，第 7 条通过（此时 `remove` 是独立实现，结果恰好一致）。汇总形如 `[terminalStore] 9/15 通过`。

- [ ] **步骤 3：编写最少实现代码**

在 `src/renderer/src/store/useTerminalStore.ts` 的 `TerminalActions` 接口里，`remove` 之后加：

```ts
  remove: (runId: string) => void
  /**
   * 批量移除：一次过滤 + 一次状态回落。
   * 批量路径自己写一套过滤会让「active 回落 / maximized 清空」出现第二份规则，
   * 迟早与 remove 漂移 —— 所以 remove 也直接委托到这里。
   */
  removeMany: (runIds: string[]) => void
```

把现有 `remove` 实现整体替换为：

```ts
  removeMany(runIds) {
    // 空数组直接返回：不新建状态对象，zustand 就不会通知订阅者
    if (runIds.length === 0) return
    const ids = new Set(runIds)
    useTerminalStore.setState((state) => {
      const sessions = state.sessions.filter((s) => !ids.has(s.runId))
      return {
        sessions,
        // 被移除的 active 回落到剩余首个；未被移除则原样保留（含 null）
        activeRunId:
          state.activeRunId !== null && ids.has(state.activeRunId)
            ? (sessions[0]?.runId ?? null)
            : state.activeRunId,
        // 被移除的 maximized 清空；未被移除则原样保留（含 null）
        maximizedRunId:
          state.maximizedRunId !== null && ids.has(state.maximizedRunId) ? null : state.maximizedRunId
      }
    })
  },

  remove(runId) {
    terminalActions.removeMany([runId])
  },
```

- [ ] **步骤 4：运行测试验证通过**

```bash
bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalStore.test.ts
node .workbuddy/verify/drive.mjs terminalStore.test.bundle.mjs terminalStore
```

预期：`[terminalStore] 15/15 通过`（原有 8 条 + 新增 7 条）。

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/src/store/useTerminalStore.ts tests/renderer/terminalStore.test.ts
git commit -m "refactor(terminal): store 新增 removeMany,remove 收敛为其薄封装"
```

---

### 任务 2：卡片头部右键菜单（关闭此终端 / 关闭其他终端 / 关闭全部）

**文件：**
- 修改：`src/renderer/src/components/TerminalDock.tsx`
- 测试：`tests/renderer/terminalDock.test.tsx`（顶部 import 追加 + 文件末尾追加 describe）

- [ ] **步骤 1：编写失败的测试**

先改 `tests/renderer/terminalDock.test.tsx` 顶部两处 import（其余 import 不动）：

```tsx
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
```

并把测试里写死的关闭失败行为打开一个口子 —— 在 `setupApi()` 之后追加一个辅助函数（放在 `renderDock` 定义下方）：

```tsx
/** 渲染时包一层 antd App：关闭失败分支会调 message.error，无 App 上下文时它是 undefined 会抛 TypeError */
function renderDockInApp(): void {
  render(
    <App>
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <TerminalDock />
      </ThemeProvider>
    </App>
  )
}

/** 菜单项元素（antd 把 role="menuitem" 挂在 .ant-dropdown-menu-item 上） */
function menuItem(label: string): HTMLElement {
  const el = screen.getByText(label).closest('.ant-dropdown-menu-item')
  if (!el) throw new Error(`菜单项「${label}」不存在`)
  return el as HTMLElement
}
```

在文件末尾追加：

```tsx
describe('卡片头部右键菜单', () => {
  it('右键卡片头部弹出三项关闭菜单,且是纯文字(无图标)', async () => {
    setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    renderDock()
    // 对照组:右键前菜单项不存在,证明后面的断言确实来自这一次右键
    expect(screen.queryByText('关闭其他终端')).toBeNull()

    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))

    expect(await screen.findByText('关闭此终端')).toBeTruthy()
    expect(screen.getByText('关闭其他终端')).toBeTruthy()
    expect(screen.getByText('关闭全部')).toBeTruthy()

    for (const label of ['关闭此终端', '关闭其他终端', '关闭全部']) {
      expect(menuItem(label).querySelector('.anticon')).toBeNull()
    }
    // 危险色只给范围不受右键目标约束的那一项
    expect(menuItem('关闭全部').className).toContain('danger')
    expect(menuItem('关闭其他终端').className).not.toContain('danger')
    expect(menuItem('关闭此终端').className).not.toContain('danger')
  })

  it('关闭其他终端:只保留被右键的那张,并让它成为激活态', async () => {
    const api = setupApi()
    useTerminalStore.setState({
      sessions: [session('r3', 'C'), session('r2', 'B'), session('r1', 'A')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))
    fireEvent.click(await screen.findByText('关闭其他终端'))

    await waitFor(() => expect(useTerminalStore.getState().sessions.map((s) => s.runId)).toEqual(['r2']))
    // 其余两个各关一次,保留者一次都不关
    const closedIds = api.pty.close.mock.calls.map((c) => c[0])
    expect(closedIds.sort()).toEqual(['r1', 'r3'])
    expect(useTerminalStore.getState().activeRunId).toBe('r2')
  })

  it('只剩一个终端时「关闭其他终端」禁用但仍在菜单里', async () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('card-head-r1'))

    const target = await screen.findByText('关闭其他终端')
    expect(target.closest('.ant-dropdown-menu-item')?.className).toContain('ant-dropdown-menu-item-disabled')
    // 「关闭此终端」「关闭全部」不受影响
    expect(menuItem('关闭此终端').className).not.toContain('disabled')
    expect(menuItem('关闭全部').className).not.toContain('disabled')
  })

  it('最大化态下关闭其他:隐藏的卡片同样被关,保留者仍保持最大化', async () => {
    const api = setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r1',
      maximizedRunId: 'r2'
    })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))
    fireEvent.click(await screen.findByText('关闭其他终端'))

    await waitFor(() => expect(api.pty.close).toHaveBeenCalledWith('r1'))
    expect(useTerminalStore.getState().sessions.map((s) => s.runId)).toEqual(['r2'])
    expect(useTerminalStore.getState().maximizedRunId).toBe('r2')
  })

  it('某个终端关不掉时:其余照关,失败的卡片留在列表并提示', async () => {
    const api = setupApi()
    api.pty.close.mockImplementation(async (runId: string) => {
      if (runId === 'r1') throw new Error('会话不存在')
      return undefined
    })
    useTerminalStore.setState({
      sessions: [session('r3', 'C'), session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    // 错误分支会调 message.error：必须包 App,否则 useApp 拿到空 message 对象
    renderDockInApp()
    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))
    fireEvent.click(await screen.findByText('关闭其他终端'))

    await waitFor(() => expect(useTerminalStore.getState().sessions.map((s) => s.runId)).toEqual(['r1', 'r2']))
    await waitFor(() => expect(document.querySelector('.ant-message')).toBeTruthy())
  })

  it('同一时刻只有一个菜单:右键 B 之后 A 的菜单关闭', async () => {
    setupApi()
    useTerminalStore.setState({
      sessions: [session('r1', 'A'), session('r2', 'B')],
      activeRunId: 'r1',
      maximizedRunId: null
    })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('card-head-r1'))
    await screen.findByText('关闭其他终端')

    fireEvent.contextMenu(screen.getByTestId('card-head-r2'))

    // 可见菜单（排除 .ant-dropdown-hidden）必须只有一个
    await waitFor(() => {
      const visible = Array.from(document.querySelectorAll('.ant-dropdown')).filter(
        (el) => !el.classList.contains('ant-dropdown-hidden')
      )
      expect(visible.length).toBe(1)
    })
  })

  it('终端内容区右键不弹关闭菜单', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    fireEvent.contextMenu(screen.getByTestId('view-r1'))

    expect(screen.queryByText('关闭其他终端')).toBeNull()
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

```bash
bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalDock.test.tsx
node .workbuddy/verify/drive.mjs terminalDock.test.bundle.mjs terminalDock
```

预期：`getByTestId('card-head-r1')` 找不到 → 前 6 条红（报 unable to find element by `card-head-*`）；第 7 条「内容区右键不弹菜单」通过（因为菜单还没实现，永远不弹）。汇总形如 `[terminalDock] 18/24 通过`。

- [ ] **步骤 3：实现菜单与批量关闭**

**(a) 顶部 import**（`TerminalDock.tsx:2-3` 区域）：

```tsx
import { App, Badge, Button, Dropdown, Tag, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
```

- [ ] **(b) 文件顶部常量**（紧接 `BACK_TO_TOP_THRESHOLD` 之后）：

```tsx
/**
 * 卡片头部右键菜单。
 * 纯文字无图标,与侧栏 groupMenuItems / scriptMenuItems 一致;
 * 危险色只给「关闭全部」—— 前两项以被右键的卡片为参照、范围可预期,
 * 只有它的影响范围不受右键目标约束。
 */
const terminalMenuItems = (canCloseOthers: boolean): MenuProps['items'] => [
  { key: 'close-self', label: '关闭此终端' },
  { key: 'close-others', label: '关闭其他终端', disabled: !canCloseOthers },
  { type: 'divider' },
  { key: 'close-all', label: '关闭全部', danger: true }
]
```

- [ ] **(c) 声明区新增互斥状态**（放在 `const [tipOpen, setTipOpen] = useState(false)` 之后，仍在空态早返回之前）：

```tsx
  /**
   * 当前开着的卡片右键菜单（值是卡片 runId）；null = 全关。
   * 与 Sidebar 的 openMenuKey 同一套写法：单个 key 让「互斥」退化成一次 setState。
   * ⚠️ onOpenChange 的关闭分支必须带 `prev === myId` 守卫 —— antd 在
   * 「另一个菜单打开导致我被动关闭」时也会回调本 Dropdown(open=false)，
   * 少了守卫会把刚设的新 key 一起清掉，两个菜单全关。
   */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
```

- [ ] **(d) 批量关闭处理器**（放在 `handleCloseAll` 之后）：

```tsx
  // 关闭其他：保留 runId 这张卡片，其余全关。
  // 不用 closeAll —— pty.close 对不存在的会话是 no-op（主进程直接 return），
  // 逐个关即可，N 通常 < 10，为此新增一个 IPC 只是把 Promise.all 挪到主进程。
  const handleCloseOthers = async (runId: string): Promise<void> => {
    const others = sessions.filter((s) => s.runId !== runId).map((s) => s.runId)
    if (others.length === 0) return

    const results = await Promise.allSettled(others.map((id) => window.api.pty.close(id)))
    // 只移除真正关掉的：失败的卡片留在列表里可重试
    const closed = others.filter((_, i) => results[i].status === 'fulfilled')

    // 先移除会话再清 writer/缓冲（与 handleClose 同一顺序）：两步之间到达的迟到 chunk
    // 会被数据回调里的「会话不存在」检查丢弃
    terminalActions.removeMany(closed)
    // 规格：保留者成为激活态（可能原本是别的卡片在激活）
    terminalActions.setActive(runId)
    closed.forEach((id) => {
      writers.current.delete(id)
      buffers.current.delete(id)
    })

    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (rejected) {
      const remaining = others.length - closed.length
      message.error(`${toUserMessage(rejected.reason)}（还有 ${remaining} 个终端未关闭）`)
    }
  }
```

- [ ] **(e) 头部包进 Dropdown**（把现有 `<div style={{...头部样式...}}>` 整块包起来，样式一字不改）：

```tsx
                <Dropdown
                  trigger={['contextMenu']}
                  open={openMenuId === s.runId}
                  onOpenChange={(open) =>
                    setOpenMenuId((prev) => (open ? s.runId : prev === s.runId ? null : prev))
                  }
                  menu={{
                    items: terminalMenuItems(sessions.length > 1),
                    // 浮层挂在 body 上；阻止冒泡，避免将来给头部加点击行为时被误触
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation()
                      if (key === 'close-self') void handleClose(s.runId)
                      else if (key === 'close-others') void handleCloseOthers(s.runId)
                      else if (key === 'close-all') void handleCloseAll()
                    }
                  }}
                >
                  <div
                    data-testid={`card-head-${s.runId}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 4px 5px 10px',
                      borderBottom: '1px solid var(--app-hairline)',
                      background: 'var(--app-subtle-bg)',
                      flex: '0 0 auto'
                    }}
                  >
                    {/* 标题 / Badge / 最大化按钮 / 关闭按钮：内容一行不改 */}
                  </div>
                </Dropdown>
```

注意：Dropdown 用 `cloneElement` 给子元素注入 `onContextMenu`，不产生额外 DOM 层级，卡片网格布局不受影响。

- [ ] **步骤 4：运行测试验证通过**

```bash
bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalDock.test.tsx
node .workbuddy/verify/drive.mjs terminalDock.test.bundle.mjs terminalDock
```

预期：`[terminalDock] 24/24 通过`（原有 17 条 + 新增 7 条）。

若「同一时刻只有一个菜单」偶发为 2：antd 关闭是异步的，把断言包在 `waitFor` 里（上面已包）；仍失败则说明缺少 `prev === myId` 守卫。

- [ ] **步骤 5：类型检查**

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json
```

预期：无输出、退出码 0。常见报错：`MenuProps['items']` 里的 `type: 'divider'` 被推断成 `string` → 把常量声明为 `MenuProps['items']`（如上面写法）即可，勿用 `as const`。

- [ ] **步骤 6：Commit**

```bash
git add src/renderer/src/components/TerminalDock.tsx tests/renderer/terminalDock.test.tsx
git commit -m "feat(terminal): 卡片头部右键菜单支持关闭其他终端"
```

---

### 任务 3：全量回归与回退验证

**文件：** 无代码改动（只跑测试）

- [ ] **步骤 1：沙箱全量回归**

```bash
bash .workbuddy/verify/run-all.sh .workbuddy/verify/run-all-closeothers.log
tail -6 .workbuddy/verify/run-all-closeothers.log
```

预期：汇总行 `全量汇总: N/N 通过`，无「失败文件」「OOM 文件」。

- [ ] **步骤 2：回退验证（证明新用例确有约束力）**

先备份实现（**不要用 `git checkout --`，会连未提交改动一起毁掉**）：

```bash
cp src/renderer/src/components/TerminalDock.tsx .workbuddy/verify/backup/TerminalDock.closeothers.bak
```

把 `handleCloseOthers` 的 `others.filter((s) => s.runId !== runId)` 临时改成 `others.filter(() => false)`（即一个都不关），重跑：

```bash
bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalDock.test.tsx
node .workbuddy/verify/drive.mjs terminalDock.test.bundle.mjs terminalDock
```

预期：「关闭其他终端:只保留被右键的那张」「最大化态下关闭其他」两条变红。

恢复：

```bash
cp .workbuddy/verify/backup/TerminalDock.closeothers.bak src/renderer/src/components/TerminalDock.tsx
```

再跑一次，确认回到 24/24。

- [ ] **步骤 3：确认工作区干净**

```bash
git status --porcelain
```

预期：只有 `.workbuddy/`（已被 .gitignore 忽略）相关，或完全无输出。

---

## 自检记录

**规格覆盖度**

| 规格条目 | 对应任务 |
|---|---|
| §3 头部右键触发、内容区不接管 | 任务 2 步骤 3(e) + 用例「终端内容区右键不弹关闭菜单」 |
| §3 三项菜单 / 纯文字 / 仅关闭全部标红 | 任务 2 步骤 3(b) + 用例 1 |
| §3 互斥（单 key + 守卫） | 任务 2 步骤 3(c) + 用例 6 |
| §3 单终端时禁用不隐藏 | 任务 2 步骤 3(b) + 用例 3 |
| §3 已退出会话一并关闭 | 由「按 runId 全部关闭」自然满足（`exited` 不影响过滤） |
| §3 最大化态下隐藏卡片同样关闭、保留者保持最大化 | 用例 4 |
| §3 部分失败保留卡片并提示 | 任务 2 步骤 3(d) + 用例 5 |
| §4.1 removeMany + remove 委托 | 任务 1 全部 |
| §4.2 不新增 IPC | 任务 2 步骤 3(d) 注释 + 无 IPC 改动 |
| §4.2 active 设为保留者 | 用例 2 |
| §5 测试设计 | 任务 1（7 条）+ 任务 2（7 条） |
| §7 风险：错误分支需 `<App>` 包裹 | `renderDockInApp` + 用例 5 |
| §8 验收 | 任务 3 |

**占位符扫描**：无「待定 / TODO / 类似任务 N」；每个代码步骤均给出完整代码块。

**类型一致性**：`removeMany(runIds: string[])` 在任务 1 定义、任务 2 调用一致；`terminalMenuItems(canCloseOthers: boolean)` 在声明与调用两处签名一致；`openMenuId` 全程为 `string | null`；测试用 `card-head-${runId}` 与实现中的 `data-testid` 完全一致。
