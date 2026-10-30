import { beforeEach, describe, expect, it, vi } from 'vitest'

// 根因(2026-10-30 实测定性):electron-updater 在**自己退出前** spawn 新 AppImage,
// 新进程继承同一个 systemd unit 的 cgroup;应用一退,unit inactive → KillMode=control-group
// 清场,把新实例一起 SIGKILL。setsid(detached)只换 session,换不了 cgroup。
// 所以 Linux 上必须:① 不让它 spawn(只换文件)② 由我们用 systemd-run 起独立 unit 拉起新版本。

const calls: string[] = []
const quitAndInstall = vi.fn(() => {
  calls.push('quitAndInstall')
  // 真实实现里这一步会同步发 appimage-filename-updated
  emit('appimage-filename-updated', '/home/arthur/Desktop/EasyOps-0.9.15-x86_64.AppImage')
})
const releaseSingleInstanceLock = vi.fn(() => {
  calls.push('releaseSingleInstanceLock')
})

type Handler = (...args: any[]) => void
const handlers = new Map<string, Handler[]>()
const emit = (name: string, ...args: unknown[]): void => {
  for (const fn of handlers.get(name) ?? []) fn(...args)
}

const spawn = vi.fn(() => ({ on: () => undefined, unref: () => undefined }))

vi.mock('node:child_process', () => ({ spawn }))

vi.mock('electron', () => ({
  app: { isPackaged: true, releaseSingleInstanceLock }
}))

vi.mock('electron-updater', () => {
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: true,
    on: (name: string, fn: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), fn])
    },
    off: (name: string, fn: Handler) => {
      handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== fn))
    },
    checkForUpdates: async () => undefined,
    downloadUpdate: async () => undefined,
    quitAndInstall
  }
  return { default: { autoUpdater }, autoUpdater }
})

import { autoUpdater } from 'electron-updater'
import { createWinLinuxUpdater } from '../../src/main/updater/win-linux'

const updater = autoUpdater as unknown as { autoRunAppAfterInstall: boolean }

beforeEach(() => {
  calls.length = 0
  handlers.clear()
  quitAndInstall.mockClear()
  releaseSingleInstanceLock.mockClear()
  spawn.mockClear()
})

describe('Linux 更新安装与重启', () => {
  it('不让 electron-updater 自己拉起(否则新实例与我们同 cgroup,退出时被一起收走)', () => {
    createWinLinuxUpdater(() => undefined).install()
    expect(updater.autoRunAppAfterInstall).toBe(false)
  })

  it('先释放单实例锁,再 quitAndInstall', () => {
    createWinLinuxUpdater(() => undefined).install()
    expect(calls).toEqual(['releaseSingleInstanceLock', 'quitAndInstall'])
  })

  it('装完后交给 systemd-run 起独立 unit 拉起新版本,目标路径作为最后一个参数', () => {
    createWinLinuxUpdater(() => undefined).install()

    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { detached: boolean }]
    // 本机有 systemd-run 且有会话总线 → 应该走脱离 cgroup 的那条路
    expect(command).toBe('systemd-run')
    expect(args.some((a) => a === '--user')).toBe(true)
    expect(args.some((a) => a === '--collect')).toBe(true)
    expect(args.some((a) => a.startsWith('--unit=easyops-relaunch-'))).toBe(true)
    expect(args[args.length - 1]).toBe('/home/arthur/Desktop/EasyOps-0.9.15-x86_64.AppImage')
    expect(options.detached).toBe(true)
  })

  it('没换成新文件(安装失败)时什么都不拉起 —— 否则会起第二个旧版本实例', () => {
    quitAndInstall.mockImplementationOnce(() => {
      calls.push('quitAndInstall')
      // 不发 appimage-filename-updated
    })
    createWinLinuxUpdater(() => undefined).install()
    expect(spawn).not.toHaveBeenCalled()
  })
})
