import { useEffect, useState } from 'react'
import { Button, Segmented, Space, Typography } from 'antd'
import { EditOutlined, FileTextOutlined, SettingOutlined } from '@ant-design/icons'
import type { ThemeMode } from '../../shared/types'
import { ThemeProvider, useTheme } from './theme/provider'
import { Sidebar } from './components/Sidebar'
import { ScriptFormModal } from './components/ScriptFormModal'
import { GroupFormModal } from './components/GroupFormModal'
import { SettingsModal } from './components/SettingsModal'
import { ScriptEditor } from './components/ScriptEditor'
import { TerminalDock } from './components/TerminalDock'
import { useAppStore } from './store/useAppStore'

/** 牌子标记,与 build/icon.png 同源:青色提示符 + 白色光标块 */
function BrandMark(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M5 6.5 L11.5 12 L5 17.5"
        stroke="#4FD1E0"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="13.6" y="13.4" width="6.2" height="4" rx="1.3" fill="#FFFFFF" fillOpacity="0.92" />
    </svg>
  )
}

function TopBar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const { mode, setMode } = useTheme()
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.info().then((info) => setVersion(info.version))
  }, [])

  return (
    <div
      className="app-topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '0 14px',
        height: 46,
        flex: '0 0 auto'
      }}
    >
      <Space size={8} align="center">
        <BrandMark />
        <Typography.Text style={{ fontSize: 13, fontWeight: 500, color: 'var(--app-topbar-text)', letterSpacing: 0.2 }}>
          EasyOps
        </Typography.Text>
        {version ? (
          <span
            style={{
              fontSize: 11,
              lineHeight: '16px',
              padding: '1px 6px',
              borderRadius: 6,
              color: 'var(--app-topbar-muted)',
              border: '1px solid var(--app-topbar-control-border)'
            }}
          >
            v{version}
          </span>
        ) : null}
      </Space>

      <Space size={8}>
        <Segmented
          size="small"
          className="app-topbar-segmented"
          value={mode}
          onChange={(value) => setMode(value as ThemeMode)}
          options={[
            { label: '浅色', value: 'light' },
            { label: '深色', value: 'dark' },
            { label: '跟随系统', value: 'system' }
          ]}
        />
        <Button
          size="small"
          className="app-topbar-btn"
          icon={<SettingOutlined />}
          onClick={onOpenSettings}
        >
          设置
        </Button>
      </Space>
    </div>
  )
}

function ScriptDetail(): JSX.Element {
  const selectedScriptId = useAppStore((s) => s.selectedScriptId)
  const scripts = useAppStore((s) => s.scripts)
  const openForm = useAppStore((s) => s.openForm)
  const selected = scripts.find((s) => s.id === selectedScriptId) ?? null

  if (!selected) {
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
        <FileTextOutlined style={{ fontSize: 26, opacity: 0.35 }} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          选择左上角的脚本,这里会显示它的内容
        </Typography.Text>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flex: '0 0 auto'
        }}
      >
        <Typography.Text ellipsis style={{ fontSize: 14, fontWeight: 500, minWidth: 0 }}>
          {selected.name}
        </Typography.Text>
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => openForm({ type: 'script-edit', script: selected })}
        >
          编辑
        </Button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ScriptEditor value={selected.content} readOnly height="100%" />
      </div>
    </div>
  )
}

function Workspace(): JSX.Element {
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 8, padding: 8 }}>
      {/* 左半:上脚本列表 / 下脚本详情 */}
      <div
        style={{
          flex: '0 0 50%',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 0,
          minHeight: 0
        }}
      >
        <div className="app-panel" style={{ flex: '0 0 60%', minHeight: 0, padding: 12, overflow: 'hidden' }}>
          <Sidebar />
        </div>
        <div className="app-panel" style={{ flex: 1, padding: 14, overflow: 'hidden', minHeight: 0 }}>
          <ScriptDetail />
        </div>
      </div>
      {/* 右半:终端列表 */}
      <div
        className="app-panel"
        style={{ flex: 1, minWidth: 0, minHeight: 0, padding: '10px 10px 10px', overflow: 'hidden' }}
      >
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: '100%',
          background: 'var(--app-layout-bg)'
        }}
      >
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <Workspace />
      </div>
      <GroupFormModal />
      <ScriptFormModal />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ThemeProvider>
  )
}
