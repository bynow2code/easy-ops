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
  /**
   * 批量移除：一次过滤 + 一次状态回落。
   * 批量路径自己写一套过滤会让「active 回落 / maximized 清空」出现第二份规则，
   * 迟早与 remove 漂移 —— 所以 remove 也直接委托到这里。
   */
  removeMany: (runIds: string[]) => void
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

  removeMany(runIds) {
    // 空数组直接返回：不新建状态对象，zustand 就不会通知订阅者
    if (runIds.length === 0) return
    const ids = new Set(runIds)
    useTerminalStore.setState((state) => {
      const sessions = state.sessions.filter((s) => !ids.has(s.runId))
      return {
        sessions,
        // 被移除的 active 回落到剩余首个；未被移除则原样保留（含 null）
        activeRunId:
          state.activeRunId !== null && ids.has(state.activeRunId)
            ? (sessions[0]?.runId ?? null)
            : state.activeRunId,
        // 被移除的 maximized 清空；未被移除则原样保留（含 null）
        maximizedRunId:
          state.maximizedRunId !== null && ids.has(state.maximizedRunId) ? null : state.maximizedRunId
      }
    })
  },

  remove(runId) {
    terminalActions.removeMany([runId])
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
