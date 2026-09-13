import { useEffect, useState } from 'react'
import { Segmented, Space, Typography } from 'antd'
import type { ThemeMode } from '../../shared/types'
import { ThemeProvider, useTheme } from './theme/provider'
import { Sidebar } from './components/Sidebar'
import { ScriptFormModal } from './components/ScriptFormModal'
import { GroupFormModal } from './components/GroupFormModal'

function TopBar(): JSX.Element {
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
        borderBottom: '1px solid rgba(5,5,5,0.06)'
      }}
    >
      <Typography.Text strong>EasyOps v{version}</Typography.Text>
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
    </div>
  )
}

function Workspace(): JSX.Element {
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <aside style={{ width: 320, borderRight: '1px solid rgba(5,5,5,0.06)', padding: 12, overflow: 'hidden' }}>
        <Sidebar />
      </aside>
      <main style={{ flex: 1, padding: 16 }}>
        <Typography.Text type="secondary">从左侧选择一个脚本查看详情</Typography.Text>
      </main>
    </div>
  )
}

export default function App(): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    window.api.settings.get().then((s) => setMode(s.theme))
  }, [])

  const handleModeChange = (next: ThemeMode): void => {
    setMode(next)
    void window.api.settings.update({ theme: next })
  }

  return (
    <ThemeProvider mode={mode} onModeChange={handleModeChange}>
      <Space direction="vertical" size={0} style={{ height: '100vh', width: '100%' }}>
        <TopBar />
        <Workspace />
      </Space>
      <GroupFormModal />
      <ScriptFormModal />
    </ThemeProvider>
  )
}
