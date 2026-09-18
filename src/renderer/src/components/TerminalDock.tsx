import { useCallback, useRef, useState } from 'react'
import { App, Badge, Button, Empty, Tag, Tooltip, Typography } from 'antd'
import { CloseOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons'
import { terminalActions, useTerminalStore } from '../store/useTerminalStore'
import { usePtyEvents } from '../hooks/usePtyEvents'
import { TerminalView } from './TerminalView'
import { toUserMessage } from '../utils/toUserMessage'

/** 瀑布流的最小列宽;容器不够宽时 CSS 会自动退化成单列 */
const GRID_MIN_COLUMN = 360
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="还没有运行中的终端,在左侧脚本上点击「执行」" />
      </div>
    )
  }

  const isMaximized = maximizedRunId !== null

  return (
    // 最大化与瀑布流共用同一棵树(卡片始终在同一位置、同一 key,只换 style),
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
              flexDirection: 'column'
            }
          : { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          flex: '0 0 auto'
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {sessions.length} 个终端
        </Typography.Text>
        <Button size="small" danger onClick={() => void handleCloseAll()}>
          关闭全部
        </Button>
      </div>

      <div
        style={
          isMaximized
            ? { flex: 1, minHeight: 0, overflow: 'auto' }
            : {
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_MIN_COLUMN}px, 1fr))`,
                gridAutoRows: `${CARD_HEIGHT}px`,
                alignContent: 'start',
                gap: 8,
                padding: 8
              }
        }
      >
        {sessions.map((s) => {
          const cardMaximized = s.runId === maximizedRunId
          return (
            <div
              key={s.runId}
              style={{
                // 最大化时其余卡片隐藏但不卸载,xterm 状态得以保留
                display: isMaximized && !cardMaximized ? 'none' : 'flex',
                flexDirection: 'column',
                minWidth: 0,
                height: isMaximized ? '100%' : undefined,
                border: '1px solid var(--color-border-secondary)',
                borderRadius: isMaximized ? 0 : 8,
                overflow: 'hidden',
                background: 'var(--color-bg-container, #fff)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px 4px 10px',
                  borderBottom: '1px solid var(--color-border-secondary)',
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
                  active={s.runId === activeRunId}
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
