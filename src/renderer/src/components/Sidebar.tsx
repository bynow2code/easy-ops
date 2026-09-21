import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { App, Button, Dropdown, Input, Space, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  CaretRightOutlined,
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

/** 搜索按「名称」匹配(Postman 式):内容不参与,避免出现名称对不上却命中结果的困惑 */
function matches(script: Script, keyword: string): boolean {
  if (!keyword) return true
  return nameContains(script.name, keyword)
}

function nameContains(name: string, keyword: string): boolean {
  return name.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * 树形缩进(Postman 式):子项(脚本/子目录)比父目录名深一级(20px),
 * 层级对齐线画在子项折叠箭头的中心列,父名 → 对齐线 → 子内容逐层递进。
 * 39 = 分组头左 padding 4 + 箭头 10 + gap 6 + 文件夹图标 13 + gap 6,即 depth 0 的分组名文字起点。
 * 递归渲染时同一单位也作为每层目录的水平缩进,保证父子视觉层级一致。
 */
const TREE_INDENT = 20

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

/** 递归树的节点:目录 + 子目录 + 直接挂的脚本 + 后序聚合的脚本总数 */
interface GroupNode {
  group: Group
  /** 直接子目录(按 order 排) */
  children: GroupNode[]
  /** 直接挂的脚本(按 order 排) */
  scripts: Script[]
  /** 该目录下所有脚本总数(含子目录),用于计数 chip */
  total: number
}

/** 分组名后面的计数 chip。中性色,把「强调」留给选中态 */
const countChipStyle = {
  fontSize: 11,
  lineHeight: '16px',
  padding: '0 5px',
  borderRadius: 6,
  background: 'var(--app-hairline)',
  color: 'var(--color-text)',
  opacity: 0.55
} as const

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

  const visible = useMemo(() => scripts.filter((s) => matches(s, search)), [scripts, search])

  const searching = search.trim().length > 0

  // 整树构建:目录按 order 排好后按 parentId 挂到父节点,父缺失的(含旧孤儿数据)落顶层;
  // 无分组脚本(groupId 缺失或指向已删目录)直接作为顶层行渲染,排在所有顶层目录之后。
  // 搜索按 Postman 逻辑过滤:保留名称命中的脚本;目录「自身名称命中」则整棵子树保留,
  // 否则仅当含命中后代时作为路径保留(只带命中项);没有命中内容的分支整个隐藏。
  const { tree, rootScripts, searchEmpty } = useMemo((): {
    tree: GroupNode[]
    rootScripts: Script[]
    searchEmpty: boolean
  } => {
    const nodes = new Map<string, GroupNode>()
    for (const g of [...groups].sort((a, b) => a.order - b.order)) {
      nodes.set(g.id, { group: g, children: [], scripts: [], total: 0 })
    }
    const roots: GroupNode[] = []
    for (const node of nodes.values()) {
      const parent = node.group.parentId ? nodes.get(node.group.parentId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    const rootScripts: Script[] = []
    for (const s of visible) {
      const key = s.groupId && nodes.has(s.groupId) ? s.groupId : null
      if (key) nodes.get(key)!.scripts.push(s)
      else rootScripts.push(s)
    }

    if (!searching) {
      // 非搜索态:全量展示。后序遍历,total = 直接脚本数 + 子目录 total 之和
      const fill = (node: GroupNode): number => {
        node.total = node.scripts.length + node.children.reduce((sum, c) => sum + fill(c), 0)
        return node.total
      }
      for (const root of roots) fill(root)
      return { tree: roots, rootScripts, searchEmpty: false }
    }

    const prune = (node: GroupNode): GroupNode | null => {
      const selfMatch = nameContains(node.group.name, search)
      const children = node.children.map(prune).filter((c): c is GroupNode => c !== null)
      const scripts = selfMatch ? node.scripts : node.scripts.filter((s) => nameContains(s.name, search))
      if (!selfMatch && children.length === 0 && scripts.length === 0) return null
      const kept: GroupNode = { ...node, children, scripts, total: 0 }
      kept.total = kept.scripts.length + kept.children.reduce((sum, c) => sum + c.total, 0)
      return kept
    }
    const prunedRoots = roots.map(prune).filter((n): n is GroupNode => n !== null)
    const prunedRootScripts = rootScripts.filter((s) => nameContains(s.name, search))
    return {
      tree: prunedRoots,
      rootScripts: prunedRootScripts,
      searchEmpty: prunedRoots.length === 0 && prunedRootScripts.length === 0
    }
  }, [groups, visible, searching, search])

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
    // 为什么不用 tree:tree 的 total 基于 visible(搜索过滤后的脚本)聚合,搜索态下
    // 匹配 0 条时会把「全部上移」误报成「0 个脚本上移」,误导用户执行不可逆操作。
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

  const renderScript = (script: Script, depth: number, guide?: 'full' | 'half'): JSX.Element => {
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
          padding: '3px 8px',
          // Postman 式缩进:调用方传入的是「分组 depth + 1」,脚本文字起点 = 39 + depth*20,
          // 比所在分组名(39 + (depth-1)*20)深一级 20px;marginLeft = 文字起点 - padding 8
          marginLeft: depth * TREE_INDENT + 31,
          marginBottom: 1,
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
        {/* 父目录的层级对齐线经过本行;最后一个子项只画到中线,不穿透 */}
        {guide ? (
          <span
            className="app-guide"
            style={{ left: -22, ...(guide === 'half' ? { bottom: '50%' } : null) }}
            aria-hidden="true"
          />
        ) : null}
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

  const renderGroupNode = (node: GroupNode, depth: number, guide?: 'full' | 'half'): JSX.Element => {
    const key = node.group.id
    const expanded = isExpanded(key)
    const indent = depth * TREE_INDENT
    const hint = dropHint?.id === key ? dropHint.position : null
    return (
      // position relative:父目录的层级对齐线段以本块为定位基准,贯穿整块高度
      <div style={{ marginBottom: 4, position: 'relative' }} key={key}>
        {/* 父目录的层级对齐线经过本块;最后一个子项只画到中线,不穿透 */}
        {guide ? (
          <span
            className="app-guide"
            style={{ left: depth * TREE_INDENT + 9, ...(guide === 'half' ? { bottom: '50%' } : null) }}
            aria-hidden="true"
          />
        ) : null}
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
            padding: '3px 4px',
            paddingLeft: 4 + indent,
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
            <CaretRightOutlined
              rotate={expanded ? 90 : 0}
              style={{ fontSize: 10, opacity: 0.45, transition: 'transform 0.12s ease' }}
            />
            <FolderOutlined style={{ fontSize: 13, opacity: 0.7 }} />
            <Typography.Text
              ellipsis
              style={{ fontSize: 13, fontWeight: 400, opacity: 0.9, minWidth: 0 }}
            >
              {node.group.name}
            </Typography.Text>
            {/* 计数 = 该目录下所有脚本总数(含子目录) */}
            <span style={countChipStyle}>{node.total}</span>
          </Space>
          {/* 目录操作按钮不触发展开/收起 */}
          <span className="app-group-actions" onClick={(e) => e.stopPropagation()}>
            {renderGroupActions(node.group)}
          </span>
        </div>
        {expanded ? (
          <div style={{ marginTop: 2, position: 'relative' }}>
            {(() => {
              // 每个子项自己画「父目录对齐线」的经过段:非末位画满高,末位只画到中线(Postman 式截止)
              const lastIndex = node.children.length + node.scripts.length - 1
              const guideOf = (i: number): 'full' | 'half' => (i === lastIndex ? 'half' : 'full')
              return (
                <>
                  {node.children.map((c, i) => renderGroupNode(c, depth + 1, guideOf(i)))}
                  {node.scripts.map((s, i) => renderScript(s, depth + 1, guideOf(node.children.length + i)))}
                </>
              )
            })()}
            {node.children.length === 0 && node.scripts.length === 0 ? (
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, paddingLeft: 39 + (depth + 1) * TREE_INDENT }}
              >
                暂无脚本
              </Typography.Text>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const nothingAtAll = scripts.length === 0 && groups.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索脚本"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* 顶部只留「新建分组」:脚本一律通过目录行悬停 ＋ 创建,入口归一 */}
      <Space size={8}>
        <Button
          icon={<FolderAddOutlined />}
          onClick={() => openForm({ type: 'group-create', parentId: null })}
        >
          新建分组
        </Button>
      </Space>

      {/* 树容器同时是「拖出目录」的落点:把脚本拖到列表空白处 = 移到顶层(groupId 置空)。
          行自身的 onDrop 会 stopPropagation,只有落在行间空白才会冒到这里。
          className 供 .app-tree:hover 触发层级对齐线显形 */}
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
