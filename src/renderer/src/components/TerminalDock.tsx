import { useCallback, useMemo, useRef, useState } from 'react'
import { App, Badge, Button, Empty, Space, Tag, Tooltip, Typography } from 'antd'
import { CloseOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons'
import { terminalActions, useTerminalStore } from '../store/useTerminalStore'
import { usePtyEvents } from '../hooks/usePtyEvents'
import { TerminalView } from './TerminalView'

export function TerminalDock(): JSX.Element {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeRunId = useTerminalStore((s) => s.activeRunId)
  const maximizedRunId = useTerminalStore((s) => s.maximizedRunId)
  const { message } = App.useApp()

  const writers = useRef(new Map<string, (chunk: string) => void>())
  const buffers = useRef(new Map<string, string[]>())
  const [, forceRender] = useState(0)

  const registerWriter = useCallback((runId: string, writer: (chunk: string) => void) => {
    writers.current.set(runId, writer)
    const pending = buffers.current.get(runId)
    if (pending && pending.length > 0) {
      pending.forEach((chunk) => writer(chunk))
      buffers.current.delete(runId)
    }
  }, [])

  usePtyEvents((runId, chunk) => {
    const writer = writers.current.get(runId)
    if (writer) {
      writer(chunk)
      return
    }
    const pending = buffers.current.get(runId) ?? []
    pending.push(chunk)
    buffers.current.set(runId, pending)
  })

  const handleClose = async (runId: string): Promise<void> => {
    try {
      await window.api.pty.close(runId)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
      return
    }
    writers.current.delete(runId)
    buffers.current.delete(runId)
    terminalActions.remove(runId)
    forceRender((n) => n + 1)
  }

  const handleCloseAll = async (): Promise<void> => {
    try {
      await window.api.pty.closeAll()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
      return
    }
    writers.current.clear()
    buffers.current.clear()
    useTerminalStore.setState({ sessions: [], activeRunId: null, maximizedRunId: null })
    forceRender((n) => n + 1)
  }

  const activeSession = useMemo(
    () => sessions.find((s) => s.runId === activeRunId) ?? null,
    [sessions, activeRunId]
  )

  if (sessions.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="还没有运行中的终端,在左侧脚本上点击「执行」" />
      </div>
    )
  }

  const isMaximized = maximizedRunId !== null

  const tabBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
      {sessions.map((s) => (
        <Tag.CheckableTag
          key={s.runId}
          checked={s.runId === activeRunId}
          onChange={() => terminalActions.setActive(s.runId)}
          style={{ cursor: 'pointer', marginInlineEnd: 0 }}
        >
          <Space size={4}>
            <span>{s.title}</span>
            {s.exited ? <Badge status="default" text={`退出 ${s.exitCode ?? 0}`} /> : <Badge status="processing" />}
          </Space>
        </Tag.CheckableTag>
      ))}
      <Button size="small" onClick={() => void handleCloseAll()} danger>
        关闭全部
      </Button>
    </div>
  )

  const activePanel = activeSession ? (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderBottom: '1px solid rgba(5,5,5,0.06)'
        }}
      >
        <Typography.Text strong style={{ fontSize: 12 }}>
          {activeSession.title}
        </Typography.Text>
        <Space size={2}>
          <Tooltip title={isMaximized ? '还原' : '最大化'}>
            <Button
              type="text"
              size="small"
              icon={isMaximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() => terminalActions.setMaximized(activeSession.runId, !isMaximized)}
            />
          </Tooltip>
          <Tooltip title="关闭此终端">
            <Button
              type="text"
              size="small"
              danger
              icon={<CloseOutlined />}
              onClick={() => void handleClose(activeSession.runId)}
            />
          </Tooltip>
        </Space>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 4 }}>
        {sessions.map((s) => (
          <div
            key={s.runId}
            style={{
              height: '100%',
              display: s.runId === activeSession.runId ? 'block' : 'none'
            }}
          >
            <TerminalView runId={s.runId} active={s.runId === activeSession.runId} onRegisterWriter={registerWriter} />
          </div>
        ))}
      </div>
    </div>
  ) : null

  if (isMaximized) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'var(--easyops-terminal-bg, #fff)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {tabBar}
        {activePanel}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {tabBar}
      <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid rgba(5,5,5,0.06)' }}>{activePanel}</div>
    </div>
  )
}
