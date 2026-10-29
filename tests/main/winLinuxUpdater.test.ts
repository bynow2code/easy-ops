import { beforeEach, describe, expect, it, vi } from 'vitest'

// 复现依据(electron-updater 6.8.9 源码):
//   BaseUpdater.quitAndInstall → install → AppImageUpdater.doInstall 里**先** spawn 新
//   AppImage(detached, stdio:ignore),**再** setImmediate(app.quit())。
//   而新实例一启动就 requestSingleInstanceLock():此时旧进程还活着、锁还握着,
//   抢不到锁就走我们 index.ts 里的 app.quit() —— 静默退出、没有窗口,
//   正是用户报的「更新成功但没有自动打开」。
//
// 因此 install() 必须在 quitAndInstall() 之前释放单实例锁。这里把顺序钉死。

const calls: string[] = []
const quitAndInstall = vi.fn(() => {
  calls.push('quitAndInstall')
})
const releaseSingleInstanceLock = vi.fn(() => {
  calls.push('releaseSingleInstanceLock')
})

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/tmp/easyops-userdata',
    getVersion: () => '0.9.12',
    releaseSingleInstanceLock
  }
}))

vi.mock('electron-updater', () => {
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: true,
    logger: null as unknown,
    on: () => undefined,
    checkForUpdates: async () => undefined,
    downloadUpdate: async () => undefined,
    quitAndInstall
  }
  return { default: { autoUpdater }, autoUpdater }
})

import { createWinLinuxUpdater } from '../../src/main/updater/win-linux'

beforeEach(() => {
  calls.length = 0
  quitAndInstall.mockClear()
  releaseSingleInstanceLock.mockClear()
})

describe('Windows/Linux 更新安装', () => {
  it('先释放单实例锁,再 quitAndInstall —— 否则新实例抢不到锁会静默退出', () => {
    const updater = createWinLinuxUpdater(() => undefined)
    updater.install()

    expect(releaseSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['releaseSingleInstanceLock', 'quitAndInstall'])
  })

  it('给 electron-updater 挂上落盘 logger,安装动作不再只写 console', async () => {
    const { autoUpdater } = (await import('electron-updater')) as unknown as {
      autoUpdater: { logger: { info: (m: string) => void } | null }
    }
    createWinLinuxUpdater(() => undefined)
    expect(autoUpdater.logger).not.toBeNull()
    expect(typeof autoUpdater.logger?.info).toBe('function')
  })
})
