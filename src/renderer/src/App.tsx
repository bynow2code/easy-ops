import { useEffect, useState } from 'react'
import { Segmented, Space, Typography } from 'antd'
import type { ThemeMode } from '../../shared/types'
import { ThemeProvider, useTheme } from './theme/provider'

function ThemeSwitch(): JSX.Element {
  const { mode, setMode } = useTheme()
  return (
    <Segmented
      value={mode}
      onChange={(value) => setMode(value as ThemeMode)}
      options={[
        { label: '浅色', value: 'light' },
        { label: '深色', value: 'dark' },
        { label: '跟随系统', value: 'system' }
      ]}
    />
  )
}

function Shell(): JSX.Element {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.info().then((info) => setVersion(info.version))
  }, [])

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large">
        <Typography.Title level={4} style={{ margin: 0 }}>
          EasyOps v{version}
        </Typography.Title>
        <ThemeSwitch />
      </Space>
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
      <Shell />
    </ThemeProvider>
  )
}
