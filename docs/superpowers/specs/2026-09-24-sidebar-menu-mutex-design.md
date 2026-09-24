# 侧栏菜单互斥设计（点菜单以外的地方都要关闭）

日期：2026-09-24
状态：设计已获用户批准，待编写实现计划
相关：`src/renderer/src/components/Sidebar.tsx`

---

## 1. 需求

> 右键出现的菜单，点击菜单以外的地方都要将菜单关闭。

用户澄清后的三条边界（均以选择题确认）：

| # | 问题 | 用户选择 |
|---|---|---|
| 1 | 严格互斥（同一时刻最多一个菜单，点 ⋯ 会立刻关掉右键菜单）？ | **要，严格互斥** |
| 2 | 覆盖范围 | **四个 Dropdown 全覆盖** |
| 3 | 菜单开着时再点同一 ⋯ 按钮是否 toggle 关闭 | **应该 toggle** |

---

## 2. 背景：现状与根因

### 2.1 现状

侧栏共 4 个 Dropdown（`Sidebar.tsx`）：

| 行号 | 元素 | `trigger` | 受控状态 |
|---|---|---|---|
| 700 | 脚本行整行（右键） | `['contextMenu']` | 受控 `open={ctxMenuId === script.id}` |
| 825 | 脚本行行尾 ⋯ | `['click']` | 非受控 |
| 904 | 分组行行尾 ⋯ | `['click']` | 非受控 |
| 944 | 分组头整行（右键） | `['contextMenu']` | 非受控 |

### 2.2 根因（rc-trigger 源码级）

「点击外部关闭」在 antd 里只有**一条**实现路径 —— `useWinClick`：

```js
// @rc-component/trigger/es/hooks/useWinClick.js
if (clickToHide && popupEle && (!mask || maskClosable)) {
  var onTriggerClose = function (e) {
    if (openRef.current && !inPopupOrChild(e.composedPath?.()[0] || e.target)
        && !popupPointerDownRef.current) {
      triggerOpen(false)
    }
  }
  win.addEventListener('mousedown',   onTriggerClose, true)
  win.addEventListener('contextmenu', onTriggerClose, true)
```

`clickToHide` 的推导（`index.js:248` + `hooks/useAction.js`）：

```js
clickToHide = hideActions.has('click') || hideActions.has('contextMenu')
mergedHideAction = hideAction ?? action      // antd 只传 action = trigger
```

⇒ 四种 `trigger` 下 `clickToHide` **恒为 true**，即「点外部关闭」这条路径**本来就在工作**。

真正的缺口在 `inPopupOrChild`（`index.js:140-146`）这个**排除条件** —— 它为真时**不关闭**：

```js
childDOM.contains(ele)                          // 点击落在 trigger 自己的 children 子树内
|| ele === childDOM
|| popupEle.contains(ele)                       // 点击落在本菜单浮层内
|| subPopupElements 某项包含 ele                // 点击落在子菜单浮层内
```

由此产生两个缺口：

- **缺口 A：同一行二次右键不关。**
  菜单开着时再对同一行右键 → `contextmenu` 被 `useWinClick` 捕获，target 就在该行 `childDOM` 子树内 → 判为「内部」→ 不关闭；随后 trigger 自身的 `onContextMenu` 又 `triggerOpen(true)`（已 open，等于无操作）→ 菜单黏住不动。
  *（对**另一行**右键会正常关闭 —— 目标不在 `childDOM` 内。）*

- **缺口 B：浮层互不感知。**
  每个 Dropdown 只把**自己的** `popupEle` 与 `subPopupElements` 视为「内部」，**不会**把别的 antd 浮层视为内部。因此 A 菜单开着时点开 B 菜单，A 不会被 B 的开合联动关闭。

### 2.3 需要显式说明的一点

**「点 body / 点详情区 / 点顶栏」这类场景本就能关闭**（`useWinClick` 工作正常）。
本次改动**不**去动这条路径 —— 只补缺口 A、B。若实现中发现某场景不关，应作为新的缺口单独调查，而不是在互斥逻辑里加大范围猜测。

---

## 3. 设计

### 3.1 数据模型：单一 `openMenuKey` 取代 `ctxMenuId`

```ts
/** 当前开着的菜单。null = 全关。同一时刻最多一个 —— 这就是「互斥」的实现。 */
const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
```

key 命名（前缀区分四类，必须能唯一标识哪个 Dropdown）：

| Dropdown | key |
|---|---|
| 脚本行右键 | `ctx:script:${script.id}` |
| 脚本行 ⋯ | `more:script:${script.id}` |
| 分组行右键 | `ctx:group:${group.id}` |
| 分组行 ⋯ | `more:group:${group.id}` |

**为何用单个字符串 key 而非两个 state（如 `openMenuId` + `openMenuKind`）**：单 key 让「互斥」退化成**一次 setState**；两个 state 会引入「两者不同步」的新状态空间。这是把状态空间压小的选择。

### 3.2 四个 Dropdown 的统一改造形态

```tsx
const myKey = `ctx:script:${script.id}`

<Dropdown
  trigger={['contextMenu']}
  open={openMenuKey === myKey}
  onOpenChange={(open) => {
    if (!open) {
      // 只有「开着的确实是我」才清空 —— 防止别的菜单打开导致我被动关闭时，
      // 把我的新 key 一起清掉（这是本设计最容易写错的地方）。
      setOpenMenuKey((prev) => (prev === myKey ? null : prev))
      return
    }
    setOpenMenuKey(myKey)
    /* 各 Dropdown 的「打开」副作用（见 3.3） */
  }}
  ...
```

**关闭分支的 `prev === myKey` 守卫是必需的**：antd 在「另一个菜单打开导致我被动关闭」时**也会**回调本 Dropdown 的 `onOpenChange(false)`。无守卫会把我刚设的新 key 清掉，导致两个菜单都关。**任何实现都不得省略该守卫。**

### 3.3 各 Dropdown 的差异（不能一刀切）

- **脚本行右键**：`onOpenChange` 的「打开」分支**保留现有右侧预选语义**（`inSelection` 与 `validSelected.length <= 1` 的判定、清多选、置 anchor、`selectScript`）—— 这段逻辑一行不动，只把 `setCtxMenuId(open ? script.id : null)` 替换为 3.2 的 key 逻辑。
  - 现有注释中「内层 ⋯ 打开时我们也会 setCtxMenuId(null) 触发一次本回调，但那条路径 open 为 false，在这里直接 return」的说明仍然成立，需同步更新为「由互斥统一接管」。
- **脚本行 ⋯**：现有的 `if (open && ctxMenuId === script.id) setCtxMenuId(null)` **删除** —— 它手动关外层右键菜单的职责由互斥自动接管。**净减少代码。**
- **分组行 ⋯**：新增受控，无其它副作用。
- **分组行右键**：新增受控。`trigger` 仍为 `['contextMenu']`，故 antd 推导的 `alignPoint`（跟随鼠标）**不受影响** —— `alignPoint` 只看 `trigger`，与受控无关。

### 3.4 数据流

```
点任意处
  → antd 内部 useWinClick（外部点击）/ onContextMenu（右键）/ onMenuClick（点菜单项）
  → 该 Dropdown 的 onOpenChange(open) 回调
  → setOpenMenuKey(key)（打开） 或  setOpenMenuKey(prev => prev === key ? null : prev)（关闭）
  → 四个 Dropdown 重新求值 open={openMenuKey === myKey}
  → 互斥自动成立，无需任何「手写关闭别的菜单」的代码
```

### 3.5 语义总表（期望行为）

| 场景 | 期望可见菜单数 |
|---|---|
| 右键 A 行 → 点 body / 详情区 / 顶栏 | 0 |
| 右键 A 行 → 再右键 A 行（缺口 A） | **≤ 1** |
| 右键 A 行 → 再右键 B 行 | 1（只剩 B 的） |
| 右键 A 行 → 点 A 行 ⋯ | 1（只剩 ⋯ 的；互斥生效，右键菜单被关） |
| ⋯ 菜单开着 → 点 ⋯ 自身（toggle） | 0 |
| 右键 A 行 → 点菜单项 | 0 |
| 菜单开着 → 按 Esc | 0 |
| 菜单开着 → 点菜单浮层**内部**（含分隔/空白区） | 仍 1（**不得**因「点内部」而关闭） |

**关于「同一行二次右键」的期望，定为「≤ 1」而不是写死 0 或 1**：两种收敛结果都满足用户诉求（菜单被关闭 / 或被重新打开而非黏住），且都优于现状的「黏住不动」。写死任一具体值都会把测试绑到 antd 内部实现的偶然细节上。断言只需排除「2 个菜单」与「菜单不响应」。

---

## 4. 测试设计

新增 `describe('菜单互斥')`（建议放 `tests/renderer/sidebarMultiSelect.test.tsx`，因其已有 `visibleDropdownCount()` / `openContextMenuAndReadItems()` helper）：

1. ⋯ 菜单开着 → 右键另一行 → 可见菜单 1 个，且内容为右键菜单项
2. 右键开着 → 点另一行 ⋯ → 可见菜单 1 个，且内容为 ⋯ 菜单项
3. **缺口 A 回归**：右键 A 行 → 再右键 A 行 → 可见菜单 **≤ 1**（不出现 2 个，即菜单不再「黏住」）
4. 右键 A 行 → `mousedown` body → 0 个（守既有路径不被改坏）
5. ⋯ 开着 → 点 ⋯ 自身 → 0 个（toggle 语义）
6. **反向防线**：点菜单**内部**的元素（如菜单项上的 pointerdown）→ 菜单**不得**因此关闭（防修过头）

**注（用例 1 的「内容」断言）**：判「剩下的是哪一个菜单」用**菜单项文案**区分（右键菜单与 ⋯ 菜单项文案不同），不要用 className 或位置 —— 项目已有教训「class 名不是行为的证据」。分组行与脚本行的菜单项文案也不同，足以区分。

**注（用例 4 与用例 6 为什么都要有）**：4 守「该关的关」（点外部），6 守「不该关的不关」（点内部）。只有 4 会允许「一刀切全关」的过度实现；只有 6 会允许「点外部不关」的现状。两者互为对照。

**必须同步修改的既有用例**：

`tests/renderer/sidebarMultiSelect.test.tsx:325`「右键菜单开着时点行尾 ⋯ 的菜单项,右键菜单必须一起关闭」——

其第 2 步断言 `document.querySelectorAll('.ant-dropdown').length > 1`（**两个菜单共存**），在严格互斥下不再成立。

- 改法：把「共存」断言改为「右键菜单已被互斥关闭，可见菜单 1 个」。
- **保留**它原本要守的核心：点内层菜单项后归 0（第 4 步）。
- **必须注明这是规格反转**（按项目约定：既有用例遇到需求反转，改断言并注明原因，不静默删除）。

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `ctxMenuId` 是上一轮 bug（11d957f）的修复载体，动它有回归风险 | `openMenuKey` 的 `ctx:script:*` 分支语义**严格包含** `ctxMenuId`；且 `点行尾 ⋯ 不会改变多选选区` 用例继续锁住 ⋯ 的 `stopPropagation` 防线 |
| 关闭分支缺守卫 → 两菜单同时被关 | 3.2 已把守卫列为强制；新增用例 1/2 可捕获此错误 |
| 分组行右键改受控后丢失「跟随鼠标」 | `alignPoint` 只由 `trigger` 推导，受控不影响；用例 1 应同时断言菜单位置或至少断言 trigger 未变 |
| 误修过头：点菜单内部也被关 | 反向防线用例 6 |
| 递归树中 key 未带 id → 所有行菜单同开 | key 必须含具体 id（`ctx:script:${id}`），这是既有 `ctxMenuId` 注释已记录的教训 |

---

## 6. 提交前自检清单

- [ ] 四个 Dropdown 全部改为受控 `open={openMenuKey === myKey}`
- [ ] 关闭分支均带 `prev === myKey` 守卫
- [ ] `ctxMenuId` 状态及其所有引用**已彻底移除**（`grep -c ctxMenuId` = 0），不留两套真相
- [ ] 脚本行右键的预选语义未变（既有用例全绿）
- [ ] 删除了脚本行 ⋯ 里手动 `setCtxMenuId(null)` 的代码
- [ ] 新增 6 条用例，含 1 条反向防线
- [ ] 既有 `sidebarMultiSelect.test.tsx:325` 已按规格反转修改并注明
- [ ] 回退验证：临时回退修复 → 新用例变红 → 恢复 → md5 一致
- [ ] `npm run typecheck` 双侧 0 错
- [ ] 用户本机 `npm test`（沙箱无法全量跑）
