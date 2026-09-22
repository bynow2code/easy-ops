import { useCallback, useRef } from 'react'
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
    // 先从 store 移除会话,再清 writer/缓冲:两步之间到达的迟到 chunk
    // 会被上方「会话不存在」检查直接丢弃,不会重建无主的 pending 缓冲
    terminalActions.remove(runId)
    writers.current.delete(runId)
    buffers.current.delete(runId)
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
                // 激活态不在卡片层留任何视觉标记,多开终端时卡片长得全一样(用户决策:xterm 的光标就够了)。
                // ⚠️ activeRunId 与「光标在闪」不是同一个信号:前者是 store 里的逻辑态,只有它落到那一个
                // xterm 持有 DOM 焦点时才表现为闪烁。焦点落到卡片头部(标题/最大化/关闭)或工具栏时,
                // 界面上就没有任何激活线索了 —— 这是有意接受的取舍,不是遗漏。
                // isActive 必须继续往下传:它触发 TerminalView 的 term.focus(),是光标闪烁的唯一来源
                border: '1px solid var(--app-hairline)',
                borderRadius: isMaximized ? 0 : 'var(--app-radius-lg)',
                overflow: 'hidden',
                background: 'var(--color-bg-container)'
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
                  // 运行中 = 苹果绿静点(替代 antd processing 蓝色脉冲灯,和整体风格解绑)
                  <Badge color="#34C759" />
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
