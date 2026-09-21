import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPtyManager, type PtyManager } from '../../src/main/pty/manager'
import type { PtyLike, PtySpawnFn } from '../../src/main/pty/types'

interface FakePty extends PtyLike {
  written: string[]
  killed: boolean
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
}

function createFakeSpawn(): { spawn: PtySpawnFn; last: () => FakePty | null; count: () => number } {
  const created: FakePty[] = []
  const spawn: PtySpawnFn = () => {
    const dataListeners: ((d: string) => void)[] = []
    const exitListeners: ((e: { exitCode: number }) => void)[] = []
    const fake: FakePty = {
      pid: 1000 + created.length,
      written: [],
      killed: false,
      onData(listener) {
        dataListeners.push(listener)
        return { dispose: () => {} }
      },
      onExit(listener) {
        exitListeners.push(listener)
        return { dispose: () => {} }
      },
      write(data) {
        fake.written.push(data)
      },
      resize: vi.fn(),
      kill() {
        if (fake.killed) return
        fake.killed = true
        // 模拟真实 node-pty:kill 后异步触发一次 exit
        queueMicrotask(() => fake.emitExit(0))
      },
      emitData(data) {
        dataListeners.forEach((l) => l(data))
      },
      emitExit(exitCode) {
        exitListeners.forEach((l) => l({ exitCode }))
      }
    }
    created.push(fake)
    return fake
  }
  return { spawn, last: () => created.at(-1) ?? null, count: () => created.length }
}

let manager: PtyManager
let fake: ReturnType<typeof createFakeSpawn>
let emitted: { channel: string; payload: unknown }[]

beforeEach(() => {
  fake = createFakeSpawn()
  emitted = []
  manager = createPtyManager({
    spawn: fake.spawn,
    tempDir: '/tmp/easyops-test',
    homeDir: '/Users/test',
    writeTempScript: async (_dir, runId) => `/tmp/easyops-test/easyops-${runId}.sh`,
    cleanupTempScript: async () => {},
    emit: (channel, payload) => emitted.push({ channel, payload }),
    env: { PATH: '/usr/bin' },
    platform: 'darwin'
  })
})

const SHELL = { path: '/bin/zsh', args: ['-i'], id: 'zsh', name: 'zsh', source: 'detected' as const }

describe('启动会话', () => {
  it('返回 runId 与标题,并注册进会话表', async () => {
    const result = await manager.start({ scriptId: 's1', scriptName: '启动服务', content: 'echo hi', shell: SHELL })
    expect(result.title).toBe('启动服务')
    expect(manager.list()).toHaveLength(1)
    expect(manager.list()[0].runId).toBe(result.runId)
  })

  it('同名脚本第二次启动时标题追加序号', async () => {
    await manager.start({ scriptId: 's1', scriptName: '启动服务', content: 'echo a', shell: SHELL })
    const second = await manager.start({ scriptId: 's2', scriptName: '启动服务', content: 'echo b', shell: SHELL })
    expect(second.title).toBe('启动服务 (2)')
  })

  it('等 shell 打印提示符后再写入 source 命令,避免 tty 双重回显', async () => {
    const shellUsed: string[] = []
    const capturingSpawn: PtySpawnFn = (file, args, options) => {
      shellUsed.push(file, ...args)
      return fake.spawn(file, args, options)
    }
    const m = createPtyManager({
      spawn: capturingSpawn,
      tempDir: '/tmp/easyops-test',
      homeDir: '/Users/test',
      writeTempScript: async (_dir, runId) => `/tmp/easyops-test/easyops-${runId}.sh`,
      cleanupTempScript: async () => {},
      emit: () => {},
      env: {},
      platform: 'darwin'
    })
    const { runId } = await m.start({ scriptId: 's1', scriptName: 'a', content: 'echo hi', shell: SHELL })
    expect(shellUsed).toContain('/bin/zsh')
    expect(shellUsed).toContain('-i')

    const pty = fake.last()!
    // 提示符出现前不注入:提前写命令会被 tty 回显成裸命令一行 + 提示符后又重复一行
    expect(pty.written).toHaveLength(0)

    // 提示符到达(即使被切成两个 chunk 也能匹配)→ 注入一次
    pty.emitData('arthur@arthur-PC')
    expect(pty.written).toHaveLength(0)
    pty.emitData(':~$ ')
    expect(pty.written).toEqual([`source '/tmp/easyops-test/easyops-${runId}.sh'\n`])
  })

  it('shell 迟迟不打印提示符时超时兜底注入', async () => {
    vi.useFakeTimers()
    try {
      const { runId } = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo hi', shell: SHELL })
      const pty = fake.last()!
      expect(pty.written).toHaveLength(0)

      vi.advanceTimersByTime(3000)
      expect(pty.written).toEqual([`source '/tmp/easyops-test/easyops-${runId}.sh'\n`])
    } finally {
      vi.useRealTimers()
    }
  })

  it('spawn 抛错时清理临时文件并以中文前缀上抛', async () => {
    const cleaned: string[] = []
    const failingSpawn: PtySpawnFn = () => {
      throw new Error("spawn /bin/badshell ENOENT")
    }
    const m = createPtyManager({
      spawn: failingSpawn,
      tempDir: '/tmp/easyops-test',
      homeDir: '/Users/test',
      writeTempScript: async (_dir, runId) => `/tmp/easyops-test/easyops-${runId}.sh`,
      cleanupTempScript: async (filePath) => {
        cleaned.push(filePath)
      },
      emit: () => {},
      env: {},
      platform: 'darwin'
    })
    await expect(m.start({ scriptId: 's1', scriptName: 'a', content: 'echo hi', shell: SHELL })).rejects.toThrowError(
      /^终端启动失败: .*/
    )
    expect(cleaned).toHaveLength(1)
    expect(cleaned[0]).toMatch(/^\/tmp\/easyops-test\/easyops-.+\.sh$/)
    expect(m.list()).toHaveLength(0)
  })

  it('cwd 使用传入的 homeDir', async () => {
    let usedCwd = ''
    const capturingSpawn: PtySpawnFn = (_file, _args, options) => {
      usedCwd = options.cwd
      return fake.spawn(_file, _args, options)
    }
    const m = createPtyManager({
      spawn: capturingSpawn,
      tempDir: '/tmp/easyops-test',
      homeDir: '/Users/test',
      writeTempScript: async (_dir, runId) => `/tmp/easyops-test/easyops-${runId}.sh`,
      cleanupTempScript: async () => {},
      emit: () => {},
      env: {},
      platform: 'darwin'
    })
    await m.start({ scriptId: 's1', scriptName: 'a', content: 'echo hi', shell: SHELL })
    expect(usedCwd).toBe('/Users/test')
  })
})

describe('数据流转发', () => {
  it('pty 输出转发为 pty:data 事件', async () => {
    const { runId } = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    fake.last()!.emitData('hello\r\n')
    expect(emitted).toEqual([{ channel: 'pty:data', payload: { runId, chunk: 'hello\r\n' } }])
  })

  it('写入数据转发到 pty', async () => {
    const started = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    manager.write(started.runId, 'ls\n')
    expect(fake.last()!.written).toContain('ls\n')
  })

  it('对不存在的 runId 写入时抛错', async () => {
    expect(() => manager.write('nope', 'x')).toThrowError(/不存在/)
  })
})

describe('退出与关闭', () => {
  it('pty 退出时发 pty:exit 并从会话表移除', async () => {
    await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    fake.last()!.emitExit(0)
    expect(emitted.some((e) => e.channel === 'pty:exit')).toBe(true)
    expect(manager.list()).toHaveLength(0)
  })

  it('关闭会话时先写 Ctrl+C 再 kill', async () => {
    const { runId } = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    await manager.close(runId)
    const pty = fake.last()!
    expect(pty.written).toContain('\x03')
    expect(pty.killed).toBe(true)
    expect(manager.list()).toHaveLength(0)
  })

  it('主动关闭后仍会向渲染层发出 pty:exit 事件', async () => {
    const { runId } = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    await manager.close(runId)
    await vi.waitFor(() => {
      expect(emitted.some((e) => e.channel === 'pty:exit' && (e.payload as { runId: string }).runId === runId)).toBe(
        true
      )
    })
  })

  it('关闭不存在的会话不抛错', async () => {
    await expect(manager.close('nope')).resolves.toBeUndefined()
  })

  it('closeAll 关闭全部会话', async () => {
    await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    await manager.start({ scriptId: 's2', scriptName: 'b', content: 'echo', shell: SHELL })
    expect(manager.list()).toHaveLength(2)
    await manager.closeAll()
    expect(manager.list()).toHaveLength(0)
  })

  it('disposeAll 关闭全部会话(应用退出路径)', async () => {
    await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    await manager.disposeAll()
    expect(manager.list()).toHaveLength(0)
    expect(fake.last()!.killed).toBe(true)
  })
})
