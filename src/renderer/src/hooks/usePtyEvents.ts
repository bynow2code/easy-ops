import { useEffect, useRef } from 'react'
import { terminalActions } from '../store/useTerminalStore'

export interface PtyDataHandler {
  (runId: string, chunk: string): void
}

export function usePtyEvents(onData: PtyDataHandler): void {
  const handlerRef = useRef(onData)
  handlerRef.current = onData

  useEffect(() => {
    const offData = window.api.pty.onData(({ runId, chunk }) => handlerRef.current(runId, chunk))
    const offExit = window.api.pty.onExit(({ runId, exitCode }) => {
      terminalActions.markExited(runId, exitCode)
    })

    return () => {
      offData()
      offExit()
    }
  }, [])
}
