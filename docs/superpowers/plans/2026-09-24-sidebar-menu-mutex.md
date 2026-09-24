# 侧栏菜单互斥实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 侧栏四个 Dropdown（脚本行/分组行的右键与 ⋯）改为全局互斥 —— 同一时刻最多一个菜单打开，「点菜单以外的地方」都会关闭它。

**架构：** 用一个 `openMenuKey: string | null` 取代现有 `ctxMenuId`，四个 Dropdown 全部改为受控 `open={openMenuKey === myKey}`。互斥由此**自动成立** —— 任何菜单打开都把 key 设成自己，其余 Dropdown 求值即为 false 而关闭。不手写任何「关闭别的菜单」的代码。

**技术栈：** React 18 + antd 5（Dropdown）+ zustand + vitest/@testing-library/react

**规格来源：** `docs/superpowers/specs/2026-09-24-sidebar-menu-mutex-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/renderer/src/components/Sidebar.tsx` | 侧栏组件；4 个 Dropdown 与 `openMenuKey` 状态 | 修改 |
| `tests/renderer/sidebarMultiSelect.test.tsx` | 菜单/多选行为测试；已有 `visibleDropdownCount()` 等 helper | 修改（新增 6 条 + 改 1 条既有） |

**为什么只改这两个文件**：互斥是纯 UI 开合状态，不涉及 store、主进程或持久化。`Sidebar.tsx` 已 1000+ 行，但本次改动是**替换一个 state + 4 个调用点**，不拆分文件（拆分会让这次 diff 与重构纠缠，违反「不做顺便改改」）。

---

## 关键背景（实现前必读）

### 1. antd 的「点外部关闭」本就在工作

`@rc-component/trigger/es/hooks/useWinClick.js` 是**唯一**的外部点击关闭路径，其门控 `clickToHide` 对四种 trigger 恒为 `true`（推导见规格 §2.2）。所以 **「点 body / 详情区 / 顶栏」不需要本次改动处理**。

### 2. 要补的两个缺口

- **缺口 A**：同一行二次右键不关 —— `useWinClick` 判 `inPopupOrChild(target)`，同一行的行元素在 `childDOM` 子树内 → 判为「内部」→ 不关。
- **缺口 B**：浮层互不感知 —— 每个 Dropdown 只认自己的 `popupEle`/`subPopupElements`。

### 3. 最容易写错的地方：关闭分支的守卫

antd 在「**另一个**菜单打开导致我被动关闭」时，**也会**回调本 Dropdown 的 `onOpenChange(false)`。若不判断「开着的确实是我」，就会把刚设的新 key 一起清掉 → 两个菜单全关。

**正确形态（四个 Dropdown 一致）：**

```tsx
setOpenMenuKey((prev) => (prev === myKey ? null : prev))
```

### 4. key 命名（必须含具体 id）

| Dropdown | key |
|---|---|
| 脚本行右键 | `ctx:script:${script.id}` |
| 脚本行 ⋯ | `more:script:${script.id}` |
| 分组行右键 | `ctx:group:${group.id}` |
| 分组行 ⋯ | `more:group:${group.id}` |

树是递归渲染的，**key 不含 id 会让所有行的菜单同时开**（既有 `ctxMenuId` 注释已记录此教训）。

---

## 沙箱测试限制（本仓库已知）

本环境 `ulimit -v` 被硬钳在 4GB，`vitest` 会因 undici 的 wasm `WebAssembly.instantiate OOM`。两种跑法：

1. **用户本机**：直接 `npm test`（推荐，最终验收以此为准）。
2. **本沙箱**：用 `.workbuddy/verify/build-and-run.sh <测试文件>` 打包 + `node .workbuddy/verify/drive.mjs ./<bundle>` 跑。**每个进程最多约 3 个用例**，需按 `describe` 切片（用花括号配平切，不要按行号硬切，否则会切掉块内 helper 而报 `setupXxx is not defined`）。

计划中的「运行测试」步骤给出**两种命令**，按所处环境选择。

---

## 任务 1：引入 `openMenuKey` 并改造脚本行两个 Dropdown

**文件：**
- 修改：`src/renderer/src/components/Sidebar.tsx`（状态声明 `:219-235`；脚本行右键 `:700-723`；脚本行 ⋯ `:825-832`）
- 测试：`tests/renderer/sidebarMultiSelect.test.tsx`

**交付物**：脚本行的右键菜单与 ⋯ 菜单互斥；`ctxMenuId` 对此行不再存在。

- [ ] **步骤 1：编写失败的测试（缺口 B —— 两个菜单互斥）**

在 `tests/renderer/sidebarMultiSelect.test.tsx` 文件末尾（最后一个 `describe` 之后）追加：

```tsx
  /**
   * 菜单互斥(2026-09-24 用户定稿:「右键出现的菜单,点击菜单以外的地方都要将菜单关闭」)。
   *
   * antd 自身的「点外部关闭」(useWinClick)只认**自己的**浮层为内部,
   * 因此两个浮层会互不感知 —— 一个开着时打开另一个,前者不关(缺口 B);
   * 且同一行二次右键时 target 落在 childDOM 内被判「内部」,菜单会黏住(缺口 A)。
   *
   * 方案:四个 Dropdown 共用一个 openMenuKey,同一时刻最多一个菜单。
   */
  describe('菜单互斥', () => {
    it('右键菜单开着时打开另一行的 ⋯ 菜单,右键菜单必须关闭(缺口 B)', async () => {
      renderSidebar()

      // 1. 右键脚本A1,等右键菜单出现
      await openContextMenuAndReadItems(scriptRow('脚本A1'))
      expect(visibleDropdownCount()).toBe(1)

      // 2. 点**另一行**的 ⋯
      fireEvent.click(scriptRow('脚本A2').querySelector('button[aria-label="更多操作"]') as HTMLElement)

      // 3. 互斥:右键菜单被关,恰好只剩 1 个
      //    为什么不断言「剩下的是哪一个菜单」:脚本行**单条**右键菜单的 items
      //    就是同一个 scriptMenuItems 数组(['复制','删除']),与 ⋯ 菜单逐字相同
      //    (Sidebar.tsx:736 `: scriptMenuItems`)。文案无法区分,而 className/位置
      //    按项目教训也不可作为行为证据。故本用例只断言**数量收敛为 1**
      //    —— 这就足以证明「右键菜单被关掉了一个」,因为改动前这里是 2。
      await waitFor(() => expect(visibleDropdownCount()).toBe(1))
    })

    it('⋯ 菜单开着时右键某行,⋯ 菜单必须关闭(缺口 B 反向)', async () => {
      renderSidebar()

      fireEvent.click(scriptRow('脚本A1').querySelector('button[aria-label="更多操作"]') as HTMLElement)
      await waitFor(() => expect(visibleDropdownCount()).toBe(1))

      await openContextMenuAndReadItems(scriptRow('脚本A2'))

      // 同上:两个菜单文案相同,只断言数量收敛(改动前为 2)
      await waitFor(() => expect(visibleDropdownCount()).toBe(1))
    })

    it('同一行二次右键,菜单不黏住(缺口 A 回归)', async () => {
      renderSidebar()
      const row = scriptRow('脚本A1')

      await openContextMenuAndReadItems(row)
      expect(visibleDropdownCount()).toBe(1)

      // 再对同一行右键:现状会残留/黏住。修好后收敛为「≤1」(关掉或重开同一菜单都对,
      // 故不写死 0 或 1 —— 写死会把测试绑到 antd 内部实现的偶然细节上)。
      fireEvent.contextMenu(row)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 80))
      })
      expect(visibleDropdownCount()).toBeLessThanOrEqual(1)
    })

    it('点菜单外部(body)必须关闭菜单', async () => {
      renderSidebar()

      await openContextMenuAndReadItems(scriptRow('脚本A1'))
      expect(visibleDropdownCount()).toBe(1)

      fireEvent.mouseDown(document.body)
      await waitFor(() => expect(visibleDropdownCount()).toBe(0))
    })

    it('菜单开着时再点同一个 ⋯ 按钮,应 toggle 关闭', async () => {
      renderSidebar()
      const more = scriptRow('脚本A1').querySelector('button[aria-label="更多操作"]') as HTMLElement

      fireEvent.click(more)
      await waitFor(() => expect(visibleDropdownCount()).toBe(1))

      fireEvent.click(more)
      await waitFor(() => expect(visibleDropdownCount()).toBe(0))
    })

    it('点菜单内部的菜单项,不得因「点内部」而误关(反向防线,防修过头)', async () => {
      renderSidebar()

      await openContextMenuAndReadItems(scriptRow('脚本A1'))

      // 对菜单项自身派发 pointerdown/mousedown —— 这属于「菜单内部」,
      // 不得触发关闭(点菜单项后的关闭由 onMenuClick 负责,不是本次要改的路径)。
      const item = [...document.querySelectorAll('.ant-dropdown')]
        .filter((el) => !el.classList.contains('ant-dropdown-hidden'))[0]
        .querySelector('.ant-dropdown-menu-item') as HTMLElement
      expect(item).toBeTruthy()

      fireEvent.pointerDown(item)
      fireEvent.mouseDown(item)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60))
      })

      // 仍然开着(未被「点内部」误关)
      expect(visibleDropdownCount()).toBe(1)
    })
  })
```

- [ ] **步骤 2：运行测试验证失败**

本机：`npm test -- sidebarMultiSelect`
沙箱：`bash .workbuddy/verify/build-and-run.sh tests/renderer/sidebarMultiSelect.test.tsx`

预期：**至少 3 条 FAIL**（缺口 B 两条 + 缺口 A 一条），报错形如 `expected 2 to be 1` / `expected 2 to be less than or equal to 1`；「点 body 关闭」「toggle」「反向防线」三条应已 PASS（现实现本就正确）。

- [ ] **步骤 3：改造状态声明**

`Sidebar.tsx:219-235`，把 `ctxMenuId` 整块换成 `openMenuKey`：

```tsx
  /**
   * 当前开着的菜单 key;null = 全关。**同一时刻最多一个** —— 「互斥」就是对它的唯一约束。
   *
   * 为什么是单个字符串 key 而不是「id + 类型」两个 state:单 key 让互斥退化成一次
   * setState,而两个 state 会引入「两者不同步」的新状态空间。这是把状态空间压小的选择。
   *
   * 为什么 key 必须含具体 id:树是递归渲染的,不含 id 会让**所有行**的菜单同时开。
   *
   * 为什么受控(背景 bug 2026-09-24 用户反馈「点菜单以外的地方都要关闭」):
   * antd 的「点外部关闭」只有 useWinClick 一条路径,且它只把**自己的**浮层当「内部」,
   * 于是有两个缺口 ——
   *   ① 同一行二次右键不关:target 落在 trigger 的 children 子树内,被判「内部」;
   *   ② 浮层互不感知:菜单 A 开着时打开菜单 B,A 不关。
   * 四个 Dropdown 共用一个 key 后,任一菜单打开就把 key 设成自己,
   * 其余 Dropdown 求值 open 为 false 而关闭 —— 互斥自动成立,无需手写关闭逻辑。
   *
   * ⚠️ 每个 onOpenChange 的**关闭分支必须带 `prev === myKey` 守卫**:
   * antd 在「另一个菜单打开导致我被动关闭」时也会回调本 Dropdown(open=false),
   * 少了守卫就会把刚设的新 key 一起清掉,导致两个菜单全关。
   */
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
```

- [ ] **步骤 4：改造脚本行右键 Dropdown**

`Sidebar.tsx:700-723`，把 `open` / `onOpenChange` 两块替换为：

```tsx
      <Dropdown
        key={script.id}
        trigger={['contextMenu']}
        open={openMenuKey === `ctx:script:${script.id}`}
        onOpenChange={(open) => {
          const myKey = `ctx:script:${script.id}`
          if (!open) {
            // 守卫:只有「开着的确实是我」才清空,否则会把别的菜单的新 key 清掉
            setOpenMenuKey((prev) => (prev === myKey ? null : prev))
            return
          }
          setOpenMenuKey(myKey)
          // 预选语义:右键「不在多选选区里」的行 = 先单选它(清掉多选),菜单按单条展示;
          // 右键已在选区里的行 = 不动选区,菜单按整个选区展示(文件管理器同款)。
          // 判定用 inSelection 而非 selected:后者含详情选中行,Ctrl 把某行移出选区后
          // 它仍因 selectedScriptId 高亮,此时右键会误清掉整个选区(审查 I1)。
          // 有效选区只剩 1 个(其余是脏 id)时同样降级单条,避免「删除 1 个脚本」的伪批量。
          if (!inSelection || validSelected.length <= 1) {
            setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
            selectionClearedRef.current = false
            setAnchorId(script.id)
            selectScript(script.id)
          }
        }}
        menu={{
```

> **注意**：`open` 的表达式里直接内联模板串是有意的 —— 不引入局部变量，避免在 `renderScript` 的每次递归里多一次声明。`onOpenChange` 内部才需要 `myKey`（用两次）。

- [ ] **步骤 5：改造脚本行 ⋯ Dropdown（删除手动的关闭逻辑）**

`Sidebar.tsx:825-832`，替换为：

```tsx
            <Dropdown
              trigger={['click']}
              open={openMenuKey === `more:script:${script.id}`}
              onOpenChange={(open) => {
                const myKey = `more:script:${script.id}`
                // 关闭分支同样带守卫。旧实现在这里手动 setCtxMenuId(null) 去关同行的右键菜单
                // (bug 2026-09-24),互斥接管后该逻辑已不需要 —— 打开 ⋯ 时 key 变成自己,
                // 同行的右键菜单自然关闭。
                setOpenMenuKey((prev) => (open ? myKey : prev === myKey ? null : prev))
              }}
              menu={{
```

- [ ] **步骤 6：确认 `ctxMenuId` 已无残留**

运行：`grep -n ctxMenuId src/renderer/src/components/Sidebar.tsx`
预期：**无输出**（若仍有输出，说明还有未改造的引用，回到步骤 3-5）。

- [ ] **步骤 7：运行测试验证通过**

本机：`npm test -- sidebarMultiSelect`
沙箱：`bash .workbuddy/verify/build-and-run.sh tests/renderer/sidebarMultiSelect.test.tsx`，再按 describe 切片跑（每进程 ≤3 用例）

预期：新增 6 条**全部 PASS**。

- [ ] **步骤 8：Typecheck**

运行：`npm run typecheck`
预期：`typecheck:node` 与 `typecheck:web` 均 0 error，退出码 0。

- [ ] **步骤 9：Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx tests/renderer/sidebarMultiSelect.test.tsx
git commit -m "feat(sidebar): 脚本行菜单互斥(右键与 ⋯ 同一时刻只开一个)"
```

---

## 任务 2：分组行两个 Dropdown 纳入互斥

**文件：**
- 修改：`src/renderer/src/components/Sidebar.tsx`（分组行 ⋯ `:904-916`；分组头右键 `:944-952`）
- 测试：`tests/renderer/sidebarMultiSelect.test.tsx`

**交付物**：四个 Dropdown 全部纳入互斥；跨「脚本行 ↔ 分组行」也互斥。

- [ ] **步骤 1：编写失败的测试（跨行类型互斥）**

在任务 1 的 `describe('菜单互斥')` 内追加：

```tsx
    it('脚本行 ⋯ 菜单开着时右键分组行,⋯ 菜单必须关闭(跨行类型互斥)', async () => {
      renderSidebar()

      fireEvent.click(scriptRow('脚本A1').querySelector('button[aria-label="更多操作"]') as HTMLElement)
      await waitFor(() => expect(visibleDropdownCount()).toBe(1))

      // 右键分组头:⋯ 菜单(分组行)应被关掉
      // 这里**可以**断文案:分组行 ⋯ 菜单是 groupMenuItems(['新建子分组','重命名','删除分组']),
      // 脚本行右键菜单是 scriptMenuItems(['复制','删除']) —— 两者不重叠,可区分。
      // (对比:脚本行 ⋯ 与脚本行右键文案相同,那两条用例只能断言数量。)
      await openContextMenuAndReadItems(groupHead('目录A'))

      await waitFor(() => expect(visibleDropdownCount()).toBe(1))
      const panel = [...document.querySelectorAll('.ant-dropdown')].filter(
        (el) => !el.classList.contains('ant-dropdown-hidden')
      )[0] as HTMLElement
      const labels = [...panel.querySelectorAll('.ant-dropdown-menu-title-content')].map((e) => e.textContent)
      // 剩下的是**分组**右键菜单(内容 = groupMenuItems),足以说明 ⋯ 菜单确实被关掉了
      expect(labels).toEqual(['新建子分组', '重命名', '删除分组'])
    })

    it('分组行 ⋯ 菜单开着时右键脚本行,分组菜单必须关闭', async () => {
      renderSidebar()

      const groupMore = groupHead('目录A').querySelector('button[aria-label="分组操作"]') as HTMLElement
      fireEvent.click(groupMore)
      await waitFor(() => expect(visibleDropdownCount()).toBe(1))

      await openContextMenuAndReadItems(scriptRow('脚本A1'))

      // 只剩脚本行右键菜单(文案与分组菜单不重叠,可精确断言)
      await waitFor(() => expect(visibleDropdownCount()).toBe(1))
      const panel = [...document.querySelectorAll('.ant-dropdown')].filter(
        (el) => !el.classList.contains('ant-dropdown-hidden')
      )[0] as HTMLElement
      const labels = [...panel.querySelectorAll('.ant-dropdown-menu-title-content')].map((e) => e.textContent)
      expect(labels).toEqual(['复制', '删除'])
    })
```

- [ ] **步骤 2：运行测试验证失败**

本机：`npm test -- sidebarMultiSelect`
沙箱：`bash .workbuddy/verify/build-and-run.sh tests/renderer/sidebarMultiSelect.test.tsx`

预期：**2 条 FAIL**，报错形如 `expected 2 to be 1`（分组行尚未受控，两个菜单并存）。

- [ ] **步骤 3：改造分组行 ⋯ Dropdown**

`Sidebar.tsx:904-916`，替换为：

```tsx
      <Dropdown
        trigger={['click']}
        open={openMenuKey === `more:group:${group.id}`}
        onOpenChange={(open) => {
          const myKey = `more:group:${group.id}`
          setOpenMenuKey((prev) => (open ? myKey : prev === myKey ? null : prev))
        }}
        menu={{
          items: groupMenuItems,
          // 菜单浮层挂在 body 上,stopPropagation 防止点击冒泡误触分组头的折叠
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation()
            handleGroupMenuClick(group, key)
          }
        }}
      >
```

- [ ] **步骤 4：改造分组头右键 Dropdown**

`Sidebar.tsx:944-952`，把开头两行替换为：

```tsx
        <Dropdown
          trigger={['contextMenu']}
          open={openMenuKey === `ctx:group:${key}`}
          onOpenChange={(open) => {
            const myKey = `ctx:group:${key}`
            // 关闭分支带守卫(同脚本行)。分组行右键无预选语义 —— 分组不参与多选。
            setOpenMenuKey((prev) => (open ? myKey : prev === myKey ? null : prev))
          }}
          menu={{
            items: groupMenuItems,
```

> **注意**：此处用 `key`（`renderGroupNode` 顶部的 `const key = node.group.id` 局部变量，见 `:921`），不是 `node.group.id` —— 两者等值，用 `key` 与文件其他地方一致。

- [ ] **步骤 5：运行测试验证通过**

本机：`npm test -- sidebarMultiSelect`
沙箱：按 describe 切片跑

预期：任务 2 的 2 条 + 任务 1 的 6 条**全部 PASS**。

> **注意（trigger 未变即可保留「跟随鼠标」）**：本次只加 `open`/`onOpenChange`，**不得**改 `trigger`。`alignPoint` 只由 `trigger` 推导（`antd/es/dropdown/dropdown.js:109`），改 trigger 会让分组行右键菜单跑到行末而非鼠标旁边。

- [ ] **步骤 6：Typecheck**

运行：`npm run typecheck`
预期：0 error，退出码 0。

- [ ] **步骤 7：Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx tests/renderer/sidebarMultiSelect.test.tsx
git commit -m "feat(sidebar): 分组行菜单纳入互斥(四个 Dropdown 全覆盖)"
```

---

## 任务 3：修正既有用例的规格反转 + 注释同步

**文件：**
- 修改：`tests/renderer/sidebarMultiSelect.test.tsx:307-347`（既有用例的注释与第 2 步断言）
- 修改：`src/renderer/src/components/Sidebar.tsx:45-50`（`caretCenter` 的过时注释，属顺手修正的相邻问题）

**交付物**：全套测试与代码注释反映新语义，无自相矛盾的说明。

- [ ] **步骤 1：修正既有用例（规格反转）**

`tests/renderer/sidebarMultiSelect.test.tsx` 第 325 条用例，其第 2 步：

```tsx
    // 2. 点该行行尾 ⋯,内层菜单打开
    fireEvent.click(row.querySelector('button[aria-label="更多操作"]') as HTMLElement)
    await waitFor(() => expect(document.querySelectorAll('.ant-dropdown').length).toBeGreaterThan(1))
```

改为：

```tsx
    // 2. 点该行行尾 ⋯,内层菜单打开
    // 【规格反转 2026-09-24】原断言是 `length > 1`(两个菜单共存)。
    // 引入全局互斥后,打开 ⋯ 会立刻关掉同行的右键菜单 —— 共存不再成立,
    // 改为断言「可见菜单恰好 1 个,且是 ⋯ 菜单」。本用例真正要守的
    // (第 4 步「点内层菜单项后归 0」)未变,故保留。
    fireEvent.click(row.querySelector('button[aria-label="更多操作"]') as HTMLElement)
    await waitFor(() => expect(visibleDropdownCount()).toBe(1))
```

同时把该用例上方的注释块（`:307-324`）补一段说明互斥带来的变化：

```tsx
   * 【2026-09-24 后续】引入全局互斥后,本用例的中间态由「两菜单共存」变为
   * 「只剩 ⋯ 菜单」—— 右键菜单在 ⋯ 打开的瞬间就被互斥关掉了。
   * 修复手段也不再是「内层显式关外层」,而是两者共用 openMenuKey。
   * 本用例保留,继续守「点内层菜单项后外层不残留」这一原始目标。
```

- [ ] **步骤 2：运行测试验证仍通过**

本机：`npm test -- sidebarMultiSelect`

预期：该用例 **PASS**（若 FAIL，说明第 2 步断言与实现不符，回查任务 2 的受控改造）。

- [ ] **步骤 3：同步 `caretCenter` 的过时注释**

`Sidebar.tsx:45-50`，当前注释说「层级对齐线画在**父项**箭头中心列(= 子项箭头中心 - 一个缩进)」并称「若画在子项箭头中心(旧实现),线会直接穿过子项箭头字形」。该表述已被 2026-09-24 的对齐线修复（commit `00d13ae`）推翻 —— 线事实上就在**本行**箭头中心列。替换为：

```tsx
/**
 * 某层折叠箭头的水平中心。
 * 层级对齐线画在本行箭头**墨迹的水平中心**列(ROW_PAD + depth*TREE_INDENT + CARET_BOX/2
 * = 行左沿 + 5)。箭头墨迹横跨 [行左沿+2.2, 行左沿+8.0](path 3.4→6.8 加 round cap 半径 0.6),
 * 故 5 正是墨迹中心。
 *
 * 2026-09-24 修正:旧注释称「画在父项箭头中心列,若画在子项中心会穿过子项字形」——
 * **不准确**。线落在父项正下方只是上下层之间的观察结果;对 depth 行自身,它就是
 * 自己箭头的中心线,而 y 轴从分组头行**下沿**起笔(top: 0,见 theme.css),故不重叠。
 * 详见 docs/superpowers/specs/2026-09-24-sidebar-menu-mutex-design.md 与
 * tests/renderer/sidebar.test.tsx 的「对齐线几何」。
 */
```

- [ ] **步骤 4：Typecheck**

运行：`npm run typecheck`
预期：0 error。

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx tests/renderer/sidebarMultiSelect.test.tsx
git commit -m "test(sidebar): 修正菜单共存用例的规格反转 + 同步对齐线过时注释"
```

---

## 任务 4：回退验证（证明新用例真的能抓住 bug）

**文件：** 无（仅临时回退再恢复）

**交付物**：证据表明新用例在旧实现下会红 —— 否则断言可能只是恰好通过（假绿）。

- [ ] **步骤 1：备份当前实现**

```bash
cp src/renderer/src/components/Sidebar.tsx .workbuddy/verify/backup/Sidebar.tsx.mutex
md5sum src/renderer/src/components/Sidebar.tsx
```

- [ ] **步骤 2：临时把脚本行 ⋯ 的受控改回非受控**

把任务 1 步骤 5 加的两行（`open={...}` 与 `onOpenChange={...}`）**删掉**，恢复成无受控的 `<Dropdown trigger={['click']} menu={{...}}>`。

- [ ] **步骤 3：运行测试，确认变红**

本机：`npm test -- sidebarMultiSelect`
沙箱：切片跑

预期：**「右键菜单开着时打开另一行的 ⋯ 菜单…」与「跨行类型互斥」两条变红**（`expected 2 to be 1`）。

若**没有变红**：说明这些断言抓不住 bug —— 回到任务 1/2 重写断言。**不得跳过本步。**

- [ ] **步骤 4：从备份恢复并核对**

```bash
cp .workbuddy/verify/backup/Sidebar.tsx.mutex src/renderer/src/components/Sidebar.tsx
md5sum src/renderer/src/components/Sidebar.tsx
```

预期：md5 与步骤 1 记录的**完全一致**。

- [ ] **步骤 5：重跑确认恢复绿**

本机：`npm test -- sidebarMultiSelect`
预期：全部 PASS。

---

## 任务 5：全量回归 + 交付说明

**文件：** 无（仅验证与文档）

**交付物**：确认未破坏既有行为，并留下交付说明。

- [ ] **步骤 1：跑完整 sidebar 相关套件**

本机（推荐）：`npm test`
预期：全绿。

沙箱：依次打包并切片跑
```bash
bash .workbuddy/verify/build-and-run.sh tests/renderer/sidebarMultiSelect.test.tsx
bash .workbuddy/verify/build-and-run.sh tests/renderer/sidebar.test.tsx
```
注意沙箱每进程约 3 用例上限（OOM），需按 describe 切片。

- [ ] **步骤 2：typecheck**

运行：`npm run typecheck`
预期：0 error。

- [ ] **步骤 3：确认无 `ctxMenuId` 残留 + 旧手动关闭逻辑已删**

```bash
grep -rn "ctxMenuId" src/ tests/ || echo "干净: ctxMenuId 已彻底移除"
grep -n "setCtxMenuId" src/ tests/ || echo "干净: setCtxMenuId 已彻底移除"
```

预期：两条都输出「干净」。

- [ ] **步骤 4：更新记忆**

在 `.workbuddy/memory/2026-09-24.md` 追加本次改动小结（互斥方案、守卫陷阱、规格反转的那条用例）。

- [ ] **步骤 5：向用户汇报**

汇报要点：
- 四个 Dropdown 已全部受控于 `openMenuKey`，互斥成立
- 新增 6 条用例 + 修正 1 条既有用例（规格反转，已注明）
- 回退验证结果（哪几条变红）
- **提示用户本机跑 `npm test`** —— 沙箱因 `ulimit -v` 硬钳无法全量跑
- 提示本地领先 `origin/master` 的提交数（截至本计划编写时为 7：6 个既有 + `840c966` 规格；本次实现还会 +3）

---

## 自检记录

**1. 规格覆盖度**

| 规格章节 | 对应任务 |
|---|---|
| §3.1 `openMenuKey` 数据模型 | 任务 1 步骤 3 |
| §3.2 统一改造形态（含守卫） | 任务 1 步骤 4/5、任务 2 步骤 3/4 |
| §3.3 四个 Dropdown 差异 | 任务 1 步骤 4/5（脚本行）、任务 2 步骤 3/4（分组行） |
| §3.4 数据流 | 由受控形态天然实现，无独立任务 |
| §3.5 语义总表 8 行 | 任务 1 的 5 条用例 + 任务 2 的 2 条 |
| §4 测试设计 6 条 | 任务 1 步骤 1（6 条）+ 任务 2 步骤 1（2 条） |
| §4 规格反转那条既有用例 | 任务 3 步骤 1 |
| §5 风险缓解（trigger 不可改） | 任务 2 步骤 5 的注意块 |
| §6 提交前自检清单 | 任务 4（回退验证）+ 任务 5（全量） |

**2. 占位符扫描**：无「待定/TODO/后续实现」；每个代码步骤都给了可直接粘贴的代码块。

**3. 类型一致性**：`openMenuKey`（string | null）在任务 1 定义、任务 1/2 使用；`setOpenMenuKey` 的 updater 形态 `(prev) => ...` 四处一致；key 前缀 `ctx:`/`more:` × `script:`/`group:` 在任务 1/2 与规格 §3.1 表格一致。
