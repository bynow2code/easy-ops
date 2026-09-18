import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '../theme/provider'
import { terminalPalette } from '../theme/tokens'

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
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    onRegisterWriter(runId, (chunk) => term.write(chunk))

    const inputDisposable = term.onData((data) => {
      window.api.pty.write(runId, data).catch(() => {
        // 关闭后迟到的 write rejection 静默丢弃:无用户可恢复动作,弹窗是噪音
      })
    })

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        window.api.pty.resize(runId, term.cols, term.rows).catch(() => {
          // 关闭后迟到的 resize rejection 静默丢弃:无用户可恢复动作,弹窗是噪音
        })
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
