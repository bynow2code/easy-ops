# 终端列表「回到顶部」按钮设计

- **日期**：2026-10-12
- **状态**：设计已获用户批准，待编写实现计划
- **相关**：`src/renderer/src/components/TerminalDock.tsx`、`src/renderer/src/theme/theme.css`、`tests/renderer/terminalDock.test.tsx`

---

## 1. 需求与决策

> 终端列表增加一个快速回到顶部的功能按钮。

现状问题：终端区是单列纵向滚动的卡片列表（卡片固定 340px 高），终端一多、列表很长，滚下去之后想回到顶部只能拖滚动条或一路滚轮。

用户澄清（选择题确认）：

| 决策点 | 用户选择 |
|---|---|
| 按钮呈现方式 | **浮现式浮动按钮**：滚离顶部一定距离后右下角浮现，点击平滑回顶，回到顶部附近自动隐藏 |

已确认的约束：不打扰、跟现有极简风格一致、深浅主题自动适配。

---

## 2. 背景：现状

- 结构（`TerminalDock.tsx`）：`root(flex column)` → 工具条（左「N 个终端」/ 右「关闭全部」）+ 列表容器 `data-testid="terminal-list"`（`overflow: auto`、单列网格、`gridAutoRows: 340px`）→ 卡片（卡片头 + TerminalView）。
- 项目内目前没有任何「回到顶部」相关实现，也未使用 antd `FloatButton`。
- 最大化模式：卡片 `height: 100%` 撑满、列表不产生滚动 → 按钮天然不出现。

---

## 3. 交互设计

| 项 | 规则 |
|---|---|
| 显隐 | `terminal-list` 的 `scrollTop > 200`（常量 `BACK_TO_TOP_THRESHOLD`，约大半张卡片高）时浮现；否则隐藏 |
| 点击 | 平滑滚回顶部：`list.scrollTo({ top: 0, behavior: 'smooth' })` |
| 点击后 | 滚动跨过阈值时按钮自行消失；提示气泡随按钮卸载，不残留 |
| 位置 | 列表区域右下角，距右/下边缘各 14px |

边界行为：

| 场景 | 行为 |
|---|---|
| 无终端（空态） | 无按钮（空态分支本就早返回） |
| 终端少、列表不可滚 | `scrollTop` 恒 0 → 不出现 |
| 最大化模式 | 列表不可滚 → 不出现 |
| 关闭终端 / 切换最大化导致内容变短 | 浏览器会把 `scrollTop` 夹回；在会话数或最大化态变化时**主动同步一次状态**（见 §5），不赌浏览器是否补发 `scroll` 事件 |
| 平滑滚动途中滚轮打断 | 打断后按真实滚动位置重新判定（统一走 scroll 事件） |

---

## 4. 视觉设计

- 32px 圆钮，绝对定位浮在列表右下角（原生 `<button>` 自绘，非 antd 组件）。
- 配色全部走现有令牌，深浅主题自动适配：底 `--color-bg-container`、描边 `--app-hairline-strong`、投影 `--app-shadow-panel`、图标 `--color-text-secondary` → 悬停加深。
- 图标 `VerticalAlignTopOutlined`（置顶语义）；悬停提示「回到顶部」；`aria-label="回到顶部"`。
- 键盘可达：`focus-visible` 时显示主色轮廓。

---

## 5. 实现方案

### 5.1 结构（`TerminalDock.tsx`）

列表外包一层「定位壳」，列表自身两个分支（普通 / 最大化）的样式一行不动；按钮与列表同壳、条件渲染：

```tsx
<div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
  <div ref={listRef} data-testid="terminal-list" onScroll={/* 见下 */} style={/* 原样式不变 */}>
    {cards}
  </div>
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
</div>
```

新增常量 / 状态 / 引用（**必须声明在空态早返回之前**，与现有 Hook 同区，遵守 hooks 规则）：

```tsx
const BACK_TO_TOP_THRESHOLD = 200   // 文件顶部，与 CARD_HEIGHT 相邻

const listRef = useRef<HTMLDivElement>(null)
const [showBackTop, setShowBackTop] = useState(false)
const [tipOpen, setTipOpen] = useState(false)

// 会话数 / 最大化态变化都会让浏览器夹回滚动位置(内容变短),
// 这里主动同步一次,不依赖「浏览器是否补发 scroll 事件」
useEffect(() => {
  const el = listRef.current
  if (el) setShowBackTop(el.scrollTop > BACK_TO_TOP_THRESHOLD)
}, [sessions.length, maximizedRunId])
```

- `onScroll`：`(e) => setShowBackTop(e.currentTarget.scrollTop > BACK_TO_TOP_THRESHOLD)`（同值时 React 对相同 state 跳过更新，无额外开销）。
- 提示气泡沿用卡片最大化按钮的**受控 open** 模式：点击即收、鼠标仍停着也不残留；移出再悬停可再次展开。

**不采用 antd `FloatButton.BackTop`**：显隐阈值与样式都要反向压制组件默认值；手写约二三十行，更贴合全项目「手写样式 + 设计令牌」的惯例。

### 5.2 样式（`theme.css` 末尾新增小节）

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

import 变更：`react` 增加 `useEffect`；`@ant-design/icons` 增加 `VerticalAlignTopOutlined`。

---

## 6. 测试设计

新增 `describe('回到顶部按钮')`（`tests/renderer/terminalDock.test.tsx`，沿用现有 mock 与 setup）：

1. **顶部时不出现**：初始 `scrollTop=0` → `queryByRole('button', { name: '回到顶部' })` 为 null。
2. **滚动超过阈值后浮现**：jsdom 无布局与真实滚动，`scrollTop` 用替身 —— `Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 300 })` + `fireEvent.scroll(list)` → 按钮出现。
3. **点击触发回顶**：`scrollTo` 打桩记录参数 → 断言以 `{ top: 0, behavior: 'smooth' }` 调用。
4. **回到顶部后收起**：`scrollTop` 置 0 + `fireEvent.scroll` → 按钮消失。
5. **点击后提示立即收起**：hover → 气泡展开；click → 气泡收起（鼠标仍停着）；移出再悬停能再次展开（防受控 open「焊死」，与最大化按钮同款断言）。

既有用例不受影响：它们不涉及滚动状态；且 `terminal-list` 的子节点仍是卡片（定位壳包在列表外层，列表元素本身不变）。

---

## 7. 不做的事（YAGNI）

- 不做「滚到底部」按钮。
- 不改终端内容（xterm）自身的滚动条与回看。
- 不加键盘快捷键。
- README 不加功能条目（用户确认默认不动）。
- 不动左侧脚本列表（本次只针对终端列表）。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 提示气泡点完残留（老问题的新形态） | 受控 open + 用例 5 |
| 关闭终端 / 切最大化后按钮状态与真实滚动位置脱节 | §5.1 的同步 effect（依赖会话数与最大化态） |
| 阈值 200px 手感不合适 | 常量集中一处，调整只动 `BACK_TO_TOP_THRESHOLD` |
| 定位壳改动波及既有测试 | 列表元素与子节点结构不变；跑全量用例确认 |

---

## 9. 验收标准

1. 列表滚离顶部超过约 200px：右下角浮现圆钮；滚回阈值以内自动消失。
2. 点击后平滑滚回顶部；提示气泡点击即收、不残留、可再次悬停展开。
3. 深浅主题自动适配（无任何写死颜色）。
4. 空态 / 终端少 / 最大化模式：按钮不出现。
5. `npm run typecheck` 通过；新增 5 条用例 + 既有用例全绿（最终以用户本机 `npm test` 为准）。
6. 回退验证：临时回退实现（如去掉 `onScroll`）→ 对应用例变红，恢复后全绿。
