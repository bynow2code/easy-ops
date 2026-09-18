import { useEffect, useState } from 'react'
import { Button, Segmented, Space, Typography } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import type { ThemeMode } from '../../shared/types'
import { ThemeProvider, useTheme } from './theme/provider'
import { Sidebar } from './components/Sidebar'
import { ScriptFormModal } from './components/ScriptFormModal'
import { GroupFormModal } from './components/GroupFormModal'
import { SettingsModal } from './components/SettingsModal'
import { ScriptEditor } from './components/ScriptEditor'
import { TerminalDock } from './components/TerminalDock'
import { useAppStore } from './store/useAppStore'

function TopBar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const { mode, setMode } = useTheme()
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.info().then((info) => setVersion(info.version))
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border-secondary)'
      }}
    >
      <Typography.Text strong>EasyOps v{version}</Typography.Text>
      <Space>
        <Segmented
          size="small"
          value={mode}
          onChange={(value) => setMode(value as ThemeMode)}
          options={[
            { label: '浅色', value: 'light' },
            { label: '深色', value: 'dark' },
            { label: '跟随系统', value: 'system' }
          ]}
        />
        <Button size="small" icon={<SettingOutlined />} onClick={onOpenSettings}>
          设置
        </Button>
      </Space>
    </div>
  )
}

function Workspace(): JSX.Element {
  const selectedScriptId = useAppStore((s) => s.selectedScriptId)
  const scripts = useAppStore((s) => s.scripts)
  const openForm = useAppStore((s) => s.openForm)
  const selected = scripts.find((s) => s.id === selectedScriptId) ?? null

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* 左半:上脚本列表 / 下脚本详情 */}
      <div
        style={{
          flex: '0 0 50%',
          borderRight: '1px solid var(--color-border-secondary)',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0
        }}
      >
        <div style={{ flex: '0 0 60%', minHeight: 0, padding: 12, overflow: 'hidden' }}>
          <Sidebar />
        </div>
        <div
          style={{
            flex: 1,
            borderTop: '1px solid var(--color-border-secondary)',
            padding: 16,
            overflow: 'auto',
            minHeight: 0
          }}
        >
          {selected ? (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Space>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  {selected.name}
                </Typography.Title>
                <Button size="small" onClick={() => openForm({ type: 'script-edit', script: selected })}>
                  编辑
                </Button>
              </Space>
              <ScriptEditor value={selected.content} readOnly height="220px" />
            </Space>
          ) : (
            <Typography.Text type="secondary">从左上选择一个脚本查看详情</Typography.Text>
          )}
        </div>
      </div>
      {/* 右半:终端瀑布流 */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <TerminalDock />
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>('system')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((s) => setMode(s.theme))
  }, [])

  const handleModeChange = (next: ThemeMode): void => {
    setMode(next)
    void window.api.settings.update({ theme: next })
  }

  return (
    <ThemeProvider mode={mode} onModeChange={handleModeChange}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <Workspace />
      </div>
      <GroupFormModal />
      <ScriptFormModal />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ThemeProvider>
  )
}
