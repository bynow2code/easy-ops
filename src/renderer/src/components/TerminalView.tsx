import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '../theme/provider'
import { terminalPalette } from '../theme/tokens'
import { isSignificantResize, terminalSizeChanged, type TerminalBox } from '../utils/terminalFit'

export function TerminalView({
  runId,
  active,
  onRegisterWriter
}: {
  runId: string
  active: boolean
  onRegisterWriter: (runId: string, writer: (chunk: string) => void) => void
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // 上一次 fit 时的容器尺寸:尺寸没变就跳过重排(见下方 ResizeObserver 注释)
  const lastBoxRef = useRef<TerminalBox | null>(null)
  const { resolved } = useTheme()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, 'PingFang SC', monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme: terminalPalette(resolved)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    // 首次 fit 与下方 ResizeObserver 路径同防护:最大化期间新开的会话以 display:none 挂载,
    // 容器尺寸为 0 时 fit 会抛错,渲染层没有 ErrorBoundary,炸了就是整树白屏
    try {
      fit.fit()
      const rect = container.getBoundingClientRect()
      lastBoxRef.current = { width: rect.width, height: rect.height }
    } catch {
      // 尺寸为 0 时跳过;unhide 后 ResizeObserver 会自动重新 fit + resize
    }

    termRef.current = term
    fitRef.current = fit

    onRegisterWriter(runId, (chunk) => term.write(chunk))

    const inputDisposable = term.onData((data) => {
      window.api.pty.write(runId, data).catch(() => {
        // 关闭后迟到的 write rejection 静默丢弃:无用户可恢复动作,弹窗是噪音
      })
    })

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) {
        const box = { width: rect.width, height: rect.height }
        // 尺寸没变(含亚像素抖动)直接返回:fit 会重算行列并重建渲染层,
        // 浮层闪现这类「同尺寸的重复回调」不该引起终端重排 —— 否则会表现为界面抖动
        if (!isSignificantResize(lastBoxRef.current, box)) return
        lastBoxRef.current = box
      }
      try {
        const before = { cols: term.cols, rows: term.rows }
        fit.fit()
        // 行列没变就不必打扰 pty:主进程会把它转成 SIGWINCH,
        // 终端里的程序(vim / top / 进度条)会白重绘一轮
        if (terminalSizeChanged(before, { cols: term.cols, rows: term.rows })) {
          window.api.pty.resize(runId, term.cols, term.rows).catch(() => {
            // 关闭后迟到的 resize rejection 静默丢弃:无用户可恢复动作,弹窗是噪音
          })
        }
      } catch {
        // 容器尺寸为 0 时 fit 会抛错,忽略即可
      }
    })
    observer.observe(container)

    window.api.pty.resize(runId, term.cols, term.rows).catch(() => {
      // 关闭后迟到的 resize rejection 静默丢弃:无用户可恢复动作,弹窗是噪音
    })

    return () => {
      observer.disconnect()
      inputDisposable.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      lastBoxRef.current = null
    }
  }, [runId, onRegisterWriter])

  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = terminalPalette(resolved)
  }, [resolved])

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit()
        if (termRef.current)
          window.api.pty.resize(runId, termRef.current.cols, termRef.current.rows).catch(() => {
            // 关闭后迟到的 resize rejection 静默丢弃:无用户可恢复动作,弹窗是噪音
          })
      } catch {
        // 忽略尺寸计算失败
      }
      termRef.current?.focus()
    }, 30)
    return () => clearTimeout(timer)
  }, [active, runId])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}
