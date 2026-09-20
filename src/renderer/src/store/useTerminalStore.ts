import { create } from 'zustand'

export interface TerminalSessionView {
  runId: string
  title: string
  scriptId: string
  exited: boolean
  exitCode: number | null
}

export interface TerminalState {
  sessions: TerminalSessionView[]
  activeRunId: string | null
  maximizedRunId: string | null
}

export const useTerminalStore = create<TerminalState>(() => ({
  sessions: [],
  activeRunId: null,
  maximizedRunId: null
}))

export interface TerminalActions {
  get: () => TerminalState
  add: (input: { runId: string; title: string; scriptId: string }) => void
  remove: (runId: string) => void
  markExited: (runId: string, exitCode: number) => void
  setActive: (runId: string | null) => void
  setMaximized: (runId: string, maximized: boolean) => void
}

export const terminalActions: TerminalActions = {
  get: () => useTerminalStore.getState(),

  add({ runId, title, scriptId }) {
    useTerminalStore.setState((state) => ({
      // 新会话插到最顶部:刚执行的脚本离注意力最近,不用滚到列表底部找
      sessions: [{ runId, title, scriptId, exited: false, exitCode: null }, ...state.sessions],
      activeRunId: runId
    }))
  },

  remove(runId) {
    useTerminalStore.setState((state) => {
      const sessions = state.sessions.filter((s) => s.runId !== runId)
      return {
        sessions,
        activeRunId: state.activeRunId === runId ? (sessions[0]?.runId ?? null) : state.activeRunId,
        maximizedRunId: state.maximizedRunId === runId ? null : state.maximizedRunId
      }
    })
  },

  markExited(runId, exitCode) {
    useTerminalStore.setState((state) => ({
      sessions: state.sessions.map((s) => (s.runId === runId ? { ...s, exited: true, exitCode } : s))
    }))
  },

  setActive(runId) {
    useTerminalStore.setState({ activeRunId: runId })
  },

  setMaximized(runId, maximized) {
    useTerminalStore.setState({ maximizedRunId: maximized ? runId : null })
  }
}
