import * as pty from 'node-pty'
import type { PtyLike, PtySpawnFn, PtySpawnOptions } from './types'

export const spawnNodePty: PtySpawnFn = (
  file: string,
  args: string[],
  options: PtySpawnOptions
): PtyLike => {
  const child = pty.spawn(file, args, {
    name: options.name,
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env
  })

  return {
    get pid() {
      return child.pid
    },
    onData: (listener) => child.onData(listener),
    onExit: (listener) => child.onExit(({ exitCode, signal }) => listener({ exitCode, signal })),
    write: (data) => child.write(data),
    resize: (cols, rows) => child.resize(cols, rows),
    kill: (signal) => child.kill(signal)
  }
}
