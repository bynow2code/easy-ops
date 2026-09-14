import { useEffect, useMemo } from 'react'
import { App, Button, Empty, Input, Space, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, FolderAddOutlined, PlayCircleOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { Group, Script } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { terminalActions } from '../store/useTerminalStore'
import { toUserMessage } from '../utils/toUserMessage'

function matches(script: Script, keyword: string): boolean {
  if (!keyword) return true
  const k = keyword.toLowerCase()
  return script.name.toLowerCase().includes(k) || script.content.toLowerCase().includes(k)
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

  const renderScript = (script: Script): JSX.Element => (
    <div
      key={script.id}
      onClick={() => selectScript(script.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        background: selectedScriptId === script.id ? 'var(--color-control-item-bg-active)' : 'transparent'
      }}
    >
      <Typography.Text
        ellipsis={{ tooltip: script.name }}
        style={{ flex: 1, fontSize: 13, fontWeight: selectedScriptId === script.id ? 500 : 400 }}
      >
        {script.name}
      </Typography.Text>
      <Space size={2}>
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
      </Space>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索脚本"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <Space>
        <Button icon={<PlusOutlined />} onClick={() => openForm({ type: 'script-create', groupId: null })}>
          新建脚本
        </Button>
        <Button icon={<FolderAddOutlined />} onClick={() => openForm({ type: 'group-create' })}>
          新建分组
        </Button>
      </Space>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {groups.map((group) => {
          const items = grouped.get(group.id) ?? []
          return (
            <div key={group.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Space size={6}>
                  <Typography.Text strong style={{ fontSize: 12 }}>
                    {group.name}
                  </Typography.Text>
                  <Tag style={{ marginInlineEnd: 0 }}>{items.length}</Tag>
                </Space>
                <Space size={2}>
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
        })}

        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong style={{ fontSize: 12 }}>
            未分组
          </Typography.Text>
          <div style={{ marginTop: 4 }}>
            {(grouped.get(null) ?? []).length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: 8 }}>
                暂无脚本
              </Typography.Text>
            ) : (
              (grouped.get(null) ?? []).map(renderScript)
            )}
          </div>
        </div>

        {scripts.length === 0 ? <Empty description="还没有脚本,点击上方「新建脚本」开始" /> : null}
      </div>
    </div>
  )
}
