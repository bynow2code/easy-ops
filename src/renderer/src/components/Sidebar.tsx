import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { App, Button, Dropdown, Input, Space, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
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

/** 目录行 ⋯ 菜单的固定项;具体行为(新建子目录/重命名/删除)在 onClick 里按 key 分发 */
const groupMenuItems: MenuProps['items'] = [
  { key: 'add-subgroup', icon: <FolderAddOutlined />, label: '新建子目录' },
  { key: 'rename', icon: <EditOutlined />, label: '重命名' },
  { type: 'divider' },
  { key: 'delete', icon: <DeleteOutlined />, label: '删除目录', danger: true }
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
  const { scripts, groups, selectedScriptId, search, reload, selectScript, openForm, setSearch } =
    useAppStore()
  const { modal, message } = App.useApp()

  /** 折叠的分组 id 集合;搜索时强制全部展开,保证结果可见 */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    void reload()
  }, [reload])

  const searching = search.trim().length > 0

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

    const prune = (node: GroupNode): GroupNode | null => {
      const selfMatch = nameContains(node.group.name, search)
      // 目录自身命中 → 整棵子树原样保留(含未命中后代);否则子目录按命中递归剪枝
      const children = selfMatch
        ? node.children
        : node.children.map(prune).filter((c): c is GroupNode => c !== null)
      const scripts = selfMatch ? node.scripts : node.scripts.filter((s) => nameContains(s.name, search))
      if (!selfMatch && children.length === 0 && scripts.length === 0) return null
      return { ...node, children, scripts }
    }
    const prunedRoots = roots.map(prune).filter((n): n is GroupNode => n !== null)
    const prunedRootScripts = rootScripts.filter((s) => nameContains(s.name, search))
    return {
      tree: prunedRoots,
      rootScripts: prunedRootScripts,
      searchEmpty: prunedRoots.length === 0 && prunedRootScripts.length === 0
    }
  }, [groups, scripts, searching, search])

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

  // 新建/复制脚本落在某个分组里时,若该分组是折叠的,自动展开让新行可见
  const selectedScript = scripts.find((s) => s.id === selectedScriptId)
  const selectedGroupId = selectedScript?.groupId ?? null
  useEffect(() => {
    if (!selectedGroupId || !collapsedIds.has(selectedGroupId)) return
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      next.delete(selectedGroupId)
      return next
    })
  }, [selectedGroupId, collapsedIds])

  // ── 拖拽排序 / 跨目录移动 ────────────────────────────────
  // 搜索态禁用拖拽:过滤后的树只含匹配子集,基于它算兄弟顺序会打乱未展示条目的排序
  const dndEnabled = !searching
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; position: DropPosition } | null>(null)

  /** target 目录是否在 ancestor 目录的后代里(含自身判定在外层) */
  const isDescendantGroup = (ancestorId: string, targetId: string): boolean => {
    const walk = (parentId: string): boolean => {
      for (const g of groups) {
        if (g.parentId === parentId) {
          if (g.id === targetId) return true
          if (walk(g.id)) return true
        }
      }
      return false
    }
    return walk(ancestorId)
  }

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
    if (dragItem.type === 'group' && target.type === 'group' && isDescendantGroup(dragItem.id, target.id)) return

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

  const handleDeleteGroup = (group: Group): void => {
    // 确认文案要交代删除后果:脚本/子目录都是上移而非删除,数字必须基于全量数据统计。
    // 为什么不用 tree:搜索态下 tree 是剪枝后的视图,匹配 0 条时会把「全部上移」
    // 误报成「0 个脚本上移」,误导用户执行不可逆操作。
    // 因此这里直接对 groups 递归收集该目录及全部后代 id,再从全量 scripts 里数命中数。
    const ids = new Set<string>([group.id])
    const collect = (parentId: string): void => {
      for (const g of groups) {
        if (g.parentId === parentId && !ids.has(g.id)) {
          ids.add(g.id)
          collect(g.id)
        }
      }
    }
    collect(group.id)
    const scriptCount = scripts.filter((s) => s.groupId != null && ids.has(s.groupId)).length
    // 同一批收集到的 id 里去掉目录自身,剩下的就是将被上移的子目录数
    const subCount = ids.size - 1
    const parentName = group.parentId ? groups.find((g) => g.id === group.parentId)?.name : null
    const target = parentName ? `「${parentName}」` : '顶层'
    modal.confirm({
      centered: true,
      title: '删除目录',
      content: `删除目录『${group.name}』?其下 ${scriptCount} 个脚本与 ${subCount} 个子目录将上移到 ${target}。`,
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

  const renderScript = (script: Script, depth: number): JSX.Element => {
    const selected = selectedScriptId === script.id
    // 拖拽落点提示:目标行的上/下边缘画 2px 主色线,标记插入位置
    const hint = dropHint?.id === script.id ? dropHint.position : null
    return (
      <div
        key={script.id}
        // 操作按钮靠 CSS 显隐(class 驱动)而非条件渲染:按钮始终留在 DOM 里,
        // 键盘 Tab 仍可达,组件测试也不必为「悬停」造状态
        className={selected ? 'app-row app-row-selected' : 'app-row'}
        onClick={() => selectScript(script.id)}
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
    )
  }

  /** ＋ 直达新建脚本,建到当前目录 */
  const renderAddScriptAction = (groupId: string): JSX.Element => (
    <Tooltip title="在此目录新建脚本">
      <Button
        type="text"
        size="small"
        icon={<PlusOutlined />}
        aria-label="在此目录新建脚本"
        onClick={(e) => {
          e.stopPropagation()
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
                        // 自拖自放:拖本目录经过自己的引导块,高亮了却落不下去,不误导
                        // 防环无需 isDescendantGroup:块只在 children.length===0 时渲染,
                        // 空目录没有后代,天然不成环 —— 若将来放宽渲染条件,这里要补后代检查
                        if (!dragItem || dragItem.id === key) return
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
                  style={{ display: 'block', fontSize: 13, lineHeight: '20px', maxWidth: 240, marginTop: 2 }}
                >
                  新建脚本或子目录,也可以把条目拖到这里归组。
                </Typography.Text>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7, marginTop: 12 }}>
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => openForm({ type: 'script-create', groupId: node.group.id })}
                  >
                    新建脚本
                  </Button>
                  <Button
                    size="small"
                    icon={<FolderAddOutlined />}
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
      {/* 工具栏一行放下搜索与新建入口(Postman 式布局):输入框吃满剩余宽度,
          右侧是 24px 图标按钮;「新建脚本」为主操作带一层软底,「新建分组」为纯图标。
          顶层新建脚本 groupId 为 null,条目落在列表顶层(和拖出目录同一去向) */}
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
        <Tooltip title="新建脚本">
          <Button
            size="small"
            type="text"
            className="app-toolbar-primary"
            icon={<PlusOutlined />}
            aria-label="新建脚本"
            onClick={() => openForm({ type: 'script-create', groupId: null })}
          />
        </Tooltip>
        <Tooltip title="新建分组">
          <Button
            size="small"
            type="text"
            icon={<FolderAddOutlined />}
            aria-label="新建分组"
            onClick={() => openForm({ type: 'group-create', parentId: null })}
          />
        </Tooltip>
      </div>

      {/* 树容器同时是「拖出目录」的落点:把脚本拖到列表空白处 = 移到顶层(groupId 置空)。
          行自身的 onDrop 会 stopPropagation,只有落在行间空白才会冒到这里。 */}
      <div
        className="app-tree"
        style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }}
        onDragOver={
          dndEnabled && dragItem?.type === 'script' && dragItem.parentId !== null
            ? (e) => e.preventDefault()
            : undefined
        }
        onDrop={
          dndEnabled && dragItem?.type === 'script' && dragItem.parentId !== null
            ? (e) => {
                e.preventDefault()
                const drag = dragItem
                setDragItem(null)
                setDropHint(null)
                void (async () => {
                  try {
                    const latest = useAppStore.getState()
                    await window.api.scripts.update(drag.id, { groupId: null })
                    const rootSiblings = latest.scripts
                      .filter((s) => s.id !== drag.id && (s.groupId ?? null) === null)
                      .sort((a, b) => a.order - b.order)
                      .map((s) => s.id)
                    await window.api.scripts.reorder([...rootSiblings, drag.id])
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
          <CenteredHint text="还没有脚本,先新建一个分组,再通过目录上的 ＋ 添加脚本" />
        ) : searchEmpty ? (
          // 搜索无任何命中(脚本名与目录名都没匹配):整树替换成提示;
          // 非搜索态即使 0 脚本也要渲染树,否则「有分组但还没有脚本」的新用户会看不到任何 ＋ 入口
          <CenteredHint text="没有匹配的脚本" />
        ) : (
          <>
            {/* 整棵目录树递归渲染;无分组脚本直接作为顶层行,排在所有顶层目录之后 */}
            {tree.map((node) => renderGroupNode(node, 0))}
            {rootScripts.map((s) => renderScript(s, 0))}
          </>
        )}
      </div>
    </div>
  )
}
