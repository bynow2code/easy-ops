import { useCallback, useEffect, useState } from 'react'
import { App, Button, Divider, Input, List, Modal, Select, Space, Switch, Tag, Typography } from 'antd'
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { Script, ShellInfo } from '../../../shared/types'
import { useTheme } from '../theme/provider'
import { useAppStore } from '../store/useAppStore'
import {
  buildCustomShell,
  buildOverrideOptions,
  globalShellLabel,
  resolveScriptOverride,
  toShellIdPatch
} from '../settings/shellOverride'

interface AppInfo {
  version: string
  repo: string
  platform: string
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { message } = App.useApp()
  const { mode, setMode } = useTheme()
  const reloadScripts = useAppStore((s) => s.reload)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null)
  const [scripts, setScripts] = useState<Script[]>([])
  const [checkOnLaunch, setCheckOnLaunch] = useState(true)
  const [customPath, setCustomPath] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshShells = useCallback(async () => {
    const list = await window.api.shell.detect()
    setShells(list)
    return list
  }, [])

  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const [appInfo, settings, list, scriptList] = await Promise.all([
          window.api.app.info(),
          window.api.settings.get(),
          refreshShells(),
          window.api.scripts.list()
        ])
        setInfo(appInfo)
        setSelectedShellId(settings.shellId ?? list[0]?.id ?? null)
        setCheckOnLaunch(settings.checkUpdateOnLaunch)
        setScripts(scriptList)
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [open, refreshShells, message])

  const handleOpenRepo = async (): Promise<void> => {
    if (!info) return
    try {
      await window.api.app.openExternal(info.repo)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRefreshShells = async (): Promise<void> => {
    try {
      await refreshShells()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handlePickPath = async (): Promise<void> => {
    try {
      const picked = await window.api.shell.browse()
      if (picked) setCustomPath(picked)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleAddCustom = async (): Promise<void> => {
    const target = customPath.trim()
    if (!target) {
      message.warning('请先选择或填写 shell 路径')
      return
    }
    const entry = buildCustomShell(target)
    if (shells.some((s) => s.id === entry.id)) {
      message.warning('该 shell 已在列表中')
      return
    }
    setBusy(true)
    try {
      const result = await window.api.shell.validate(target)
      if (!result.valid) {
        message.error(`该路径不可用:${result.reason ?? '未知原因'}`)
        return
      }
      const settings = await window.api.settings.get()
      const next = [...settings.customShells.filter((s) => s.id !== entry.id), entry]
      await window.api.settings.update({ customShells: next })
      await refreshShells()
      setCustomPath('')
      message.success('已添加自定义 shell')
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveCustom = async (id: string): Promise<void> => {
    try {
      const settings = await window.api.settings.get()
      await window.api.settings.update({ customShells: settings.customShells.filter((s) => s.id !== id) })
      const list = await refreshShells()
      if (selectedShellId === id) {
        const updated = await window.api.settings.update({ shellId: null })
        setSelectedShellId(updated.shellId ?? list[0]?.id ?? null)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSelectShell = async (id: string): Promise<void> => {
    try {
      const saved = await window.api.settings.update({ shellId: id })
      setSelectedShellId(saved.shellId)
      message.success('已切换默认 shell,对之后新开的终端生效')
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleToggleCheckOnLaunch = async (checked: boolean): Promise<void> => {
    try {
      const saved = await window.api.settings.update({ checkUpdateOnLaunch: checked })
      setCheckOnLaunch(saved.checkUpdateOnLaunch)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleOverrideChange = async (scriptId: string, value: string): Promise<void> => {
    try {
      const updated = await window.api.scripts.update(scriptId, { shellId: toShellIdPatch(value) })
      setScripts((prev) => prev.map((s) => (s.id === scriptId ? updated : s)))
      await reloadScripts()
      message.success(updated.shellId ? `已设置「${updated.name}」使用指定 shell` : `已恢复「${updated.name}」跟随全局`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const followGlobalHint = globalShellLabel(shells, selectedShellId)

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={720} title="设置">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Typography.Text type="secondary">版本</Typography.Text>
          <div>
            <Typography.Text strong>v{info?.version ?? '—'}</Typography.Text>
          </div>
        </div>

        <div>
          <Typography.Text type="secondary">Git 仓库</Typography.Text>
          <div>
            <Typography.Link onClick={() => void handleOpenRepo()}>{info?.repo ?? '—'}</Typography.Link>
          </div>
        </div>

        <div>
          <Typography.Text type="secondary">主题</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Space>
              <Button size="small" type={mode === 'light' ? 'primary' : 'default'} onClick={() => setMode('light')}>
                浅色
              </Button>
              <Button size="small" type={mode === 'dark' ? 'primary' : 'default'} onClick={() => setMode('dark')}>
                深色
              </Button>
              <Button size="small" type={mode === 'system' ? 'primary' : 'default'} onClick={() => setMode('system')}>
                跟随系统
              </Button>
            </Space>
          </div>
        </div>

        <div>
          <Space>
            <Typography.Text type="secondary">启动时检查更新</Typography.Text>
            <Switch size="small" checked={checkOnLaunch} onChange={handleToggleCheckOnLaunch} />
          </Space>
        </div>

        <Divider style={{ margin: '8px 0' }} />

        <Space>
          <Typography.Text strong>Shell</Typography.Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void handleRefreshShells()}>
            重新检测
          </Button>
        </Space>

        <List
          size="small"
          bordered
          dataSource={shells}
          renderItem={(shell) => (
            <List.Item
              actions={[
                selectedShellId === shell.id ? (
                  <Tag color="blue" key="active">
                    当前使用
                  </Tag>
                ) : (
                  <Button key="use" size="small" onClick={() => void handleSelectShell(shell.id)}>
                    使用
                  </Button>
                ),
                shell.source === 'custom' ? (
                  <Button
                    key="remove"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => void handleRemoveCustom(shell.id)}
                  />
                ) : null
              ].filter(Boolean)}
            >
              <List.Item.Meta
                title={
                  <Space size={6}>
                    <span>{shell.name}</span>
                    <Tag>{shell.source === 'custom' ? '自定义' : '检测到'}</Tag>
                  </Space>
                }
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {shell.path}
                    {shell.version ? ` · ${shell.version}` : ''}
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />

        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={customPath}
            placeholder="自定义 shell 路径,例如 /opt/homebrew/bin/zsh"
            onChange={(e) => setCustomPath(e.target.value)}
          />
          <Button icon={<FolderOpenOutlined />} onClick={() => void handlePickPath()}>
            浏览
          </Button>
          <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={() => void handleAddCustom()}>
            添加
          </Button>
        </Space.Compact>

        <Divider style={{ margin: '8px 0' }} />

        <div>
          <Typography.Text strong>脚本 Shell 覆盖</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              默认「跟随全局」{followGlobalHint ? `(当前:${followGlobalHint})` : ''};为脚本单独指定后,该脚本不再跟随上方默认 shell。
            </Typography.Text>
          </div>
          <List
            size="small"
            bordered
            style={{ marginTop: 8 }}
            dataSource={scripts}
            locale={{ emptyText: '暂无脚本' }}
            renderItem={(script) => {
              const override = resolveScriptOverride(
                script,
                shells.map((s) => s.id)
              )
              return (
                <List.Item>
                  <div style={{ width: '100%' }}>
                    <Typography.Text style={{ fontSize: 13 }}>{script.name}</Typography.Text>
                    <div style={{ marginTop: 4 }}>
                      <Space size={6}>
                        <Select
                          size="small"
                          style={{ width: 280 }}
                          value={override.value}
                          options={buildOverrideOptions(shells, script)}
                          onChange={(value) => void handleOverrideChange(script.id, value)}
                        />
                        {override.stale ? <Tag color="warning">指定的 shell 已不可用</Tag> : null}
                      </Space>
                    </div>
                  </div>
                </List.Item>
              )
            }}
          />
        </div>
      </Space>
    </Modal>
  )
}
