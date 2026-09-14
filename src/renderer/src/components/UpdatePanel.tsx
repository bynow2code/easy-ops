import { useEffect, useState } from 'react'
import { App, Button, Progress, Space, Typography } from 'antd'
import { toUserMessage } from '../utils/toUserMessage'

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'latest' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

function toUpdateState(raw: unknown): UpdateState | null {
  const event = raw as { status: string; version?: string; percent?: number; message?: string }
  switch (event.status) {
    case 'checking':
      return { kind: 'checking' }
    case 'available':
      return { kind: 'available', version: event.version ?? '' }
    case 'not-available':
      return { kind: 'latest' }
    case 'downloading':
      return { kind: 'downloading', percent: event.percent ?? 0 }
    case 'downloaded':
      return { kind: 'downloaded', version: event.version ?? '' }
    case 'error':
      return { kind: 'error', message: event.message ?? '未知错误' }
    default:
      return null
  }
}

export function UpdatePanel(): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })

  useEffect(() => {
    // 设置面板挂在 antd Modal 里,首次打开前 children 不渲染,启动时(3s 后)推送的事件会丢。
    // 因此挂载后回放主进程缓存的最近一次事件。顺序是「先订阅、后取快照」:ipcRenderer.on 同步生效,
    // 取快照(异步 invoke)期间到达的增量事件一定已被接收,不会漏;而快照只在还没有收到过增量事件时
    // 才应用,保证新结果不被旧缓存覆盖。
    let gotLiveEvent = false
    const off = window.api.update.onEvent((raw) => {
      gotLiveEvent = true
      const next = toUpdateState(raw)
      if (next) setState(next)
    })

    void window.api.update.lastEvent().then((raw) => {
      if (gotLiveEvent || raw == null) return
      const next = toUpdateState(raw)
      if (next) setState(next)
    })

    return off
  }, [])

  const handleCheck = async (): Promise<void> => {
    setState({ kind: 'checking' })
    try {
      await window.api.update.check()
    } catch (err) {
      setState({ kind: 'error', message: toUserMessage(err) })
      message.error(toUserMessage(err))
    }
  }

  const handleDownload = async (): Promise<void> => {
    setState({ kind: 'downloading', percent: 0 })
    try {
      await window.api.update.download()
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }

  const handleInstall = async (): Promise<void> => {
    try {
      await window.api.update.install()
    } catch (err) {
      message.error(toUserMessage(err))
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
