import { useCallback, useRef, useState } from 'react'
import { App, Badge, Button, Tag, Tooltip, Typography } from 'antd'
import { CloseOutlined, CodeOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons'
import { terminalActions, useTerminalStore } from '../store/useTerminalStore'
import { usePtyEvents } from '../hooks/usePtyEvents'
import { TerminalView } from './TerminalView'
import { toUserMessage } from '../utils/toUserMessage'

/** 卡片固定高度,终端多了整体纵向滚动 */
const CARD_HEIGHT = 340

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
    // 会话已关闭后的迟到 chunk 直接丢弃,避免为死 runId 建无人清理的 pending 缓冲
    if (!useTerminalStore.getState().sessions.some((s) => s.runId === runId)) return
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
      message.error(toUserMessage(err))
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
      message.error(toUserMessage(err))
      return
    }
    writers.current.clear()
    buffers.current.clear()
    useTerminalStore.setState({ sessions: [], activeRunId: null, maximizedRunId: null })
    forceRender((n) => n + 1)
  }

  if (sessions.length === 0) {
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
        <CodeOutlined style={{ fontSize: 26, opacity: 0.35 }} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          还没有运行中的终端,在左上角的脚本上点「执行」
        </Typography.Text>
      </div>
    )
  }

  const isMaximized = maximizedRunId !== null

  return (
    // 最大化与列表共用同一棵树(卡片始终在同一位置、同一 key,只换 style),
    // 避免 React 按位置协调导致 TerminalView 卸载重挂、xterm 滚动缓冲丢失
    <div
      style={
        isMaximized
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              background: 'var(--color-bg-base, #fff)',
              display: 'flex',
              flexDirection: 'column',
              padding: 10
            }
          : { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: isMaximized ? '0 0 8px' : '0 2px 8px',
          flex: '0 0 auto'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: 'var(--app-primary)',
              display: 'inline-block'
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {sessions.length} 个终端
          </Typography.Text>
        </span>
        <Button type="text" size="small" danger onClick={() => void handleCloseAll()}>
          关闭全部
        </Button>
      </div>

      <div
        data-testid="terminal-list"
        style={
          isMaximized
            ? { flex: 1, minHeight: 0, overflow: 'auto' }
            : {
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                display: 'grid',
                // 单列纵向排布:卡片占满宽度,从上往下流,整列可滚动
                gridTemplateColumns: '1fr',
                gridAutoRows: `${CARD_HEIGHT}px`,
                alignContent: 'start',
                gap: 10
              }
        }
      >
        {sessions.map((s) => {
          const cardMaximized = s.runId === maximizedRunId
          const isActive = s.runId === activeRunId
          return (
            <div
              key={s.runId}
              style={{
                // 最大化时其余卡片隐藏但不卸载,xterm 状态得以保留
                display: isMaximized && !cardMaximized ? 'none' : 'flex',
                flexDirection: 'column',
                minWidth: 0,
                height: isMaximized ? '100%' : undefined,
                border: '1px solid var(--app-hairline)',
                borderRadius: isMaximized ? 0 : 'var(--app-radius-lg)',
                overflow: 'hidden',
                background: 'var(--color-bg-container)',
                // 用 inset 阴影标出「输入会落到这个终端」,不影响布局
                boxShadow: isActive && !cardMaximized ? 'inset 2px 0 0 0 var(--app-primary)' : undefined
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 4px 5px 10px',
                  borderBottom: '1px solid var(--app-hairline)',
                  background: 'var(--app-subtle-bg)',
                  flex: '0 0 auto'
                }}
              >
                <Typography.Text
                  strong
                  ellipsis
                  style={{ fontSize: 12, flex: 1, minWidth: 0 }}
                  title={s.title}
                >
                  {s.title}
                </Typography.Text>
                {s.exited ? (
                  <Tag style={{ marginInlineEnd: 0 }}>退出 {s.exitCode ?? 0}</Tag>
                ) : (
                  <Badge status="processing" />
                )}
                <Tooltip title={cardMaximized ? '还原' : '最大化'}>
                  <Button
                    type="text"
                    size="small"
                    icon={cardMaximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                    onClick={() => terminalActions.setMaximized(s.runId, !cardMaximized)}
                  />
                </Tooltip>
                <Tooltip title="关闭此终端">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<CloseOutlined />}
                    onClick={() => void handleClose(s.runId)}
                  />
                </Tooltip>
              </div>
              <div
                style={{ flex: 1, minHeight: 0, padding: 4 }}
                onClick={() => terminalActions.setActive(s.runId)}
              >
                <TerminalView
                  runId={s.runId}
                  active={isActive}
                  onRegisterWriter={registerWriter}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
