import { useEffect, useState } from 'react'
import { App, Button, Progress, Space, Typography } from 'antd'

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'latest' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

export function UpdatePanel(): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })

  useEffect(() => {
    const off = window.api.update.onEvent((raw) => {
      const event = raw as { status: string; version?: string; percent?: number; message?: string }
      switch (event.status) {
        case 'checking':
          setState({ kind: 'checking' })
          break
        case 'available':
          setState({ kind: 'available', version: event.version ?? '' })
          break
        case 'not-available':
          setState({ kind: 'latest' })
          break
        case 'downloading':
          setState({ kind: 'downloading', percent: event.percent ?? 0 })
          break
        case 'downloaded':
          setState({ kind: 'downloaded', version: event.version ?? '' })
          break
        case 'error':
          setState({ kind: 'error', message: event.message ?? '未知错误' })
          break
        default:
          break
      }
    })
    return off
  }, [])

  const handleCheck = async (): Promise<void> => {
    setState({ kind: 'checking' })
    try {
      await window.api.update.check()
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDownload = async (): Promise<void> => {
    setState({ kind: 'downloading', percent: 0 })
    try {
      await window.api.update.download()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleInstall = async (): Promise<void> => {
    try {
      await window.api.update.install()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Space>
        <Button size="small" onClick={() => void handleCheck()} loading={state.kind === 'checking'}>
          检查更新
        </Button>

        {state.kind === 'available' ? (
          <Button size="small" type="primary" onClick={() => void handleDownload()}>
            下载 v{state.version}
          </Button>
        ) : null}

        {state.kind === 'downloaded' ? (
          <Button size="small" type="primary" onClick={() => void handleInstall()}>
            重启并安装 v{state.version}
          </Button>
        ) : null}
      </Space>

      {state.kind === 'latest' ? <Typography.Text type="secondary">当前已是最新版本</Typography.Text> : null}

      {state.kind === 'downloading' ? <Progress percent={state.percent} size="small" /> : null}

      {state.kind === 'error' ? <Typography.Text type="danger">{state.message}</Typography.Text> : null}
    </Space>
  )
}
