import * as os from 'node:os'
import * as pty from 'node-pty'

export interface ProbeResult {
  ok: boolean
  output: string
  exitCode: number | null
  error?: string
}

const PROBE_TIMEOUT_MS = 5000

export function probePty(): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (r: ProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    let child: pty.IPty
    try {
      child = pty.spawn(
        process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        process.platform === 'win32' ? ['/c', 'echo easyops-pty-ok'] : ['-c', 'echo easyops-pty-ok'],
        {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd: os.homedir(),
          env: process.env as Record<string, string>
        }
      )
    } catch (err) {
      done({ ok: false, output: '', exitCode: null, error: String(err) })
      return
    }

    let buffer = ''
    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 忽略:探测超时后的清理失败不影响结论 */
      }
      done({ ok: false, output: buffer, exitCode: null, error: '探测超时' })
    }, PROBE_TIMEOUT_MS)

    child.onData((chunk) => {
      buffer += chunk
    })

    child.onExit(({ exitCode }) => {
      done({
        ok: buffer.includes('easyops-pty-ok'),
        output: buffer,
        exitCode
      })
    })
  })
}
