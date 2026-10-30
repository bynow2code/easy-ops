import { app } from 'electron'
import electronUpdater from 'electron-updater'

export type UpdateEvent =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available' }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

export interface UpdaterHandle {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => void
}

export function createWinLinuxUpdater(emit: (event: UpdateEvent) => void): UpdaterHandle {
  const { autoUpdater } = electronUpdater

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => emit({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => emit({ status: 'not-available' }))
  autoUpdater.on('download-progress', (progress) => emit({ status: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => emit({ status: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => emit({ status: 'error', message: err.message }))

  return {
    async check() {
      if (!app.isPackaged) {
        emit({ status: 'error', message: '开发模式不支持检查更新' })
        return
      }
      try {
        await autoUpdater.checkForUpdates()
      } catch {
        // 失败已经过 error 事件通道推送;这里再抛会让 IPC handler 也报一次,渲染层弹两个一样的错误
      }
    },
    async download() {
      try {
        await autoUpdater.downloadUpdate()
      } catch {
        // 同 check:错误走事件通道,避免 IPC 层二次抛出
      }
    },
    install() {
      // 顺序问题(electron-updater 6.8.9 实测源码):quitAndInstall → AppImageUpdater.doInstall
      // 里**先** spawn 新 AppImage(detached),**再** setImmediate(app.quit())。
      // 新实例一启动就 requestSingleInstanceLock(),此时旧进程还活着、锁还握着 ——
      // 抢不到锁就落到 index.ts 的 app.quit(),静默退出、没有窗口。
      // 用户看到的就是「更新成功但没有自动打开」。
      // 退出前主动释放锁,新实例才能正常接管。
      app.releaseSingleInstanceLock()
      autoUpdater.quitAndInstall()
    }
  }
}
