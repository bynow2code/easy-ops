# 目录行右键菜单 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让侧栏目录行（分组头）支持右键弹出菜单，行为与脚本行的整行右键一致，且右键不改变目录的展开/收起状态。

**架构：** 用受控 `Dropdown`（`trigger={[]}` + `open`/`onOpenChange`）包住分组头，并在分组头节点自挂 `onContextMenu` 显式接管右键。菜单内容复用现有 `groupMenuItems`，菜单点击分发逻辑从 `renderGroupActions` 提取为一个共用函数，两处入口（`⋯` 按钮、右键）调用同一份。

**技术栈：** React 18 + TypeScript、antd 5（Dropdown / Menu）、zustand、vitest + Testing Library（jsdom）。

**设计规格：** `docs/superpowers/specs/2026-09-24-sidebar-group-context-menu-design.md`

---

## 文件结构

| 文件 | 职责 | 本次动作 |
| --- | --- | --- |
| `src/renderer/src/components/Sidebar.tsx` | 侧栏组件。本次改动集中在 `renderGroupNode`（分组头渲染）与一处新增 state | 修改 |
| `tests/renderer/sidebar.test.tsx` | 侧栏行为测试（31 条）。本次追加 4 条右键菜单用例 | 修改 |

无新增文件。改动被刻意限制在这两个文件内 —— 菜单定义（`groupMenuItems`）已在 `Sidebar.tsx` 中，不需要外提。

---

## 实现前的环境说明

本沙箱内 `npm test` 无法启动（vitest 依赖的 undici WASM 在 `ulimit -v` 下 OOM）。**本计划中的测试运行命令统一使用仓库的 shim 驱动**，它用 `esbuild --alias:vitest=<shim>` 原样执行 `tests/` 下的正式测试文件，断言逻辑零改动：

```bash
cd /persistent/home/arthur/www/easy-ops && ./node_modules/.bin/esbuild .workbuddy/verify/official-tests.driver.ts --bundle --platform=node --format=esm \
  --outfile=.workbuddy/verify/official-tests.driver.mjs \
  --alias:vitest=/persistent/home/arthur/www/easy-ops/.workbuddy/verify/vitest-shim.ts \
  --jsx=automatic --loader:.tsx=tsx --external:jsdom \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  && /home/arthur/.workbuddy/binaries/node/versions/22.22.2/bin/node .workbuddy/verify/official-tests.driver.mjs
```

下文简称为「**跑套件**」。typecheck 命令：

```bash
cd /persistent/home/arthur/www/easy-ops && ./node_modules/.bin/tsc -p tsconfig.web.json --noEmit
cd /persistent/home/arthur/www/easy-ops && ./node_modules/.bin/tsc -p tsconfig.node.json --noEmit
```

`noUnusedLocals: true` 已开启 —— 任何不再使用的 import 必须删除，否则 typecheck 直接失败。

---

## 任务 1：目录行右键弹出菜单

**文件：**
- 修改：`src/renderer/src/components/Sidebar.tsx`（新增 state 约在 214 行之后；`renderGroupActions` 约在 846-876 行；`renderGroupNode` 约在 878-949 行）
- 测试：`tests/renderer/sidebar.test.tsx`

**背景（工程师需要知道的上下文）：**

- 脚本行已有整行右键：`renderScript` 里 `<Dropdown trigger={['contextMenu']}>` 包住整行（约 679 行）。
- 目录行**没有**。全文件 `contextMenu` 只出现 1 次（脚本行那处）。
- 目录行现在只能通过行尾悬停出现的 `⋯` 按钮（`aria-label="分组操作"`）打开菜单。
- 分组头节点带 `aria-label={`目录 ${node.group.name}`}` 与 `role="button"`，`onClick` 是折叠/展开。
- **测试里必须操作 `.app-group-head` 本体**：`sidebarMultiSelect.test.tsx:66` 注释明确指出，内部的 Typography 文本节点在 jsdom 下不保证冒泡。

**已实测确认的机制**（设计阶段用 jsdom 探针跑过，非推测）：
- 右键不会触发分组头的 `onClick`；
- `trigger={[]}` 下 `Dropdown` 不额外包裹 DOM 层（静态 HTML 与 `trigger={['contextMenu']}` 形态逐字相同），`role="button"` 位置不变。

---

- [ ] **步骤 1：编写失败的测试**

在 `tests/renderer/sidebar.test.tsx` 中定位到 `describe('悬停菜单', ...)` 这个块（约 418 行起）。**注意文件里有两个 `setupGrouped()` 定义**（约 78 行与约 420 行），本任务要用的是 **`悬停菜单` 块内的那一个（约 420 行）**，它与插入点同作用域。

该块内已有一条 `目录行悬停 + 号直接打开新建脚本表单且 groupId 指向该目录`（约 463 行）。在这条用例**之后**插入下面 4 条用例。

定位约定跟随既有测试：分组头用 `screen.getByText('wms').closest('.app-group-head')`。

```tsx
  it('目录行右键弹出菜单,菜单项与 ⋯ 按钮一致(2026-09-24)', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    const head = (await screen.findByText('wms')).closest('.app-group-head') as HTMLElement
    expect(head).toBeTruthy()

    // 对照组:右键前菜单项不存在,证明后面的断言确实来自右键这一次交互
    expect(screen.queryByText('新建子目录')).toBeNull()

    fireEvent.contextMenu(head)

    // 三项都与 ⋯ 按钮菜单同源(同一份 groupMenuItems)
    expect(await screen.findByText('新建子目录')).toBeTruthy()
    expect(screen.getByText('重命名')).toBeTruthy()
    expect(screen.getByText('删除目录')).toBeTruthy()
  })

  it('右键目录行不改变折叠状态(右键 ≠ 折叠,2026-09-24)', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    const head = (await screen.findByText('wms')).closest('.app-group-head') as HTMLElement

    const before = head.getAttribute('aria-expanded')
    expect(before).not.toBeNull()

    fireEvent.contextMenu(head)
    await screen.findByText('新建子目录')

    // 这是方案 B(受控 open + 自挂 onContextMenu)相对方案 A 存在的全部理由:
    // 右键只开菜单,不得把目录顺带折叠/展开掉。
    expect(head.getAttribute('aria-expanded')).toBe(before)
  })

  it('左键目录行仍正常折叠,onContextMenu 未误伤原交互(2026-09-24)', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    const head = (await screen.findByText('wms')).closest('.app-group-head') as HTMLElement

    const before = head.getAttribute('aria-expanded')

    fireEvent.click(head)

    await waitFor(() => expect(head.getAttribute('aria-expanded')).not.toBe(before))
  })

  it('多个目录时,右键只打开被点中那一个的菜单(2026-09-24)', async () => {
    setupGrouped()
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <Sidebar />
      </ThemeProvider>
    )
    const pdaHead = (await screen.findByText('pda')).closest('.app-group-head') as HTMLElement

    fireEvent.contextMenu(pdaHead)
    await screen.findByText('新建子目录')

    // 用 id 而非共享 boolean 维持开合状态:后者会让整棵树的目录菜单同时打开。
    // 菜单项每项只渲染一次 —— 出现 2 份即说明两个目录的菜单都开了。
    expect(screen.getAllByText('新建子目录')).toHaveLength(1)
  })
```

- [ ] **步骤 2：运行测试验证失败**

跑套件，预期：**4 条新用例全部 FAIL**。

其中前 3 条预期报 `Unable to find an element with the text: 新建子目录`（右键没反应，菜单根本没开）；第 4 条同样。

记录实际输出，确认是「功能未实现」导致的失败，而不是测试自身写错（例如 `head` 取到 null 会报别样的错）。

- [ ] **步骤 3：编写最少实现代码**

在 `src/renderer/src/components/Sidebar.tsx` 中做三处改动。

**3a. 新增受控开合 state**（放在第 214 行 `const [anchorId, setAnchorId] = useState<string | null>(null)` 之后）:

```tsx
  /**
   * 右键打开的目录菜单属于哪个目录;null = 无菜单打开。
   * 必须记 id 而不是共享的 boolean:树是递归渲染的(renderGroupNode 每层都渲染分组头),
   * 用 boolean 会让右键任一目录时**整棵树**的菜单同时打开。
   */
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
```

**3b. 提取共用的菜单点击分发**（放在 `renderGroupActions` 定义之前，约 846 行）:

原 `renderGroupActions` 里的 `onClick` 分发逻辑原样搬进这个函数：

```tsx
  /**
   * 目录菜单的点击分发。⋯ 按钮与行右键两个入口共用同一份 —— 若各写一份，
   * 日后加菜单项时极易只改一处(上一轮脚本菜单去图标就踩过「同槽位两套定义」的坑)。
   */
  const handleGroupMenuClick = (group: Group, key: string): void => {
    if (key === 'add-subgroup') {
      // 新子目录要建到这个目录下,顺手展开让建好的目录立即可见
      setCollapsedIds((prev) => {
        const next = new Set(prev)
        next.delete(group.id)
        return next
      })
      openForm({ type: 'group-create', parentId: group.id })
    } else if (key === 'rename') {
      openForm({ type: 'group-edit', group })
    } else if (key === 'delete') {
      handleDeleteGroup(group)
    }
  }
```

然后把 `renderGroupActions` 里原本内联的那段 `onClick` 替换为调用它：

```tsx
    <Space size={0}>
      {renderAddScriptAction(group.id)}
      <Dropdown
        trigger={['click']}
        menu={{
          items: groupMenuItems,
          // 菜单浮层挂在 body 上,stopPropagation 防止点击冒泡误触分组头的折叠
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation()
            handleGroupMenuClick(group, key)
          }
        }}
      >
        <Button type="text" size="small" icon={<MoreOutlined />} aria-label="分组操作" />
      </Dropdown>
    </Space>
```

**3c. 分组头包受控 Dropdown + 自挂 onContextMenu**

在 `renderGroupNode` 中，把现有的 `<div className="app-group-head" ...>...</div>` 整块用 `<Dropdown>` 包起来，并给该 div 加 `onContextMenu`。

包裹方式（注意：`Dropdown` 只能有一个子元素，且它会 clone 那个子元素来挂 `ant-dropdown-trigger` 类、不额外产生 DOM 层）：

```tsx
        <Dropdown
          trigger={[]}
          open={menuOpenId === key}
          onOpenChange={(next) => setMenuOpenId(next ? key : null)}
          menu={{
            items: groupMenuItems,
            onClick: ({ key: menuKey, domEvent }) => {
              domEvent.stopPropagation()
              handleGroupMenuClick(node.group, menuKey)
            }
          }}
        >
          <div
            className="app-group-head"
            onClick={() => toggleGroup(key)}
            // 右键 = 只开菜单。preventDefault 抑制系统右键菜单;
            // 不动折叠状态:右键在浏览器里本来也不触发 click,
            // 这里靠受控 open 显式表达,不依赖事件的隐式行为。
            onContextMenu={(e) => {
              e.preventDefault()
              setMenuOpenId(key)
            }}
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            aria-label={`目录 ${node.group.name}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleGroup(key)
              }
            }}
            draggable={dndEnabled}
            onDragStart={/* 原有内容保持不变 */}
            onDragEnd={dndEnabled ? handleDragEnd : undefined}
            onDragOver={/* 原有内容保持不变 */}
            onDragLeave={dndEnabled ? handleDragLeave(key) : undefined}
            onDrop={/* 原有内容保持不变 */}
            style={/* 原有内容保持不变 */}
          >
            {/* 原有子节点内容完全不变 */}
          </div>
        </Dropdown>
```

**注意：`onDragStart` / `onDragOver` / `onDrop` / `style` 的多行表达式原样保留，不要改写。** 本步骤只做「外面包一层 Dropdown + 加一个 onContextMenu」这一件事。

- [ ] **步骤 4：运行测试验证通过**

跑套件。预期：

```
[sidebar.test.tsx] 共 35 个用例
[sidebar.test.tsx] 35/35 通过
```

同时确认其余 15 个文件的用例数**没有变化**且全绿 —— 特别是 `sidebarMultiSelect.test.tsx`（26 条），它大量操作分组头，是本次改动最可能误伤的地方。

- [ ] **步骤 5：类型检查**

```bash
cd /persistent/home/arthur/www/easy-ops && ./node_modules/.bin/tsc -p tsconfig.web.json --noEmit && echo "TC_WEB=0"
cd /persistent/home/arthur/www/easy-ops && ./node_modules/.bin/tsc -p tsconfig.node.json --noEmit && echo "TC_NODE=0"
```

预期两条都 `0`。

- [ ] **步骤 6：回退验证（必须做）**

这是本仓库的既定约定：临时把修复回退，确认新用例真的变红，证明断言锁住了行为而非恰好通过。

**先备份**（绝不能用 `git checkout --`，那会毁掉未提交改动 —— 已有血泪教训）：

```bash
cd /persistent/home/arthur/www/easy-ops && mkdir -p .workbuddy/verify/backup && cp src/renderer/src/components/Sidebar.tsx .workbuddy/verify/backup/Sidebar.tsx.bak && md5sum src/renderer/src/components/Sidebar.tsx .workbuddy/verify/backup/Sidebar.tsx.bak
```

**回退 A：去掉 `onContextMenu` 那两行**（其余保留，包括受控 Dropdown 的包裹）。

跑套件，预期：**用例 1、2、4 变红**（菜单打不开），用例 3 仍绿（它只验左键）。

**回退 B：把 `onContextMenu` 换成 `(e) => { e.preventDefault(); setMenuOpenId(key); toggleGroup(key) }`**（即模拟「右键顺带折叠」这个 bug）。

跑套件，预期：**只有用例 2 变红**（`aria-expanded` 变了）。这条专门证明用例 2 不是摆设 —— 它锁的正是「右键 ≠ 折叠」。

**恢复**：

```bash
cd /persistent/home/arthur/www/easy-ops && cp .workbuddy/verify/backup/Sidebar.tsx.bak src/renderer/src/components/Sidebar.tsx && md5sum src/renderer/src/components/Sidebar.tsx .workbuddy/verify/backup/Sidebar.tsx.bak
```

两个 md5 必须一致，然后跑套件确认 35/35 全绿。清理备份目录。

- [ ] **步骤 7：更新规格文档的验证记录**

编辑 `docs/superpowers/specs/2026-09-24-sidebar-group-context-menu-design.md` 的 §7，把「实现待开始」替换为实际记录：改动的文件与行号、typecheck 结果、测试结果（35 条）、两次回退验证的观察结果。

- [ ] **步骤 8：Commit**

```bash
cd /persistent/home/arthur/www/easy-ops && git add src/renderer/src/components/Sidebar.tsx tests/renderer/sidebar.test.tsx docs/superpowers/specs/2026-09-24-sidebar-group-context-menu-design.md && git commit -F - <<'MSG'
feat(sidebar): 目录行支持右键菜单,与脚本行行为一致

脚本行早有整行右键,目录行只能靠悬停出现的 ⋯ 按钮。本次补齐右键入口。

实现用受控 Dropdown(trigger=[] + open/onOpenChange)+ 分组头自挂
onContextMenu,而非照抄脚本行的 antd contextMenu 触发器:分组头自身带
onClick(折叠)/draggable/onKeyDown,受控 open 让我们显式决定右键做什么,
不依赖触发器内部的事件顺序。已用 jsdom 探针实测确认:右键不触发 onClick、
不额外产生 DOM 层(role="button" 位置不变,既有测试定位不受影响)。

同时把菜单点击分发提取为 handleGroupMenuClick,⋯ 按钮与右键共用一份
—— 避免同槽位两套定义日后漂移。

不动的部分:⋯ 按钮保留(用户确认);菜单项内容不变(仍是新建子目录/
重命名/删除目录);不做目录多选与批量删除。

测试:sidebar.test.tsx 31 → 35。含「右键不改变折叠状态」与
「左键仍正常折叠」两条对照用例。已做两次回退验证:去掉 onContextMenu
→ 用例 1/2/4 红;让它顺带 toggleGroup → 只用例 2 红。
MSG
```

- [ ] **步骤 9：确认提交结果**

```bash
cd /persistent/home/arthur/www/easy-ops && git log --oneline -3 && git status --short
```

预期：`git status` 干净（`.workbuddy/` 已 gitignore）。

---

## 自检记录

**1. 规格覆盖度**

| 规格章节 | 对应任务 |
| --- | --- |
| §2 做：目录行右键可弹菜单 | 任务 1 步骤 1 用例 1 |
| §2 做：右键不改变展开/收起 | 任务 1 步骤 1 用例 2 + 步骤 6 回退 B |
| §2 做：右键不影响原有左键行为 | 任务 1 步骤 1 用例 3 |
| §2 做：多目录时只开被点中那一个 | 任务 1 步骤 1 用例 4 |
| §2 不做：保留 ⋯ 按钮 | 任务 1 步骤 3b（`renderGroupActions` 保持 `trigger={['click']}`） |
| §2 不做：不改菜单项内容 | 任务 1 步骤 3b（`groupMenuItems` 未改动） |
| §2 不做：不做目录多选 | 无任务（刻意不做） |
| §4.1 新增 menuOpenId state | 任务 1 步骤 3a |
| §4.2 受控 Dropdown + onContextMenu | 任务 1 步骤 3c |
| §4.3 分发逻辑去重 | 任务 1 步骤 3b |
| §4.4 不动的部分 | 任务 1 步骤 3b/3c 的「原有内容保持不变」 |
| §5 四条回归用例 | 任务 1 步骤 1 |
| §6 验收标准 | 任务 1 步骤 4/5/6 |

无遗漏。

**锚点核实**（已用 grep 逐一验证计划中引用的行号/名称真实存在）：

- `tests/renderer/sidebar.test.tsx` 的 `describe('悬停菜单', ...)` 起始于约 418 行，其 `setupGrouped()` 在约 420 行；插入锚点用例 `目录行悬停 + 号…` 在约 463 行。⚠️ 文件里另有第二个同名 `setupGrouped()` 定义（约 78 行，属 `describe('树形分组的折叠')`），计划已明确指定用哪一个。
- `src/renderer/src/components/Sidebar.tsx:13` 已 `import type { Group, Script }`，`handleGroupMenuClick` 的 `Group` 参数无需新增 import。
- `menuOpenId` state 插入点（约 214 行 `anchorId` 之后）与 `renderGroupActions`（约 846 行）、`renderGroupNode` 分组头（约 887 行）均已核对。

**2. 占位符扫描**

已检查：所有代码步骤都给出了可粘贴的完整代码，无未完成的空壳步骤。（注：本节自身为了说明检查项而引用了几个被禁词，grep 扫描时会在本行命中，属预期噪音，非计划缺陷。）

步骤 3c 中 `onDragStart`/`onDragOver`/`onDrop`/`style` 标注为「原有内容保持不变」而非重贴代码块 —— 这是刻意的：这些是多行表达式，原样保留比抄写更安全，且段落末尾已明确交代「只做包一层 + 加 onContextMenu，不要改写它们」。

**3. 类型一致性**

- `menuOpenId` 类型 `string | null`，与 `key`（`node.group.id`，string）、`setMenuOpenId(next ? key : null)` 一致。
- `handleGroupMenuClick(group: Group, key: string): void` —— 与 `Group` 类型 import 一致（`Sidebar.tsx:15` 已 import `Group`）。
- `menu.onClick` 回调里把 antd 的 `key` 重命名为 `menuKey` 以避免与外层 `key`（目录 id）混淆 —— 步骤 3c 已统一使用 `menuKey`。
- 测试里 `fireEvent.contextMenu(head)`、`head.getAttribute('aria-expanded')` 均为 Testing Library / DOM 标准 API，与既有测试用法一致。

**4. 环境风险（诚实标注）**

本沙箱无法运行真实 `npm test`，上述测试需通过 shim 驱动执行。shim 已覆盖 `describe/it/beforeEach/afterEach/expect/vi.fn` 与所需 matcher，且已支持 `it(name, { timeout }, fn)` 三参重载。但**发布前仍建议用户在本机跑一次 `npm test`**，以覆盖 shim 不支持的部分（`vi.mock` 类文件）。
