import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { App, Button, Dropdown, Input, Space, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  SnippetsOutlined
} from '@ant-design/icons'
import type { Group, Script } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { terminalActions } from '../store/useTerminalStore'
import { toUserMessage } from '../utils/toUserMessage'
import { computeDropAction, insertIntoSiblings, type DragItem, type DropPosition, type DropTarget } from '../utils/treeDnd'
import { buildBatchDeletePlan, rangeBetween, resolveShiftAnchor } from '../utils/multiSelect'

/**
 * 搜索按「名称」匹配(Postman 式):内容不参与,避免出现名称对不上却命中结果的困惑。
 * 现在只服务于 prune 里的脚本/目录名比对(整树喂的是全量 scripts)。
 */
function nameContains(name: string, keyword: string): boolean {
  return name.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * 树形几何(按 Postman 侧边栏截图实测换算:行高 24px,每级缩进 8px = 行高的 1/3)。
 * 行内列自左向右:箭头槽 10px → gap 6 → 文件夹图标 13px → gap 6 → 名称(距行左 39px);
 * 脚本行没有箭头/图标,靠同样的 paddingLeft 把名称对齐到**目录名同一列**。
 * 递归渲染时 TREE_INDENT 也作为每层目录的水平缩进,保证父子视觉层级一致。
 */
const TREE_INDENT = 8
/** 行高:分组头与脚本行一致,行与行严丝合缝(截图里行距 = 行高) */
const ROW_HEIGHT = 24
/** 行左内边距(depth 0 的箭头起点),也用于目录头与脚本行对齐 */
const ROW_PAD = 4
const CARET_BOX = 10
const ROW_GAP = 6
const ICON_SIZE = 13
/** 名称列起点 = 4 + 10 + 6 + 13 + 6,depth 0 的目录名与脚本名都从这里开始 */
const NAME_LEFT = ROW_PAD + CARET_BOX + ROW_GAP + ICON_SIZE + ROW_GAP

/**
 * 某层折叠箭头的水平中心。
 * 层级对齐线画在**父项**箭头中心列(= 子项箭头中心 - 一个缩进):截图里线正落在父箭头
 * 正下方,子项箭头整体在它右侧;若画在子项箭头中心(旧实现),线会直接穿过子项箭头字形。
 */
const caretCenter = (depth: number): number => ROW_PAD + depth * TREE_INDENT + CARET_BOX / 2

/**
 * 目录行 ⋯ 菜单的固定项;具体行为(新建子目录/重命名/删除)在 onClick 里按 key 分发。
 *
 * 刻意不带 icon(2026-09-24 用户定稿):菜单项文字本就自解释,而 antd 菜单按项计算
 * 左对齐 —— 只去掉一项的图标会让那一项文字左移、与其余各项错开,要嘛全留要嘛全去。
 * 这里选了全去(纯文字菜单),故三项都无图标。
 * 注意 danger: true 必须保留:「删除目录」去掉图标后,红色是它唯一的危险提示。
 */
const groupMenuItems: MenuProps['items'] = [
  { key: 'add-subgroup', label: '新建子目录' },
  { key: 'rename', label: '重命名' },
  { type: 'divider' },
  { key: 'delete', label: '删除目录', danger: true }
]

/** 脚本行 ⋯ 菜单的固定项;复制/删除收敛进菜单后,行上只留高频的执行/编辑 */
const scriptMenuItems: MenuProps['items'] = [
  { key: 'copy', icon: <CopyOutlined />, label: '复制' },
  { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true }
]

/** 递归树的节点:目录 + 子目录 + 直接挂的脚本 */
interface GroupNode {
  group: Group
  /** 直接子目录(按 order 排) */
  children: GroupNode[]
  /** 直接挂的脚本(按 order 排) */
  scripts: Script[]
}

/**
 * 树形折叠箭头(Postman 式):细描边 v 形,不用 antd 的实心三角。
 * 展开时旋转 90°;颜色跟随文字并压淡,与对齐线的灰度一致。
 */
function TreeCaret({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
      style={{
        flex: '0 0 auto',
        transform: expanded ? 'rotate(90deg)' : 'none',
        transition: 'transform 0.12s ease',
        opacity: 0.5
      }}
    >
      <path
        d="M3.4 2.2 L6.8 5 L3.4 7.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CenteredHint({ text }: { text: string }): JSX.Element {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10
      }}
    >
      <SnippetsOutlined style={{ fontSize: 26, opacity: 0.35 }} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {text}
      </Typography.Text>
    </div>
  )
}

export function Sidebar(): JSX.Element {
  // 分片订阅:任何 store 字段更新只让真正用到它的组件重渲染。
  // 之前 useAppStore() 全量订阅,编辑器每敲一个字(setContentDraft)都会让整棵树 reconcile。
  // 动作(reload/selectScript 等)在 zustand 里是稳定引用,单独取不会造成多余渲染
  const scripts = useAppStore((s) => s.scripts)
  const groups = useAppStore((s) => s.groups)
  const selectedScriptId = useAppStore((s) => s.selectedScriptId)
  const search = useAppStore((s) => s.search)
  const reload = useAppStore((s) => s.reload)
  const selectScript = useAppStore((s) => s.selectScript)
  const openForm = useAppStore((s) => s.openForm)
  const setSearch = useAppStore((s) => s.setSearch)
  const { modal, message } = App.useApp()

  /** 折叠的分组 id 集合;搜索时强制全部展开,保证结果可见 */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())

  // 折叠状态跨重启持久化:挂载时从设置读入,变化后防抖写回(与分栏比例同款「loaded 门 + 防抖」)。
  // 读入与 reload 用 Promise.all 绑定:保证写盘 prune 时 groups 已进 store,
  // 否则目录列表慢于防抖计时器时,空 groups 会把已存折叠状态误清空。
  const [collapsedLoaded, setCollapsedLoaded] = useState(false)
  // 上次成功写入(或读入)的折叠集合序列化值:相同则跳过写盘。
  // 三重作用——消除每次启动的幂等写;读失败时守卫住空集合,绝不能把降级态
  // 落盘覆盖用户已存状态(那是一次瞬时 IPC 故障换来的数据丢失);连续点击只落最终值
  const lastWrittenRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [settings] = await Promise.all([window.api.settings.get(), reload()])
        if (cancelled) return
        const stored = Array.isArray(settings.collapsedGroupIds) ? settings.collapsedGroupIds : []
        const valid = new Set(useAppStore.getState().groups.map((g) => g.id))
        const pruned = stored.filter((id) => valid.has(id))
        setCollapsedIds(new Set(pruned))
        // 读入值(去掉盘上残留死 id 后)即为已落盘基线:死 id 留在盘上无害,
        // 下次真实变更触发写盘时自然被清掉
        lastWrittenRef.current = JSON.stringify(pruned)
        setCollapsedLoaded(true)
      } catch (err) {
        // 读失败时放弃持久化(不翻 loaded):本会话折叠只存在内存,
        // 绝不能把降级用的空集合写盘覆盖用户已存状态
        console.error('[Sidebar] 折叠状态读取失败,本次会话不再持久化折叠状态:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reload])
  useEffect(() => {
    if (!collapsedLoaded) return
    const timer = setTimeout(() => {
      const valid = new Set(useAppStore.getState().groups.map((g) => g.id))
      const ids = [...collapsedIds].filter((id) => valid.has(id))
      const next = JSON.stringify(ids)
      if (next === lastWrittenRef.current) return
      void window.api.settings
        .update({ collapsedGroupIds: ids })
        .then(() => {
          // 写成功才推进基线:失败的写入下个变更会自动重试
          lastWrittenRef.current = next
        })
        .catch((err) => {
          console.error('[Sidebar] 折叠状态写盘失败:', err)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [collapsedIds, collapsedLoaded])

  const searching = search.trim().length > 0

  // ── 脚本多选(纯 UI 态,不持久化;目录不参与,规格 2026-09-23) ──
  // selectedIds = 多选脚本集合;anchorId = Shift 范围选择的锚点(最近一次普通/Ctrl 单击行)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  /**
   * 用户是否主动清空过选区(Esc / 搜索)。
   * 用途只有一个:抑制 Ctrl 单击的「播种」——播种把「当前详情选中行」并入选区,
   * 这对「普通单击 A → Ctrl 单击 B」(文件管理器同款)是正确的,但在
   * 「Esc 清空 → Ctrl 单击 B」时会把 A 偷偷拉回来(回归:审查 C2)。
   * 不能用 selectedIds.size===0 或 multiSelecting 判定:Esc 时选区本就可能是空的、
   * 普通单击也会把 multiSelecting 置 false,两者都区分不出「主动清空」这一意图。
   * 任何一次点击(Ctrl/Shift/普通)都重置为 false —— 用户一旦重新点击,播种语义即恢复。
   */
  const selectionClearedRef = useRef(false)
  /** 统一清空选区入口:避免各处 setSelectedIds(new Set()) 漏置标记 */
  const clearSelection = (): void => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
    setAnchorId(null)
    selectionClearedRef.current = true
  }
  // 选区与当前列表求交:确认框打开/删除期间列表变化时,脏 id 不参与计数与批量操作
  const validSelected = useMemo(() => scripts.filter((s) => selectedIds.has(s.id)), [scripts, selectedIds])

  // 整树构建:目录按 order 排好后按 parentId 挂到父节点,父缺失的(含旧孤儿数据)落顶层;
  // 无分组脚本(groupId 缺失或指向已删目录)直接作为顶层行渲染,排在所有顶层目录之后。
  // 搜索按 Postman 逻辑剪枝(在 prune 里做,这里喂全量 scripts):
  // 目录「自身名称命中」则整棵子树保留(含未命中的脚本/子目录);否则只保留命中脚本,
  // 子目录仅当含命中内容时作为路径保留;没有命中内容的分支整个隐藏。
  const { tree, rootScripts, searchEmpty } = useMemo((): {
    tree: GroupNode[]
    rootScripts: Script[]
    searchEmpty: boolean
  } => {
    const nodes = new Map<string, GroupNode>()
    for (const g of [...groups].sort((a, b) => a.order - b.order)) {
      nodes.set(g.id, { group: g, children: [], scripts: [] })
    }
    const roots: GroupNode[] = []
    for (const node of nodes.values()) {
      const parent = node.group.parentId ? nodes.get(node.group.parentId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    const rootScripts: Script[] = []
    for (const s of scripts) {
      const key = s.groupId && nodes.has(s.groupId) ? s.groupId : null
      if (key) nodes.get(key)!.scripts.push(s)
      else rootScripts.push(s)
    }

    if (!searching) {
      // 非搜索态:全量展示,不剪枝
      return { tree: roots, rootScripts, searchEmpty: false }
    }

    // 匹配用修剪过的关键字:searching 判断用了 trim,这里不同步的话,
    // 输入「构建␣」(尾随空格)会进入搜索态却 0 命中,直接显示「没有匹配的脚本」
    const keyword = search.trim()

    const prune = (node: GroupNode): GroupNode | null => {
      const selfMatch = nameContains(node.group.name, keyword)
      // 目录自身命中 → 整棵子树原样保留(含未命中后代);否则子目录按命中递归剪枝
      const children = selfMatch
        ? node.children
        : node.children.map(prune).filter((c): c is GroupNode => c !== null)
      const scripts = selfMatch ? node.scripts : node.scripts.filter((s) => nameContains(s.name, keyword))
      if (!selfMatch && children.length === 0 && scripts.length === 0) return null
      return { ...node, children, scripts }
    }
    const prunedRoots = roots.map(prune).filter((n): n is GroupNode => n !== null)
    const prunedRootScripts = rootScripts.filter((s) => nameContains(s.name, keyword))
    return {
      tree: prunedRoots,
      rootScripts: prunedRootScripts,
      searchEmpty: prunedRoots.length === 0 && prunedRootScripts.length === 0
    }
  }, [groups, scripts, searching, search])

  /**
   * 可见脚本行的渲染前序 id 列表（目录行不进来）:Shift 范围选择按它圈行。
   * 必须与渲染逻辑严格一致 —— 折叠目录的子项在屏幕上根本不渲染,
   * 若照收进来,用户 Shift 选「屏幕上相邻的两行」会连带选中夹在中间的
   * 折叠目录里的不可见脚本,右键提示「删除 N 个」的 N 会大于视觉证据,
   * 对不可逆的批量删除是不可接受的（回归:审查 C1）。
   *
   * 由此产生的语义:「折叠一个目录」在该列表上等价于「它的脚本不存在」,
   * 于是 Shift 范围会跨过折叠组、把两侧的可见行直接连起来(例如折叠 目录B 后
   * 从 脚本A1 Shift 到 脚本C1 只选中 A 组与 C1)。这与「屏幕上相邻」的直觉一致,
   * 是**有意**的、且已在规格里记为约定。
   * 另:锚点落在被折叠目录里时会从本列表消失,这种锚点必须按「无锚点」处理,
   * 否则 Shift 会把选区写成空集(见 resolveShiftAnchor,审查 I-A)。
   */
  const flatScriptIds = useMemo((): string[] => {
    const ids: string[] = []
    // 用 collapsedIds/searching 直接判定,避免引用下面的 isExpanded(定义顺序在后)
    const visible = (groupId: string): boolean => searching || !collapsedIds.has(groupId)
    const collect = (node: GroupNode): void => {
      if (!visible(node.group.id)) return
      for (const c of node.children) collect(c)
      for (const s of node.scripts) ids.push(s.id)
    }
    for (const n of tree) collect(n)
    for (const s of rootScripts) ids.push(s.id)
    return ids
  }, [tree, rootScripts, collapsedIds, searching])

  // 搜索态的树是剪枝视图,Shift 范围会错乱:搜索词变化即清空多选(规格)
  useEffect(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
    setAnchorId(null)
    selectionClearedRef.current = true
  }, [search])

  // Esc 清空多选(不回退详情选中 —— selectedScriptId 不动,最后点过的行仍高亮)。
  // window 级监听:确认框开着时按 Esc 取消确认也会顺带清选区,无害且可接受
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
      setAnchorId(null)
      selectionClearedRef.current = true
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isExpanded = (key: string): boolean => searching || !collapsedIds.has(key)

  const toggleGroup = (key: string): void => {
    // 搜索时分组被强制展开,此时点头部若改折叠状态,视觉无反馈(清掉搜索才会显现),直接忽略
    if (searching) return
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 新建/复制/搜索选中脚本落在某个分组里时,沿祖先链自动展开让该行可见。
  // 只在「可见性需求变化」的时刻触发:选中变化(selectedGroupId)与搜索态切换(searching)。
  // collapsedIds 绝不能进依赖:否则用户折叠选中脚本祖先的操作会被这里立即撤销,
  // 表现为「点分组头无法收起」(回归:截图反馈的「点击 OMS 无法合并」即此因)。
  // groups 经 getState 取最新值且不进依赖,避免无关 reload 触发重跑。
  const selectedScript = scripts.find((s) => s.id === selectedScriptId)
  const selectedGroupId = selectedScript?.groupId ?? null
  useEffect(() => {
    if (!selectedGroupId) return
    const { groups: latestGroups } = useAppStore.getState()
    // store 层已保证 parentId 无环,seen 只是防御性兜底,避免坏数据拖死渲染进程
    const parentOf = new Map(latestGroups.map((g) => [g.id, g.parentId ?? null]))
    const chain: string[] = []
    const seen = new Set<string>()
    let cur: string | null = selectedGroupId
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      chain.push(cur)
      cur = parentOf.get(cur) ?? null
    }
    setCollapsedIds((prev) => {
      const hidden = chain.filter((id) => prev.has(id))
      // 无事可做时返回原引用,避免一次多余的全树渲染
      if (hidden.length === 0) return prev
      const next = new Set(prev)
      for (const id of hidden) next.delete(id)
      return next
    })
  }, [selectedGroupId, searching])

  // ── 拖拽排序 / 跨目录移动 ────────────────────────────────
  // 搜索态禁用拖拽:过滤后的树只含匹配子集,基于它算兄弟顺序会打乱未展示条目的排序
  const dndEnabled = !searching
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; position: DropPosition } | null>(null)

  /**
   * 拖拽开始时预计算被拖目录的全部后代 id,dragover 里做 O(1) 判定。
   * 之前每次 dragover 都从 groups 递归下扫(O(n·depth) 且每帧强制 layout),
   * 目录多了拖拽会卡;store 层已保证无环,seen 仅作防御。
   */
  const descendantIds = useMemo((): ReadonlySet<string> => {
    const set = new Set<string>()
    if (!dragItem || dragItem.type !== 'group') return set
    const byParent = new Map<string, string[]>()
    for (const g of groups) {
      if (!g.parentId) continue
      byParent.set(g.parentId, [...(byParent.get(g.parentId) ?? []), g.id])
    }
    const stack = [...(byParent.get(dragItem.id) ?? [])]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (set.has(cur)) continue
      set.add(cur)
      stack.push(...(byParent.get(cur) ?? []))
    }
    return set
  }, [dragItem, groups])

  const handleDragStart = (item: DragItem) => (e: DragEvent<HTMLDivElement>): void => {
    if (!dndEnabled) return
    setDragItem(item)
    // 必须设置 dataTransfer,Firefox 才会真正启动拖拽
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', item.id)
  }

  const handleDragEnd = (): void => {
    setDragItem(null)
    setDropHint(null)
  }

  const handleDragOver = (target: DropTarget) => (e: DragEvent<HTMLDivElement>): void => {
    if (!dragItem || dragItem.id === target.id) return
    // 目录不能落到自己或自己的后代里(store 层防环是最后兜底,UI 先拦掉)
    if (dragItem.type === 'group' && target.type === 'group' && descendantIds.has(target.id)) return

    // 落点三分:目录行上/中/下 = 之前/移入/之后;脚本行上下对半 = 之前/之后
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1)
    let position: DropPosition
    if (target.type === 'group') {
      position = ratio < 1 / 3 ? 'before' : ratio > 2 / 3 ? 'after' : 'into'
    } else {
      position = ratio < 0.5 ? 'before' : 'after'
    }
    if (position !== 'into' && dragItem.type === 'group' && target.type === 'script') return

    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropHint?.id !== target.id || dropHint.position !== position) {
      setDropHint({ id: target.id, position })
    }
  }

  const handleDragLeave = (targetId: string) => (e: DragEvent<HTMLDivElement>): void => {
    // 进入子元素也会触发 leave,relatedTarget 还在行内就不清提示,避免闪烁
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropHint((prev) => (prev?.id === targetId ? null : prev))
  }

  const handleDrop = (target: DropTarget) => (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const drag = dragItem
    const hint = dropHint
    setDragItem(null)
    setDropHint(null)
    if (!drag || !hint || hint.id !== target.id) return
    const action = computeDropAction(drag, target, hint.position)
    if (!action) return

    void (async () => {
      try {
        // 取 store 最新值而非 render 闭包快照:连续快速拖放时,上一次的 IPC+reload
        // 可能还没落地,旧快照会让第二次 reorder 覆盖第一次的排序结果
        const latest = useAppStore.getState()
        if (action.kind === 'move-into') {
          if (drag.type === 'script') {
            await window.api.scripts.update(drag.id, { groupId: action.parentId })
            // 换目录后 order 追加到新兄弟末尾,落点可预期
            const siblings = latest.scripts
              .filter((s) => s.id !== drag.id && (s.groupId ?? null) === action.parentId)
              .sort((a, b) => a.order - b.order)
              .map((s) => s.id)
            await window.api.scripts.reorder([...siblings, drag.id])
          } else {
            // moveGroup 已把 order 追加到新兄弟末尾
            await window.api.groups.move(drag.id, action.parentId)
          }
        } else if (drag.type === 'script') {
          if (drag.parentId !== action.parentId) {
            await window.api.scripts.update(drag.id, { groupId: action.parentId })
          }
          const siblings = latest.scripts
            .filter((s) => (s.groupId ?? null) === action.parentId)
            .sort((a, b) => a.order - b.order)
            .map((s) => s.id)
          await window.api.scripts.reorder(insertIntoSiblings(siblings, drag.id, action.anchorId, action.position))
        } else {
          if (drag.parentId !== action.parentId) {
            await window.api.groups.move(drag.id, action.parentId)
          }
          const siblings = latest.groups
            .filter((g) => (g.parentId ?? null) === action.parentId)
            .sort((a, b) => a.order - b.order)
            .map((g) => g.id)
          await window.api.groups.reorder(insertIntoSiblings(siblings, drag.id, action.anchorId, action.position))
        }
        await reload()
      } catch (err) {
        message.error(toUserMessage(err))
      }
    })()
  }

  const handleRun = async (script: Script): Promise<void> => {
    // 执行也算一次「使用」:先把列表条目选中(同时打开详情页签),再跑脚本
    selectScript(script.id)
    try {
      const { runId, title } = await window.api.pty.start({
        scriptId: script.id,
        scriptName: script.name,
        content: script.content,
        shellId: script.shellId
      })
      terminalActions.add({ runId, title, scriptId: script.id })
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }

  const handleEditScript = (script: Script): void => {
    // 编辑同样让条目进入选中态,详情区页签同步打开
    selectScript(script.id)
    openForm({ type: 'script-edit', script })
  }

  const handleDuplicateScript = async (script: Script): Promise<void> => {
    try {
      const created = await window.api.scripts.duplicate(script.id)
      await reload()
      selectScript(created.id)
      message.success(`已创建「${created.name}」`)
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }

  const handleDeleteScript = (script: Script): void => {
    modal.confirm({
      centered: true,
      title: '删除脚本',
      content: `确定删除「${script.name}」吗?此操作不可撤销。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.api.scripts.remove(script.id)
          await reload()
        } catch (err) {
          message.error(toUserMessage(err))
        }
      }
    })
  }

  /**
   * 批量删除:单个确认框列名字与总数 → 逐条走既有删除 IPC → 一次 reload 收尾。
   * 页签/草稿/详情选中由 reload 的既有清理逻辑收尾,这里不重复处理。
   */
  const handleBatchDelete = (rawIds: string[]): void => {
    // 以 store 最新快照求交(弹框前):菜单渲染的 validSelected 是渲染期快照,
    // 期间列表可能已变(其他入口删除)
    const plan = buildBatchDeletePlan(useAppStore.getState().scripts, rawIds)
    if (!plan) {
      message.warning('所选脚本已不存在,无需删除')
      return
    }
    modal.confirm({
      centered: true,
      title: '删除脚本',
      content: plan.content,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        // 确认框打开期间列表仍可能变化:按执行时刻的列表重新求交,
        // 已消失的 id 静默跳过、不计入失败数,否则会误报「N 个删除失败,已保留」
        const live = buildBatchDeletePlan(useAppStore.getState().scripts, plan.targets.map((t) => t.id))
        if (!live) {
          clearSelection()
          message.warning('所选脚本已不存在,无需删除')
          return
        }
        // allSettled:单条失败不拖累其他;失败的留在列表,成功的 reload 后消失
        const results = await Promise.allSettled(live.targets.map((t) => window.api.scripts.remove(t.id)))
        const failed = results.filter((r) => r.status === 'rejected').length
        await reload()
        // 删除落地后选区已无意义,清掉避免留下脏高亮/脏锚点
        clearSelection()
        if (failed > 0) message.error(`${failed} 个脚本删除失败,已保留`)
      }
    })
  }

  const handleDeleteGroup = (group: Group): void => {
    // 删除一律级联:确认文案只交代「连子目录与脚本一并删」+ 不可撤销,不列数量
    modal.confirm({
      centered: true,
      title: '删除目录',
      content: `删除目录『${group.name}』?其下脚本与子目录将一并删除,此操作不可撤销。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.api.groups.remove(group.id)
          await reload()
        } catch (err) {
          message.error(toUserMessage(err))
        }
      }
    })
  }

  /**
   * 脚本行单击(带修饰键语义,规格 2026-09-23):
   * - Shift:锚点..当前行的可见行前序范围整体选中(替换选区,锚点不动便于继续扩展)
   * - Ctrl/⌘:切换该行;仅在「尚未进入多选模式」时把当前详情选中行一并纳入(文件管理器同款)
   * - 普通单击:退出多选模式,单选该行
   * 注意 macOS 上 Ctrl+单击是系统右键,mac 用户用 ⌘(metaKey),两个修饰键都接。
   */
  const handleScriptClick = (script: Script, e: ReactMouseEvent<HTMLDivElement>): void => {
    // 任何一次行点击都恢复播种语义:用户重新点击即视为「重新开始选择」
    const wasCleared = selectionClearedRef.current
    selectionClearedRef.current = false
    if (e.shiftKey) {
      e.preventDefault()
      // 搜索态的树是剪枝视图,范围语义会错乱(用户看不到被剪掉的行):只做单选
      if (searching) {
        setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
        setAnchorId(script.id)
        selectScript(script.id)
        return
      }
      // Shift 也是进入多选的路径(无锚点时等价单选,顺手立锚)。
      // 锚点失效(主动清空过 / 所在目录被折叠导致不可见)时按无锚点处理:
      // 否则选区被写成空集、锚点又指向屏幕上不存在的行,后续右键旧选区行会
      // 弹出「删除 N 个脚本」(审查 I-A)
      const anchor = resolveShiftAnchor(flatScriptIds, anchorId, wasCleared)
      setSelectedIds(new Set(rangeBetween(flatScriptIds, anchor, script.id)))
      if (anchor === null) setAnchorId(script.id)
      selectScript(script.id)
      return
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setSelectedIds((prev) => {
        // 首次 Ctrl 单击:把当前详情选中的行一并纳入,否则它会丢高亮。
        // 但用户刚主动清空过选区(Esc/搜索)时不播种 —— 此时他期望「只选我点的这一行」,
        // 播种会把上次点过的行偷偷拉回来,右键批量删除就多删一个(审查 C2)
        const base =
          !wasCleared && prev.size === 0
            ? new Set<string>(selectedScriptId ? [selectedScriptId] : [])
            : new Set(prev)
        if (base.has(script.id)) base.delete(script.id)
        else base.add(script.id)
        return base
      })
      setAnchorId(script.id)
      selectScript(script.id)
      return
    }
    // 普通单击:退出多选,只留这一行
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
    setAnchorId(script.id)
    selectScript(script.id)
  }

  const renderScript = (script: Script, depth: number): JSX.Element => {
    // 高亮来源:多选选区 or 详情区选中(执行/编辑/新建也会 selectScript)
    const inSelection = selectedIds.has(script.id)
    const selected = inSelection || selectedScriptId === script.id
    // 拖拽落点提示:目标行的上/下边缘画 2px 主色线,标记插入位置
    const hint = dropHint?.id === script.id ? dropHint.position : null
    return (
      // 行级右键菜单:单条 = 既有 复制/删除;多选态 = 批量删除入口(App.tsx 页签右键同款)
      <Dropdown
        key={script.id}
        trigger={['contextMenu']}
        // 预选语义:右键「不在多选选区里」的行 = 先单选它(清掉多选),菜单按单条展示;
        // 右键已在选区里的行 = 不动选区,菜单按整个选区展示(文件管理器同款)。
        // 判定用 inSelection 而非 selected:后者含详情选中行,Ctrl 把某行移出选区后
        // 它仍因 selectedScriptId 高亮,此时右键会误清掉整个选区(审查 I1)。
        // 有效选区只剩 1 个(其余是脏 id)时同样降级单条,避免「删除 1 个脚本」的伪批量
        onOpenChange={(open) => {
          if (!open) return
          if (!inSelection || validSelected.length <= 1) {
            setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()))
            selectionClearedRef.current = false
            setAnchorId(script.id)
            selectScript(script.id)
          }
        }}
        menu={{
          items:
            inSelection && validSelected.length > 1
              ? [
                  {
                    key: 'batch-delete',
                    icon: <DeleteOutlined />,
                    label: `删除 ${validSelected.length} 个脚本`,
                    danger: true
                  }
                ]
              : scriptMenuItems,
          // 菜单浮层挂在 body 上,stopPropagation 防止点击冒泡误触脚本行的选中
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation()
            if (key === 'batch-delete') {
              handleBatchDelete(validSelected.map((s) => s.id))
            } else if (key === 'copy') {
              void handleDuplicateScript(script)
            } else if (key === 'delete') {
              handleDeleteScript(script)
            }
          }
        }}
      >
        <div
          // 操作按钮靠 CSS 显隐(class 驱动)而非条件渲染:按钮始终留在 DOM 里,
          // 键盘 Tab 仍可达,组件测试也不必为「悬停」造状态
          className={selected ? 'app-row app-row-selected' : 'app-row'}
          // 多选态用真实无障碍语义暴露给屏幕阅读器(审查 I-C)。
          // 这里刻意不用 data-in-selection:那是只有测试在消费的自定义属性,
          // 既没有语义角色(screen reader 读不到),也不参与样式计算,留着反而让人误以为无障碍已处理。
          // 注意:多选态目前**没有独立的视觉样式** —— 选中行统一是灰胶囊(见下方 boxShadow 注释),
          // aria-selected 是唯一的区分手段。
          role="option"
          aria-selected={inSelection}
          onClick={(e) => handleScriptClick(script, e)}
          draggable={dndEnabled}
          onDragStart={dndEnabled ? handleDragStart({ id: script.id, type: 'script', parentId: script.groupId ?? null }) : undefined}
          onDragEnd={handleDragEnd}
          onDragOver={dndEnabled ? handleDragOver({ id: script.id, type: 'script', parentId: script.groupId ?? null }) : undefined}
          onDragLeave={dndEnabled ? handleDragLeave(script.id) : undefined}
          onDrop={dndEnabled ? handleDrop({ id: script.id, type: 'script', parentId: script.groupId ?? null }) : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            height: ROW_HEIGHT,
            padding: '0 8px',
            // 名称与同级目录名同列(截图里叶子行的首列与父目录文件夹图标同列,名称与目录名同列)
            paddingLeft: NAME_LEFT + depth * TREE_INDENT,
            borderRadius: 'var(--app-radius)',
            cursor: 'pointer',
            userSelect: 'none',
            position: 'relative',
            opacity: dragItem?.id === script.id ? 0.4 : undefined,
            // 「仅详情选中」(selected 但不在多选区)原本额外画一条左侧主色竖条,
            // 用于让用户预判「右键这行会不会清掉多选」(审查 I1)。
            // 用户明确要求去掉脚本行选中时的蓝色(2026-09-23),故只保留灰胶囊一种选中态:
            // 这是有意的取舍 —— 代价是 Ctrl 反选后该行视觉上仍像选中,
            // 重新加回来之前请先确认这个决定已改变。
            // 多选态本身仍通过 aria-selected 暴露(视觉不可见,屏幕阅读器可读)。
            boxShadow:
              hint === 'before'
                ? 'inset 0 2px 0 0 var(--app-primary)'
                : hint === 'after'
                  ? 'inset 0 -2px 0 0 var(--app-primary)'
                  : undefined
          }}
        >
          <Typography.Text
            ellipsis={{ tooltip: script.name }}
            style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: selected ? 500 : 400 }}
          >
            {script.name}
          </Typography.Text>
          <span className="app-row-actions" style={{ display: 'flex', flex: '0 0 auto' }}>
            <Tooltip title="执行">
              <Button
                type="text"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  void handleRun(script)
                }}
              />
            </Tooltip>
            <Tooltip title="编辑">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  handleEditScript(script)
                }}
              />
            </Tooltip>
            <Dropdown
              trigger={['click']}
              menu={{
                items: scriptMenuItems,
                // 菜单浮层挂在 body 上,stopPropagation 防止点击冒泡误触脚本行的选中
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation()
                  if (key === 'copy') void handleDuplicateScript(script)
                  else if (key === 'delete') handleDeleteScript(script)
                }
              }}
            >
              {/* stopPropagation:⋯ 的点击不能冒泡成行选中 */}
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                aria-label="更多操作"
                onClick={(e) => e.stopPropagation()}
              />
            </Dropdown>
          </span>
        </div>
      </Dropdown>
    )
  }

  /** ＋ 直达新建脚本,建到当前目录;目录若被折叠则顺手展开(事件驱动,与「新建子目录」菜单一致) */
  const renderAddScriptAction = (groupId: string): JSX.Element => (
    <Tooltip title="在此目录新建脚本">
      <Button
        type="text"
        size="small"
        icon={<PlusOutlined />}
        aria-label="在此目录新建脚本"
        onClick={(e) => {
          e.stopPropagation()
          setCollapsedIds((prev) => {
            if (!prev.has(groupId)) return prev
            const next = new Set(prev)
            next.delete(groupId)
            return next
          })
          openForm({ type: 'script-create', groupId })
        }}
      />
    </Tooltip>
  )

  /** 目录行操作区:＋ 直达新建脚本,其余操作收进 ⋯ 菜单(Postman 式) */
  const renderGroupActions = (group: Group): JSX.Element => (
    <Space size={0}>
      {renderAddScriptAction(group.id)}
      <Dropdown
        trigger={['click']}
        menu={{
          items: groupMenuItems,
          // 菜单浮层挂在 body 上,stopPropagation 防止点击冒泡误触分组头的折叠
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation()
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
        }}
      >
        <Button type="text" size="small" icon={<MoreOutlined />} aria-label="分组操作" />
      </Dropdown>
    </Space>
  )

  const renderGroupNode = (node: GroupNode, depth: number): JSX.Element => {
    const key = node.group.id
    const expanded = isExpanded(key)
    const indent = depth * TREE_INDENT
    const hint = dropHint?.id === key ? dropHint.position : null
    return (
      // position relative:本层子项的层级对齐线段以本块为定位基准,贯穿整块高度
      <div style={{ position: 'relative' }} key={key}>
        {/* 分组头 = 折叠箭头 + 文件夹图标 + 名称 + 总数 chip,整行可点用于展开/收起;缩进随层级加深 */}
        <div
          className="app-group-head"
          onClick={() => toggleGroup(key)}
          // 键盘可达:纯 onClick 的 div 键盘用户无法折叠分组
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
          onDragStart={
            dndEnabled
              ? handleDragStart({ id: key, type: 'group', parentId: node.group.parentId ?? null })
              : undefined
          }
          onDragEnd={dndEnabled ? handleDragEnd : undefined}
          onDragOver={
            dndEnabled
              ? handleDragOver({ id: key, type: 'group', parentId: node.group.parentId ?? null })
              : undefined
          }
          onDragLeave={dndEnabled ? handleDragLeave(key) : undefined}
          onDrop={dndEnabled ? handleDrop({ id: key, type: 'group', parentId: node.group.parentId ?? null }) : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            height: ROW_HEIGHT,
            padding: '0 4px',
            paddingLeft: ROW_PAD + indent,
            borderRadius: 'var(--app-radius)',
            cursor: 'pointer',
            userSelect: 'none',
            opacity: dragItem?.id === key ? 0.4 : undefined,
            // 落点提示:上/下边缘插入线;中间区域 = 移入,整行灰底
            background: hint === 'into' ? 'var(--app-row-hover)' : undefined,
            boxShadow:
              hint === 'before'
                ? 'inset 0 2px 0 0 var(--app-primary)'
                : hint === 'after'
                  ? 'inset 0 -2px 0 0 var(--app-primary)'
                  : undefined
          }}
        >
          <Space size={6} align="center" style={{ minWidth: 0 }}>
            <TreeCaret expanded={expanded} />
            <FolderOutlined style={{ fontSize: ICON_SIZE, opacity: 0.7 }} />
            {/* 名称不降透明度:目录名与脚本名同色同级(Postman 里两者灰度一致) */}
            <Typography.Text ellipsis style={{ fontSize: 13, fontWeight: 400, minWidth: 0 }}>
              {node.group.name}
            </Typography.Text>
          </Space>
          {/* 目录操作按钮不触发展开/收起 */}
          <span className="app-group-actions" onClick={(e) => e.stopPropagation()}>
            {renderGroupActions(node.group)}
          </span>
        </div>
        {expanded ? (
          <div style={{ position: 'relative' }}>
            {/* 层级对齐线:常显(不依赖悬停),画在本目录折叠箭头的中心列,贯通整个子项块 */}
            <span className="app-guide" style={{ left: caretCenter(depth) }} aria-hidden="true" />
            {node.children.length === 0 && node.scripts.length === 0 ? (
              // 空目录引导块(参考 Postman 的「Folder is empty」):标题 + 说明 + 两个直达按钮。
              // 标题与说明同为次级灰、只靠字重区分(截图实测两者同色 #A6A6A6,按钮文字才是亮色);
              // 左沿对齐**子项的图标列**(= 本层图标列 + 一个缩进,截图实测 39 = 31 + 8)。
              // 整块是「拖进来归组」的落点(文案承诺了):不接管的话事件冒到树容器,
              // 会按「拖出目录 = 移到顶层」处理,与文案正好相反。
              <div
                className="app-empty"
                onDragOver={
                  dndEnabled
                    ? (e) => {
                        // 自拖自放:拖本目录经过自己的引导块,高亮了却落不下去,不误导。
                        // 防环判定不能省:目录为空 ≠ 它不是被拖目录的后代,
                        // 把顶层目录拖到它自己的空子目录引导块上,服务端会抛防环错误,
                        // 表现为「先高亮承诺可放,落下才闪红色提示」,与行头部的拒绝行为自相矛盾
                        if (!dragItem || dragItem.id === key) return
                        if (dragItem.type === 'group' && descendantIds.has(key)) return
                        e.preventDefault()
                        e.stopPropagation()
                        e.dataTransfer.dropEffect = 'move'
                        // 落点固定为「移入本目录」:块内没有兄弟可排序,不需要上/下三分
                        if (dropHint?.id !== key || dropHint.position !== 'into') {
                          setDropHint({ id: key, position: 'into' })
                        }
                      }
                    : undefined
                }
                onDragLeave={dndEnabled ? handleDragLeave(key) : undefined}
                onDrop={
                  dndEnabled
                    ? handleDrop({ id: key, type: 'group', parentId: node.group.parentId ?? null })
                    : undefined
                }
                style={{
                  paddingTop: 10,
                  paddingBottom: 12,
                  paddingRight: 8,
                  paddingLeft: ROW_PAD + CARET_BOX + ROW_GAP + (depth + 1) * TREE_INDENT,
                  borderRadius: 'var(--app-radius)',
                  // 拖到上方时整块高亮,与目录头用同一个落点状态
                  background: hint === 'into' ? 'var(--app-row-selected-bg)' : undefined
                }}
              >
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', fontSize: 13, fontWeight: 500, lineHeight: '20px' }}
                >
                  暂无脚本
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', fontSize: 13, lineHeight: '20px', marginTop: 2 }}
                >
                  新建脚本或子目录,也可拖入条目归组。
                </Typography.Text>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => openForm({ type: 'script-create', groupId: node.group.id })}
                  >
                    新建脚本
                  </Button>
                  <Button
                    size="small"
                    onClick={() => openForm({ type: 'group-create', parentId: node.group.id })}
                  >
                    新建子目录
                  </Button>
                </div>
              </div>
            ) : null}
            {node.children.map((c) => renderGroupNode(c, depth + 1))}
            {node.scripts.map((s) => renderScript(s, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const nothingAtAll = scripts.length === 0 && groups.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      {/* 工具栏一行放下搜索与新建分组入口(Postman 式布局):输入框吃满剩余宽度,
          右侧是 24px 纯图标按钮。顶层不提供「新建脚本」——脚本新建只发生在层级内
          (目录行 ＋ / 空目录引导块),保证每条新建路径都有明确的归组落点;
          顶层脚本只能由「拖出目录」产生 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          placeholder="搜索脚本"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Tooltip title="新建分组">
          <Button
            size="small"
            type="text"
            // 纯 + 而非 FolderAddOutlined(2026-09-24 用户要求):那个「文件夹+小加号」
            // 在 14px 下细节糊在一起、视觉偏重,且与目录行的 ＋ 语义不一致。
            // 现在统一语义:**+ = 新建**,具体新建什么由所在位置决定
            // (工具栏 = 顶层分组,目录行 = 该目录下的脚本)。
            icon={<PlusOutlined />}
            aria-label="新建分组"
            onClick={() => openForm({ type: 'group-create', parentId: null })}
          />
        </Tooltip>
      </div>

      {/* 树容器同时是「拖出目录」的落点:脚本拖到列表空白处 = 移到顶层(groupId 置空),
          目录拖到空白处 = 移到顶层顶层目录末尾(group:move 到 null),与脚本对称。
          行自身的 onDrop 会 stopPropagation,只有落在行间空白才会冒到这里。 */}
      <div
        className="app-tree"
        style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }}
        onDragOver={
          dndEnabled && dragItem && dragItem.parentId !== null ? (e) => e.preventDefault() : undefined
        }
        onDrop={
          dndEnabled && dragItem && dragItem.parentId !== null
            ? (e) => {
                e.preventDefault()
                const drag = dragItem
                setDragItem(null)
                setDropHint(null)
                // 落到顶层不可能成环(父为 null),无需后代判定
                void (async () => {
                  try {
                    const latest = useAppStore.getState()
                    if (drag.type === 'script') {
                      await window.api.scripts.update(drag.id, { groupId: null })
                      const rootSiblings = latest.scripts
                        .filter((s) => s.id !== drag.id && (s.groupId ?? null) === null)
                        .sort((a, b) => a.order - b.order)
                        .map((s) => s.id)
                      await window.api.scripts.reorder([...rootSiblings, drag.id])
                    } else {
                      // store 的 moveGroup 会把 order 追加到顶层兄弟末尾
                      await window.api.groups.move(drag.id, null)
                    }
                    await reload()
                  } catch (err) {
                    message.error(toUserMessage(err))
                  }
                })()
              }
            : undefined
        }
      >
        {nothingAtAll ? (
          <CenteredHint text="还没有脚本,先用上方的新建分组建目录,再通过目录上的 ＋ 添加脚本" />
        ) : searchEmpty ? (
          // 搜索无任何命中(脚本名与目录名都没匹配):整树替换成提示;
          // 非搜索态即使 0 脚本也要渲染树,否则「有分组但还没有脚本」的新用户会看不到任何 ＋ 入口
          <CenteredHint text="没有匹配的脚本" />
        ) : (
          // 整棵树是「可多选的脚本列表」:listbox 容器 + 每行 role="option"/aria-selected,
          // 屏幕阅读器才能播报多选态(审查 I-C)。目录头不参与多选,故不加 option 角色
          <div role="listbox" aria-label="脚本列表" aria-multiselectable>
            {/* 整棵目录树递归渲染;无分组脚本直接作为顶层行,排在所有顶层目录之后 */}
            {tree.map((node) => renderGroupNode(node, 0))}
            {rootScripts.map((s) => renderScript(s, 0))}
          </div>
        )}
      </div>
    </div>
  )
}
