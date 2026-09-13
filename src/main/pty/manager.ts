import type { ShellInfo } from '../../shared/types'
import { buildSourceCommand } from './runner'
import { nextTitle } from './title'
import type { PtyLike, PtySpawnFn } from './types'

export interface StartInput {
  scriptId: string
  scriptName: string
  content: string
  shell: Pick<ShellInfo, 'path' | 'args'>
}

export interface StartResult {
  runId: string
  title: string
}

export interface PtyManagerDeps {
  spawn: PtySpawnFn
  tempDir: string
  homeDir: string
  writeTempScript: (dir: string, runId: string, content: string) => Promise<string>
  cleanupTempScript: (filePath: string) => Promise<void>
  emit: (channel: 'pty:data' | 'pty:exit', payload: unknown) => void
  env: Record<string, string>
  platform: NodeJS.Platform
}

export interface SessionSummary {
  runId: string
  scriptId: string
  title: string
}

interface Session {
  runId: string
  scriptId: string
  title: string
  pty: PtyLike
  tempFile: string
  dataDisposers: { dispose: () => void }[]
  exitDisposer: { dispose: () => void } | null
}

export interface PtyManager {
  start: (input: StartInput) => Promise<StartResult>
  write: (runId: string, data: string) => void
  resize: (runId: string, cols: number, rows: number) => void
  close: (runId: string) => Promise<void>
  closeAll: () => Promise<void>
  disposeAll: () => Promise<void>
  list: () => SessionSummary[]
}

let counter = 0

function makeRunId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter}`
}

export function createPtyManager(deps: PtyManagerDeps): PtyManager {
  const sessions = new Map<string, Session>()

  const titles = (): string[] => Array.from(sessions.values()).map((s) => s.title)

  const destroy = async (session: Session): Promise<void> => {
    // 只停掉数据转发;exit 监听保留,让 kill 触发的真实 exit 事件仍能到达渲染层
    session.dataDisposers.forEach((d) => d.dispose())
    session.dataDisposers = []
    try {
      session.pty.write('\x03')
    } catch {
      // pty 可能已退出
    }
    try {
      session.pty.kill()
    } catch {
      // pty 可能已退出
    }
    sessions.delete(session.runId)
    await deps.cleanupTempScript(session.tempFile)
  }

  return {
    async start(input) {
      const runId = makeRunId()
      const title = nextTitle(input.scriptName, titles())
      const tempFile = await deps.writeTempScript(deps.tempDir, runId, input.content)

      const env: Record<string, string> = {
        ...deps.env,
        TERM: 'xterm-256color',
        EASYOPS_RUN_ID: runId
      }

      let pty: PtyLike
      try {
        pty = deps.spawn(input.shell.path, input.shell.args, {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: deps.homeDir,
          env
        })
      } catch (err) {
        // spawn 失败时回收已写出的临时脚本,并以中文前缀上抛(保留原始信息便于诊断)
        await deps.cleanupTempScript(tempFile)
        throw new Error(`终端启动失败: ${err instanceof Error ? err.message : String(err)}`)
      }

      const session: Session = { runId, scriptId: input.scriptId, title, pty, tempFile, dataDisposers: [], exitDisposer: null }
      sessions.set(runId, session)

      session.dataDisposers.push(pty.onData((chunk) => deps.emit('pty:data', { runId, chunk })))

      session.exitDisposer = pty.onExit(({ exitCode, signal }) => {
        session.exitDisposer?.dispose()
        session.exitDisposer = null
        session.dataDisposers.forEach((d) => d.dispose())
        session.dataDisposers = []
        sessions.delete(runId)
        deps.emit('pty:exit', { runId, exitCode, signal: signal ?? null })
        void deps.cleanupTempScript(tempFile)
      })

      pty.write(buildSourceCommand(tempFile))

      return { runId, title }
    },

    write(runId, data) {
      const session = sessions.get(runId)
      if (!session) throw new Error(`终端会话不存在: ${runId}`)
      session.pty.write(data)
    },

    resize(runId, cols, rows) {
      const session = sessions.get(runId)
      if (!session) return
      try {
        session.pty.resize(cols, rows)
      } catch {
        // 会话可能正在退出,忽略
      }
    },

    async close(runId) {
      const session = sessions.get(runId)
      if (!session) return
      await destroy(session)
    },

    async closeAll() {
      await Promise.all(Array.from(sessions.values()).map((s) => destroy(s)))
    },

    async disposeAll() {
      await Promise.all(Array.from(sessions.values()).map((s) => destroy(s)))
    },

    list() {
      return Array.from(sessions.values()).map((s) => ({
        runId: s.runId,
        scriptId: s.scriptId,
        title: s.title
      }))
    }
  }
}
