import { useEffect, useMemo, useState } from 'react'
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

function matches(script: Script, keyword: string): boolean {
  if (!keyword) return true
  const k = keyword.toLowerCase()
  return script.name.toLowerCase().includes(k) || script.content.toLowerCase().includes(k)
}

/**
 * 树形缩进:分组头 = 折叠箭头 + 文件夹图标 + 名称,
 * 脚本行与子目录条目同层缩进(参考 API 工具的接口树)。
 * 39 = 分组头左 padding 4 + 箭头 10 + gap 6 + 文件夹图标 13 + gap 6。
 * 递归渲染时同一单位也作为每层目录的水平缩进,保证父子视觉层级一致。
 */
const TREE_INDENT = 39

/** 「未分组」伪分组的 key;脚本无 groupId 或 groupId 指向已删分组时都归到这里 */
const UNGROUPED_KEY = '__ungrouped__'

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
  padding: '0 6px',
  borderRadius: 6,
  background: 'var(--app-hairline)',
  color: 'var(--color-text)',
  opacity: 0.6
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

  // 整树构建:目录按 order 排好后按 parentId 挂到父节点,父缺失的(含旧孤儿数据)落顶层;
  // 脚本归到所属目录,groupId 缺失或指向已删目录的归入「未分组」虚拟节点
  const tree = useMemo((): GroupNode[] => {
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
    const ungroupedScripts: Script[] = []
    for (const s of visible) {
      const key = s.groupId && nodes.has(s.groupId) ? s.groupId : null
      if (key) nodes.get(key)!.scripts.push(s)
      else ungroupedScripts.push(s)
    }
    // 后序遍历:total = 直接脚本数 + 子目录 total 之和,计数 chip 展示整棵子树的脚本量
    const fill = (node: GroupNode): number => {
      node.total = node.scripts.length + node.children.reduce((sum, c) => sum + fill(c), 0)
      return node.total
    }
    for (const root of roots) fill(root)
    // 「未分组」并入树:与其他目录共用同一套折叠/计数/展开语义,固定排在所有目录之后
    roots.push({
      group: {
        id: UNGROUPED_KEY,
        name: '未分组',
        order: Number.MAX_SAFE_INTEGER,
        parentId: null,
        createdAt: ''
      },
      children: [],
      scripts: ungroupedScripts,
      total: ungroupedScripts.length
    })
    return roots
  }, [groups, visible])

  const searching = search.trim().length > 0
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
  const selectedGroupId = selectedScript ? (selectedScript.groupId ?? UNGROUPED_KEY) : null
  useEffect(() => {
    if (!selectedGroupId || !collapsedIds.has(selectedGroupId)) return
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      next.delete(selectedGroupId)
      return next
    })
  }, [selectedGroupId, collapsedIds])

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
    // '__ungrouped__' 是树渲染用的伪分组 key,不在 groups 里,不会被上面收集到,无需处理
    const parentName = group.parentId ? groups.find((g) => g.id === group.parentId)?.name : null
    const target = parentName ? `「${parentName}」` : '顶层'
    modal.confirm({
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
    return (
      <div
        key={script.id}
        // 操作按钮靠 CSS 显隐(class 驱动)而非条件渲染:按钮始终留在 DOM 里,
        // 键盘 Tab 仍可达,组件测试也不必为「悬停」造状态
        className={selected ? 'app-row app-row-selected' : 'app-row'}
        onClick={() => selectScript(script.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '4px 8px 4px 8px',
          // 缩进随目录层级加深,脚本行与子目录条目同层缩进
          marginLeft: depth * TREE_INDENT + (TREE_INDENT - 8),
          marginBottom: 1,
          borderRadius: 'var(--app-radius)',
          cursor: 'pointer'
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

  /** 目录行操作区:＋ 直达新建脚本,其余操作收进 ⋯ 菜单(Postman 式) */
  const renderGroupActions = (group: Group): JSX.Element => (
    <Space size={0}>
      <Tooltip title="在此目录新建脚本">
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          aria-label="在此目录新建脚本"
          onClick={(e) => {
            e.stopPropagation()
            openForm({ type: 'script-create', groupId: group.id })
          }}
        />
      </Tooltip>
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
    return (
      <div style={{ marginBottom: 6 }} key={key}>
        {/* 分组头 = 折叠箭头 + 文件夹图标 + 名称 + 总数 chip,整行可点用于展开/收起;缩进随层级加深 */}
        <div
          className="app-group-head"
          onClick={() => toggleGroup(key)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '3px 4px',
            paddingLeft: 4 + indent,
            borderRadius: 'var(--app-radius)',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <Space size={6} align="center" style={{ minWidth: 0 }}>
            <CaretRightOutlined
              rotate={expanded ? 90 : 0}
              style={{ fontSize: 10, opacity: 0.45, transition: 'transform 0.12s ease' }}
            />
            <FolderOutlined style={{ fontSize: 13, opacity: 0.65 }} />
            <Typography.Text
              ellipsis
              style={{ fontSize: 13, fontWeight: 400, opacity: 0.85, minWidth: 0 }}
            >
              {node.group.name}
            </Typography.Text>
            {/* 计数 = 该目录下所有脚本总数(含子目录) */}
            <span style={countChipStyle}>{node.total}</span>
          </Space>
          {/* 「未分组」没有目录级操作;其余目录的操作按钮不触发展开/收起 */}
          {key === UNGROUPED_KEY ? null : (
            <span className="app-group-actions" onClick={(e) => e.stopPropagation()}>
              {renderGroupActions(node.group)}
            </span>
          )}
        </div>
        {expanded ? (
          <div style={{ marginTop: 2 }}>
            {node.children.map((c) => renderGroupNode(c, depth + 1))}
            {node.scripts.map((s) => renderScript(s, depth + 1))}
            {node.children.length === 0 && node.scripts.length === 0 ? (
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, paddingLeft: TREE_INDENT + depth * TREE_INDENT }}
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

      <Space size={8}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm({ type: 'script-create', groupId: null })}>
          新建脚本
        </Button>
        <Button
          icon={<FolderAddOutlined />}
          onClick={() => openForm({ type: 'group-create', parentId: null })}
        >
          新建分组
        </Button>
      </Space>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {nothingAtAll ? (
          <CenteredHint text="还没有脚本,点上方「新建脚本」开始" />
        ) : visible.length === 0 ? (
          <CenteredHint text="没有匹配的脚本" />
        ) : (
          <>
            {/* 整棵目录树递归渲染;「未分组」是树里的虚拟顶层节点,语义与其他目录一致 */}
            {tree.map((node) => renderGroupNode(node, 0))}
          </>
        )}
      </div>
    </div>
  )
}
