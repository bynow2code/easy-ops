# 终端列表「回到顶部」按钮实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 终端卡片列表滚离顶部超过阈值时，右下角浮现一个圆形回顶按钮；点击平滑滚回顶部；回到顶部附近自动收起。

**架构：** 列表外包一层 `position: relative` 的定位壳，按钮绝对定位浮在壳的右下角、按 `showBackTop` 条件渲染；`showBackTop` 由列表 `onScroll` 与一个「会话数/最大化态变化」的同步 effect 共同维护。样式全走现有令牌、手写 `<button>`，不用 antd FloatButton。

**技术栈：** React 18 + @ant-design/icons + 原生 CSS（设计令牌）+ vitest/@testing-library/react

**规格来源：** `docs/superpowers/specs/2026-10-12-terminal-back-to-top-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/renderer/src/components/TerminalDock.tsx` | `showBackTop`/`tipOpen` 状态、`listRef`、`onScroll`、定位壳与按钮节点 | 修改 |
| `src/renderer/src/theme/theme.css` | 末尾追加 `.app-backtop` 样式小节（悬停/过渡/键盘轮廓） | 修改（追加） |
| `tests/renderer/terminalDock.test.tsx` | 新增 `describe('回到顶部按钮')` 6 条用例 + 2 个 helper | 修改（追加） |

**为什么只改这三个文件**：按钮是纯 UI 交互，不涉及 store、主进程或持久化；终端本体（xterm）不动。

---

## 关键背景（实现前必读）

### 1. jsdom 实测事实（2026-10-12 探针 `.workbuddy/verify/probe-scrolltop.cjs`）

- `el.scrollTo` 在 jsdom 中**不存在**（`typeof === 'undefined'`）—— 凡是会点击回顶按钮的用例，都必须先给 `scrollTo` 打桩，否则处理器抛 `TypeError` 用例直接红。
- `el.scrollTop` 直接赋值可回读；`Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 300 })` 数据属性替身同样可行（规格指定写法，采用后者，不依赖 jsdom 原型实现细节）。
- 「`fireEvent.scroll` → React `onScroll` 读到替身 scrollTop → setState 生效」链路已用探针 `.workbuddy/verify/probe-scroll.test.tsx` 在沙箱管线实测通过（1/1，`node .workbuddy/verify/drive.mjs probe-scroll.test.bundle.mjs probe-scroll.test`），测试写法可放心照抄。

### 2. hooks 声明位置（硬性）

新增的 `useRef`/`useState`/`useEffect` 必须声明在 `if (sessions.length === 0) return` 空态早返回（现位于 `TerminalDock.tsx:73`）**之前** —— 否则挂载/卸载间 hooks 数量变化，React 报错。

### 3. Tooltip 受控 open 的既有出处

「点击后提示不残留」的受控 open 模式来自最大化按钮的教训（背景 bug：点完按钮提示一直挂在按钮上方）：
- 实现：`TerminalDock.tsx:201-220`
- 用例模板：`terminalDock.test.tsx:157-188`（hover 展开 → 点击收起 → 移出再悬停可再展开）

回顶按钮照抄同一模式。

### 4. 定位壳不影响既有用例

`terminal-list` 元素本身及其子节点（卡片）结构不变：既有用例读它的 `style.gridTemplateColumns`（:107）与 `children`（:200）均照旧；按钮是列表的**兄弟节点**，不会成为 grid 项、也不会进 `children`。

### 5. 沙箱测试限制（本仓库已知）

vitest 因 `ulimit -v` 4GB 起不来；单文件走沙箱管线：

```bash
bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalDock.test.tsx; node .workbuddy/verify/drive.mjs terminalDock.test.bundle.mjs terminalDock.test
```

- 该文件含 `vi.mock`，脚本自动改走 build-with-mocks；2026-10-12 上次全量中单进程 9/9 通过。新增到 15 条后若 OOM，按 describe 切片跑。
- typecheck 沙箱可跑（2026-10-12 基线 4s / 0 error）。
- **本机（最终验收以此为准）：`npm test`。**

---

## 任务 1：浮现式回顶按钮（滚动显隐 + 点击回顶 + 样式）

**文件：**
- 修改：`src/renderer/src/components/TerminalDock.tsx`（常量 :9-10；import :1-3；hooks 区 :23 后；渲染区 :133-150 / :244）
- 修改：`src/renderer/src/theme/theme.css`（末尾追加）
- 测试：`tests/renderer/terminalDock.test.tsx`（追加 helper + describe）

**交付物**：滚动超过阈值浮现、点击平滑回顶、滚回阈值内收起；样式与深浅主题适配；5 条新用例绿（规格 4 条 + 1 条「状态同步」用例，见步骤 1 说明）。

- [ ] **步骤 1：编写失败的测试**

1a. 修改 `tests/renderer/terminalDock.test.tsx` 第 2 行的 import，加入 `act`（同步 effect 用例要用）：

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
```

1b. 在 `iconButtons` helper（:54-60）之后追加两个 helper：

```tsx
/** 回顶按钮的查询入口(queryBy* 形式:显隐两侧断言都用它) */
function backTopButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: '回到顶部' })
}

/** jsdom 无真实滚动:用数据属性替身改写 scrollTop 再补发 scroll 事件,模拟列表滚动 */
function scrollListTo(list: HTMLDivElement, value: number): void {
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value })
  fireEvent.scroll(list)
}
```

1c. 在文件末尾（`describe('终端瀑布流')` 闭括号 :221 之后）追加：

```tsx
describe('回到顶部按钮', () => {
  it('顶部时不出现 —— 列表没滚动过就没有这个按钮', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()

    expect(backTopButton()).toBeNull()
  })

  it('滚动超过阈值后浮现', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    scrollListTo(screen.getByTestId('terminal-list') as HTMLDivElement, 300)

    expect(backTopButton()).toBeTruthy()
  })

  it('点击回顶按钮以平滑方式滚回顶部', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    // jsdom 没有 Element.scrollTo,必须打桩,否则点击处理器抛 TypeError
    const scrollToSpy = vi.fn()
    Object.defineProperty(list, 'scrollTo', { configurable: true, value: scrollToSpy })
    scrollListTo(list, 300)

    fireEvent.click(screen.getByRole('button', { name: '回到顶部' }))

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('回到顶部附近自动收起', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    scrollListTo(list, 300)
    expect(backTopButton()).toBeTruthy()

    scrollListTo(list, 0)

    expect(backTopButton()).toBeNull()
  })

  it('内容变短(scrollTop 被浏览器夹回)后状态主动同步 —— 不依赖 scroll 事件', () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A'), session('r2', 'B')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    scrollListTo(list, 300)
    expect(backTopButton()).toBeTruthy()

    // 模拟「关闭终端 / 切最大化后,浏览器把 scrollTop 夹回 0 且不补发 scroll 事件」:
    // 直接改写值,再让会话数变化触发同步 effect
    list.scrollTop = 0
    act(() => {
      useTerminalStore.setState({ sessions: [session('r1', 'A')], activeRunId: 'r1', maximizedRunId: null })
    })

    expect(backTopButton()).toBeNull()
  })
})
```

> **第 5 条用例的说明（超出规格 §6 所列 5 条，请审查者留意）**：规格 §3 边界行为表（「关闭终端 / 切换最大化导致内容变短」）与 §5.1 的同步 effect 在规格用例列表中没有直接守卫，本计划补第 5 条锁住「不依赖 scroll 事件」这一点；任务 3 的回退验证会证明它不是摆设。若认为多余，删掉该 `it` 即可，其余步骤不受影响。

- [ ] **步骤 2：运行测试验证失败**

沙箱：`bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalDock.test.tsx; node .workbuddy/verify/drive.mjs terminalDock.test.bundle.mjs terminalDock.test`
（两命令用 `;` 相连：构建尾部 rm 的 genie-trash 报错属已知噪音，只要打印「构建完成」，bundle 即已产出。）
本机：`npm test -- terminalDock`

预期：**4 条新用例 FAIL**（滚动浮现 `expected null to be truthy`、点击回顶 `getByRole` 找不到按钮、回顶收起、状态同步）；「顶部时不出现」与既有 9 条 PASS。

- [ ] **步骤 3：更新 import（TerminalDock.tsx :1-3）**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { CloseOutlined, CodeOutlined, FullscreenExitOutlined, FullscreenOutlined, VerticalAlignTopOutlined } from '@ant-design/icons'
```

- [ ] **步骤 4：新增阈值常量（:10 `CARD_HEIGHT` 下方）**

```tsx
/** 卡片固定高度,终端多了整体纵向滚动 */
const CARD_HEIGHT = 340

/** 列表滚离顶部超过该距离时浮现「回到顶部」按钮(约大半张卡片高) */
const BACK_TO_TOP_THRESHOLD = 200
```

- [ ] **步骤 5：新增状态与同步 effect（:23 `tipRunId` 声明之后）**

```tsx
  // 「回到顶部」按钮:列表滚离顶部超过阈值才浮现。
  // 声明区必须在空态早返回(sessions.length === 0)之前 —— 否则 hooks 数量随分支变化。
  const listRef = useRef<HTMLDivElement>(null)
  const [showBackTop, setShowBackTop] = useState(false)

  // 会话数 / 最大化态变化都会让浏览器把滚动位置夹回(内容变短),
  // 这里主动同步一次,不依赖「浏览器是否补发 scroll 事件」
  useEffect(() => {
    const el = listRef.current
    if (el) setShowBackTop(el.scrollTop > BACK_TO_TOP_THRESHOLD)
  }, [sessions.length, maximizedRunId])
```

- [ ] **步骤 6：渲染改造 A —— 定位壳 + `onScroll`（替换 :133-150 列表开标签）**

把：

```tsx
      <div
        data-testid="terminal-list"
        style={
          isMaximized
            ? { flex: 1, minHeight: 0, overflow: 'auto' }
            : {
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                display: 'grid',
                // 单列纵向排布:卡片占满宽度,从上往下流,整列可滚动
                gridTemplateColumns: '1fr',
                gridAutoRows: `${CARD_HEIGHT}px`,
                alignContent: 'start',
                gap: 10
              }
        }
      >
```

替换为：

```tsx
      {/* 定位壳:回顶按钮浮在列表右下角;列表自身两个分支(普通/最大化)的样式一行不动 */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div
          ref={listRef}
          data-testid="terminal-list"
          onScroll={(e) => setShowBackTop(e.currentTarget.scrollTop > BACK_TO_TOP_THRESHOLD)}
          style={
            isMaximized
              ? { flex: 1, minHeight: 0, overflow: 'auto' }
              : {
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  display: 'grid',
                  // 单列纵向排布:卡片占满宽度,从上往下流,整列可滚动
                  gridTemplateColumns: '1fr',
                  gridAutoRows: `${CARD_HEIGHT}px`,
                  alignContent: 'start',
                  gap: 10
                }
          }
        >
```

- [ ] **步骤 7：渲染改造 B —— 壳闭合 + 按钮节点（:244 列表收尾处）**

把列表收尾的两个 `</div>`：

```tsx
      </div>
    </div>
```

替换为：

```tsx
        </div>
        {showBackTop && (
          <button
            type="button"
            className="app-backtop"
            aria-label="回到顶部"
            onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <VerticalAlignTopOutlined />
          </button>
        )}
      </div>
    </div>
```

> 注：列表内部（`sessions.map` 块）整体 +2 缩进 —— 包装定位壳的固有代价，diff 里会出现大段缩进变化，属预期。

- [ ] **步骤 8：追加 CSS（`theme.css` 末尾）**

```css
/* ── 终端列表「回到顶部」浮动按钮 ─────────────────────────
 * 显隐逻辑在 TerminalDock.tsx(仅滚离顶部 > 阈值时渲染);
 * 配色全走令牌,深浅主题自动适配。 */
.app-backtop {
  position: absolute;
  right: 14px;
  bottom: 14px;
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-text-secondary);
  background: var(--color-bg-container);
  border: 1px solid var(--app-hairline-strong);
  border-radius: 50%;
  box-shadow: var(--app-shadow-panel);
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease;
}

.app-backtop:hover {
  color: var(--color-text);
  background: var(--app-subtle-bg);
}

.app-backtop:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}
```

> 令牌全部已在 `tokens.ts` 注入（`hairlineStrong`/`shadowPanel`/`subtleBg`/`primary`）；`--color-text`、`--color-text-secondary`、`--color-bg-container` 由 theme.css 定义。`appTokens.test.ts` 契约扫描会兜底校验。

- [ ] **步骤 9：运行测试验证通过**

沙箱：`bash .workbuddy/verify/build-and-run.sh tests/renderer/terminalDock.test.tsx; node .workbuddy/verify/drive.mjs terminalDock.test.bundle.mjs terminalDock.test`
（若构建脚本以 genie-trash 噪音非零退出但已打印「构建完成」，继续跑 drive 命令即可。）

预期：`[terminalDock.test] 14/14 通过`（既有 9 + 新增 5）。

- [ ] **步骤 10：Typecheck**

运行：`npm run typecheck`
预期：0 error，退出码 0。

- [ ] **步骤 11：Commit**

```bash
git add src/renderer/src/components/TerminalDock.tsx src/renderer/src/theme/theme.css tests/renderer/terminalDock.test.tsx
git commit -m "feat(terminal): 终端列表回到顶部浮动按钮(滚动显隐 + 平滑回顶)"
```

---

## 任务 2：悬停提示（受控 open、点击即收）

**文件：**
- 修改：`src/renderer/src/components/TerminalDock.tsx`（hooks 区 + 按钮区块）
- 测试：`tests/renderer/terminalDock.test.tsx`（追加第 6 条用例）

**交付物**：悬停「回到顶部」提示；点击后提示立即收起、不残留；移出再悬停可再展开（规格用例 5）。

- [ ] **步骤 1：编写失败的测试**

在 `describe('回到顶部按钮')` 内追加：

```tsx
  it('点击回顶按钮后提示立即收起 —— 鼠标仍停在按钮上也不残留', async () => {
    setupApi()
    useTerminalStore.setState({ sessions: [session('r1', 'A')], activeRunId: 'r1', maximizedRunId: null })

    renderDock()
    const list = screen.getByTestId('terminal-list') as HTMLDivElement
    // jsdom 没有 Element.scrollTo,必须打桩,否则点击处理器抛 TypeError
    Object.defineProperty(list, 'scrollTo', { configurable: true, value: vi.fn() })
    scrollListTo(list, 300)

    const btn = screen.getByRole('button', { name: '回到顶部' })

    // hover:提示展开
    fireEvent.mouseEnter(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip).toBeTruthy()
      expect(tip?.classList.contains('ant-tooltip-hidden')).toBe(false)
    })

    // 点击后提示必须收起 —— 与最大化按钮同款受控 open 行为(antd 默认只在 mouseleave 时关闭)
    fireEvent.click(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip === null || tip.classList.contains('ant-tooltip-hidden')).toBe(true)
    })

    // 防「焊死」:移出再悬停必须能再次展开(受控 open 的典型回归)
    fireEvent.mouseLeave(btn)
    fireEvent.mouseEnter(btn)
    await waitFor(() => {
      const tip = document.querySelector('.ant-tooltip')
      expect(tip).toBeTruthy()
      expect(tip?.classList.contains('ant-tooltip-hidden')).toBe(false)
    })
  })
```

- [ ] **步骤 2：运行测试验证失败**

沙箱单文件命令同任务 1 步骤 9；本机：`npm test -- terminalDock`

预期：**第 6 条 FAIL**（hover 后页面上没有任何 `.ant-tooltip`），其余 14 条 PASS。

- [ ] **步骤 3：新增 `tipOpen` 状态（任务 1 步骤 5 的 `showBackTop` 声明旁）**

```tsx
  const [showBackTop, setShowBackTop] = useState(false)
  // 回顶按钮的悬停提示:受控 open(和最大化按钮同款,点击即收不残留)
  const [tipOpen, setTipOpen] = useState(false)
```

- [ ] **步骤 4：按钮包 Tooltip（替换任务 1 步骤 7 的按钮块）**

把：

```tsx
        {showBackTop && (
          <button
            type="button"
            className="app-backtop"
            aria-label="回到顶部"
            onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <VerticalAlignTopOutlined />
          </button>
        )}
```

替换为：

```tsx
        {showBackTop && (
          <Tooltip title="回到顶部" open={tipOpen} onOpenChange={setTipOpen}>
            <button
              type="button"
              className="app-backtop"
              aria-label="回到顶部"
              onClick={() => {
                setTipOpen(false)
                listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              <VerticalAlignTopOutlined />
            </button>
          </Tooltip>
        )}
```

- [ ] **步骤 5：运行测试验证通过**

沙箱单文件命令同任务 1 步骤 9。

预期：`[terminalDock.test] 15/15 通过`。

- [ ] **步骤 6：Typecheck**

运行：`npm run typecheck` → 0 error。

- [ ] **步骤 7：Commit**

```bash
git add src/renderer/src/components/TerminalDock.tsx tests/renderer/terminalDock.test.tsx
git commit -m "feat(terminal): 回顶按钮悬停提示(受控 open,点击即收)"
```

---

## 任务 3：回退验证（证明用例真的抓得住 bug）

**文件：** 无（仅临时回退再恢复）

**交付物**：证据表明三个关键机制被移除时对应用例变红 —— 否则断言可能只是恰好通过（假绿）。

- [ ] **步骤 1：备份当前实现**

```bash
cp src/renderer/src/components/TerminalDock.tsx .workbuddy/verify/backup/TerminalDock.tsx.backtop
md5sum src/renderer/src/components/TerminalDock.tsx
```

- [ ] **步骤 2：回退 A —— 去掉 `onScroll` 一行**

把任务 1 步骤 6 加的 `onScroll={(e) => setShowBackTop(e.currentTarget.scrollTop > BACK_TO_TOP_THRESHOLD)}` 一行删掉。

- [ ] **步骤 3：运行测试，确认变红**

沙箱单文件命令同任务 1 步骤 9。

预期：**5 条 FAIL**（滚动浮现 / 点击回顶 / 回顶收起 / 状态同步 / 提示点击即收）；「顶部时不出现」与既有 9 条 PASS（共 10 绿）。
若**没有变红**：回到任务 1 重写断言。**不得跳过本步。**

- [ ] **步骤 4：从备份恢复并核对**

```bash
cp .workbuddy/verify/backup/TerminalDock.tsx.backtop src/renderer/src/components/TerminalDock.tsx
md5sum src/renderer/src/components/TerminalDock.tsx
```

预期：md5 与步骤 1 记录的完全一致。

- [ ] **步骤 5：回退 B —— 删掉同步 effect**

把任务 1 步骤 5 的 `useEffect(() => { ... }, [sessions.length, maximizedRunId])` 整块删掉。

- [ ] **步骤 6：运行测试，确认变红**

预期：仅「内容变短…状态主动同步」1 条 FAIL（其余 14 条 PASS）—— 证明该用例守的是 effect 本身，而非滚动的顺带效应。

- [ ] **步骤 7：从备份恢复并核对**（命令同步骤 4）

- [ ] **步骤 8：回退 C —— 去掉受控 open**

把任务 2 步骤 4 的 `<Tooltip title="回到顶部" open={tipOpen} onOpenChange={setTipOpen}>` 改回 `<Tooltip title="回到顶部">`，并把 `onClick` 里的 `setTipOpen(false)` 删掉。

- [ ] **步骤 9：运行测试，确认变红**

预期：仅「点击回顶按钮后提示立即收起」1 条 FAIL（waitFor 超时；antd 默认点击不关提示）；其余 14 条 PASS。

- [ ] **步骤 10：从备份恢复 + 最终全绿**

```bash
cp .workbuddy/verify/backup/TerminalDock.tsx.backtop src/renderer/src/components/TerminalDock.tsx
md5sum src/renderer/src/components/TerminalDock.tsx
```

再跑一次沙箱单文件命令。预期：`15/15 通过`。

---

## 任务 4：全量回归 + 记忆 + 汇报

**文件：** 无（仅验证与记录）

**交付物**：确认未破坏既有行为；工作日志留痕；向用户汇报。

- [ ] **步骤 1：沙箱全量回归**

```bash
bash .workbuddy/verify/run-all.sh > .workbuddy/verify/run-all.log 2>&1
grep -E "通过|FAIL|OOM|超时" .workbuddy/verify/run-all.log
```

预期：38 个文件 **487/487 通过**（基线 481 + 新增 6）；无 FAIL / OOM / 超时。若 terminalDock 单文件 OOM，按 describe 切片复核后如实标注。

- [ ] **步骤 2：Typecheck**

运行：`npm run typecheck` → 0 error。

- [ ] **步骤 3：追加工作日志**

在 `.workbuddy/memory/2026-10-12.md` 追加一条：回顶按钮已实现（2 个 commit）、6 条新用例、回退验证结果（A/B/C 各红了哪几条）。（该目录被 gitignore，不提交。）

- [ ] **步骤 4：向用户汇报**

汇报要点：
- 回顶按钮已按规格落地：滚动阈值 200px 浮现、平滑回顶、自动收起、受控提示
- 新增 6 条用例（规格 5 条 + 状态同步 1 条），回退验证 A/B/C 的红色证据
- 沙箱全量 487/487；**提醒用户本机跑 `npm test` 做最终验收**
- commit 清单（2 个 feat + 计划文档）

---

## 自检记录

**1. 规格覆盖度**

| 规格章节 | 对应任务 |
|---|---|
| §3 交互（显隐阈值 / 点击平滑回顶 / 点击后消失 / 位置 14px） | 任务 1 步骤 4-8 |
| §3 边界（空态早返回 / 不可滚 / 最大化 / 内容变短 / 打断走 scroll） | 任务 1 步骤 5（同步 effect）+ 步骤 1 第 5 条用例；空态由既有用例守 |
| §4 视觉（32px / 令牌 / 图标 / aria / focus-visible） | 任务 1 步骤 7-8 |
| §5.1 结构（定位壳 / 常量 / 状态 / onScroll / 受控提示） | 任务 1 步骤 3-7、任务 2 步骤 3-4 |
| §5.2 CSS | 任务 1 步骤 8 |
| §6 测试 1-4 条 | 任务 1 步骤 1 |
| §6 测试第 5 条（提示点击即收） | 任务 2 步骤 1 |
| §6 附加（状态同步用例，规格表未列，已注明） | 任务 1 步骤 1 第 5 条 |
| §8 风险缓解（气泡残留 / 状态脱节 / 阈值集中） | 任务 2（受控）/ 任务 1 步骤 4-5 / 任务 3 |
| §9 验收 1-6 | 任务 1-2 用例 + 任务 3 回退验证 + 任务 4 全量 |

**2. 占位符扫描**：无「待定 / TODO / 后续实现」；每个代码步骤都给了可直接粘贴的完整代码块。

**3. 类型一致性**：`BACK_TO_TOP_THRESHOLD`（number 常量，任务 1 定义与使用）；`listRef`（`RefObject<HTMLDivElement>`）、`showBackTop`/`setShowBackTop`、`tipOpen`/`setTipOpen` 在任务 1/2 一致；测试 helper `backTopButton`/`scrollListTo` 在任务 1 定义、任务 1/2 使用；断言数值（阈值 300 > 200、scrollTo 参数 `{ top: 0, behavior: 'smooth' }`）与实现一致。
