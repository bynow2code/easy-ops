import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { App, Button, Input, List, Modal, Space, Switch, Tag, Typography } from 'antd'
import { DeleteOutlined, ExportOutlined, FolderOpenOutlined, HistoryOutlined, ImportOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ShellInfo } from '../../../shared/types'
import { UpdatePanel } from './UpdatePanel'
import { useTheme } from '../theme/provider'
import { useAppStore } from '../store/useAppStore'
import { buildCustomShell } from '../settings/shellOverride'
import { toUserMessage } from '../utils/toUserMessage'

interface AppInfo {
  version: string
  repo: string
  platform: string
}

/** 分节:替代原来靠 Divider 平铺的一长条,给设置面板建立层次 */
function Section({
  title,
  extra,
  children
}: {
  title: string
  extra?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="app-section">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10
        }}
      >
        <span className="app-section-title">{title}</span>
        {extra}
      </div>
      {children}
    </section>
  )
}

/** 左标签右内容的一行 */
function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 24 }}>
      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', flex: '0 0 auto' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

const accentTagStyle = {
  marginInlineEnd: 0,
  background: 'var(--app-accent-soft)',
  color: 'var(--app-accent-text)',
  border: 'none'
} as const

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { message, modal } = App.useApp()
  // 主题切换只在顶栏;这里保留 setMode 是因为导入配置后要把新的主题同步过来
  const { setMode } = useTheme()
  const reloadScripts = useAppStore((s) => s.reload)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null)
  const [checkOnLaunch, setCheckOnLaunch] = useState(true)
  const [customPath, setCustomPath] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshShells = useCallback(async () => {
    const list = await window.api.shell.detect()
    setShells(list)
    return list
  }, [])

  // 导入会整份覆盖脚本/分组/设置,加载逻辑必须可复用,否则界面会停在导入前的状态
  const loadAll = useCallback(async () => {
    const [appInfo, settings, list] = await Promise.all([
      window.api.app.info(),
      window.api.settings.get(),
      refreshShells()
    ])
    setInfo(appInfo)
    setSelectedShellId(settings.shellId ?? list[0]?.id ?? null)
    setCheckOnLaunch(settings.checkUpdateOnLaunch)
  }, [refreshShells])

  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        await loadAll()
      } catch (err) {
        message.error(toUserMessage(err))
      }
    })()
  }, [open, loadAll, message])

  // 导入改写的是磁盘与主进程设置:全局 store 的 reload 只刷新侧边栏,
  // 本面板的本地 state(主题/开关/覆盖列表)必须重新拉一次才会跟上
  const syncAfterImport = useCallback(async () => {
    try {
      await reloadScripts()
      const settings = await window.api.settings.get()
      setMode(settings.theme)
      await loadAll()
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }, [reloadScripts, loadAll, setMode, message])

  const handleOpenRepo = async (): Promise<void> => {
    if (!info) return
    try {
      await window.api.app.openExternal(info.repo)
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }

  const handleRefreshShells = async (): Promise<void> => {
    try {
      await refreshShells()
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }

  // 添加并校验:优先用显式传入的路径(浏览选完直接进这里),否则用输入框里手填的
  const handleAddCustom = async (picked?: string): Promise<void> => {
    // busy 防抖:没有「添加」按钮的 loading 阻断了,回车/连点浏览期间不允许并发校验
    if (busy) return
    const target = (picked ?? customPath).trim()
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
      message.error(toUserMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // 浏览:文件对话框确认后即添加并校验,不再有单独的「添加」按钮
  const handlePickPath = async (): Promise<void> => {
    try {
      const picked = await window.api.shell.browse()
      if (!picked) return
      // 先回显,校验失败时用户能看到刚才选的是什么
      setCustomPath(picked)
      await handleAddCustom(picked)
    } catch (err) {
      message.error(toUserMessage(err))
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
      message.error(toUserMessage(err))
    }
  }

  const handleSelectShell = async (id: string): Promise<void> => {
    try {
      const saved = await window.api.settings.update({ shellId: id })
      setSelectedShellId(saved.shellId)
      message.success('已切换默认 shell,对之后新开的终端生效')
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }

  const handleToggleCheckOnLaunch = async (checked: boolean): Promise<void> => {
    try {
      const saved = await window.api.settings.update({ checkUpdateOnLaunch: checked })
      setCheckOnLaunch(saved.checkUpdateOnLaunch)
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }

  const handleExport = async (): Promise<void> => {
    try {
      const result = await window.api.config.export()
      if (!result.canceled) message.success(`已导出到 ${result.path}`)
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }

  const reportStats = (stats?: { imported: number; groups: number; warnings: string[] }): void => {
    if (!stats) return
    if (stats.warnings.length > 0) {
      modal.info({
        title: '导入完成(含警告)',
        content: (
          <div>
            <p>
              导入脚本 {stats.imported} 个、分组 {stats.groups} 个。
            </p>
            <ul>
              {stats.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )
      })
    } else {
      message.success(`导入完成:脚本 ${stats.imported} 个、分组 ${stats.groups} 个`)
    }
  }

  const handleImportV2 = async (): Promise<void> => {
    const applied = await new Promise<boolean>((resolve) => {
      modal.confirm({
        centered: true,
        title: '导入配置',
        content: '导入会覆盖当前全部脚本与分组,确定继续吗?',
        okText: '覆盖导入',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!applied) return
    try {
      const result = await window.api.config.import('v2')
      if (!result.canceled) reportStats(result.stats)
    } catch (err) {
      message.error(toUserMessage(err))
    } finally {
      await syncAfterImport()
    }
  }

  const handleImportLegacy = async (): Promise<void> => {
    const applied = await new Promise<boolean>((resolve) => {
      modal.confirm({
        centered: true,
        title: '导入旧版配置',
        content:
          '导入会覆盖当前全部脚本与分组。请先退出旧版 EasyOps,避免两边同时写入数据;点击「开始导入」后选择旧版导出的 JSON,或选择旧版数据目录下的 scripts.json。',
        okText: '开始导入',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!applied) return
    try {
      const result = await window.api.config.import('legacy')
      if (!result.canceled) reportStats(result.stats)
    } catch (err) {
      message.error(toUserMessage(err))
    } finally {
      await syncAfterImport()
    }
  }

  return (
    <Modal
      open={open}
      centered
      onCancel={onClose}
      footer={null}
      width={720}
      title="设置"
      // body 限高 + 纵向滚动:Shell 列表长度无上限(检测到的 + 自定义的),内容一多
      // 弹窗会被撑出窗口高度且底部够不着;预算 = 顶部留白 100 + 标题栏 ~57 + body 上下 padding 48,再留余量
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Section title="关于">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Row label="版本">
              <Typography.Text style={{ fontSize: 13 }}>v{info?.version ?? '—'}</Typography.Text>
            </Row>
            <Row label="Git 仓库">
              <Typography.Link style={{ fontSize: 13 }} onClick={() => void handleOpenRepo()}>
                {info?.repo ?? '—'}
              </Typography.Link>
            </Row>
          </Space>
        </Section>

        <Section title="更新">
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Row label="启动时检查更新">
              <Switch size="small" checked={checkOnLaunch} onChange={handleToggleCheckOnLaunch} />
            </Row>
            <UpdatePanel />
          </Space>
        </Section>

        <Section title="配置">
          <Space wrap size={8}>
            <Button icon={<ExportOutlined />} onClick={() => void handleExport()}>
              导出当前配置
            </Button>
            <Button icon={<ImportOutlined />} onClick={() => void handleImportV2()}>
              导入配置
            </Button>
            <Button icon={<HistoryOutlined />} onClick={() => void handleImportLegacy()}>
              导入旧版配置
            </Button>
          </Space>
        </Section>

        <Section
          title="Shell"
          extra={
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => void handleRefreshShells()}>
              重新检测
            </Button>
          }
        >
          <List
            size="small"
            className="app-list-flat"
            dataSource={shells}
            renderItem={(shell) => (
              <List.Item
                actions={[
                  selectedShellId === shell.id ? (
                    <Tag key="active" style={accentTagStyle}>
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
                      <span style={{ fontSize: 13 }}>{shell.name}</span>
                      <Tag style={{ marginInlineEnd: 0 }}>{shell.source === 'custom' ? '自定义' : '检测到'}</Tag>
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

          <Space.Compact style={{ width: '100%', marginTop: 10 }}>
            <Input
              value={customPath}
              placeholder="自定义 shell 路径,回车添加,或点「浏览」选择"
              onChange={(e) => setCustomPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddCustom()
              }}
            />
            <Button icon={<FolderOpenOutlined />} loading={busy} onClick={() => void handlePickPath()}>
              浏览
            </Button>
          </Space.Compact>
        </Section>
      </div>
    </Modal>
  )
}
