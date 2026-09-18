import { useEffect, useMemo } from 'react'
import { App, Button, Input, Space, Tooltip, Typography } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
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
  const { scripts, groups, selectedScriptId, search, reload, selectScript, openForm, setSearch } = useAppStore()
  const { modal, message } = App.useApp()

  useEffect(() => {
    void reload()
  }, [reload])

  const visible = useMemo(() => scripts.filter((s) => matches(s, search)), [scripts, search])

  const grouped = useMemo(() => {
    const byGroup = new Map<string | null, Script[]>()
    byGroup.set(null, [])
    for (const g of groups) byGroup.set(g.id, [])
    for (const s of visible) {
      const key = s.groupId && byGroup.has(s.groupId) ? s.groupId : null
      byGroup.get(key)!.push(s)
    }
    return byGroup
  }, [visible, groups])

  const handleRun = async (script: Script): Promise<void> => {
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
    modal.confirm({
      title: '删除分组',
      content: `确定删除分组「${group.name}」吗?组内脚本会变为未分组,不会被删除。`,
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

  const renderScript = (script: Script): JSX.Element => {
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
          padding: '5px 8px',
          marginBottom: 2,
          borderRadius: 'var(--app-radius)',
          cursor: 'pointer',
          // 用 inset 阴影而不是 border-left:选中时不会因为多出 2px 边框而让文字抖动
          boxShadow: selected ? 'inset 2px 0 0 0 var(--app-primary)' : undefined
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
                openForm({ type: 'script-edit', script })
              }}
            />
          </Tooltip>
          <Tooltip title="复制">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                void handleDuplicateScript(script)
              }}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteScript(script)
              }}
            />
          </Tooltip>
        </span>
      </div>
    )
  }

  const renderGroupRow = (
    key: string,
    name: string,
    items: Script[],
    actions: JSX.Element | null
  ): JSX.Element => (
    <div style={{ marginBottom: 10 }} key={key}>
      <div
        className="app-group-head"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '0 2px' }}
      >
        <Space size={6} align="center" style={{ minWidth: 0 }}>
          <Typography.Text
            ellipsis
            style={{ fontSize: 12, fontWeight: 500, opacity: 0.7, letterSpacing: 0.3 }}
          >
            {name}
          </Typography.Text>
          <span style={countChipStyle}>{items.length}</span>
        </Space>
        {actions ? <span className="app-group-actions">{actions}</span> : null}
      </div>
      <div style={{ marginTop: 4 }}>
        {items.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: 8 }}>
            暂无脚本
          </Typography.Text>
        ) : (
          items.map(renderScript)
        )}
      </div>
    </div>
  )

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
        <Button icon={<FolderAddOutlined />} onClick={() => openForm({ type: 'group-create' })}>
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
            {groups.map((group) => {
              const items = grouped.get(group.id) ?? []
              return renderGroupRow(
                group.id,
                group.name,
                items,
                <Space size={0}>
                  <Tooltip title="在此分组新建脚本">
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => openForm({ type: 'script-create', groupId: group.id })}
                    />
                  </Tooltip>
                  <Tooltip title="编辑分组">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openForm({ type: 'group-edit', group })}
                    />
                  </Tooltip>
                  <Tooltip title="删除分组">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteGroup(group)}
                    />
                  </Tooltip>
                </Space>
              )
            })}
            {renderGroupRow('__ungrouped__', '未分组', grouped.get(null) ?? [], null)}
          </>
        )}
      </div>
    </div>
  )
}
