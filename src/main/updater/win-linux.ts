import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { canUseSystemdRun, planRelaunch } from './linuxRelaunch'

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

/** 把新版本拉起来。失败无处上报(应用正在退出),但至少不会把退出流程卡住 */
function relaunch(target: string): void {
  const plan = planRelaunch({
    target,
    unitName: `easyops-relaunch-${Date.now()}`,
    hasSystemdRun: canUseSystemdRun({ exists: existsSync, env: process.env }),
    env: process.env
  })
  try {
    const child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // 见上:应用马上要退出,没有可上报的通道
  }
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
      // Windows:NSIS 装完自己会把应用拉起来,不需要我们插手
      if (process.platform !== 'linux') {
        autoUpdater.quitAndInstall()
        return
      }

      // Linux:不能让它自己 spawn。electron-updater 是在**退出前** spawn 新 AppImage 的,
      // 新进程继承同一个 systemd unit 的 cgroup,应用一退 unit 变 inactive,systemd 按
      // KillMode=control-group 清场 —— 新实例被一起 SIGKILL,表现就是「更新成功但没自动打开」
      // (2026-10-30 实测:systemd-run 起 unit + setsid 子进程,unit 结束后子进程一并消失)。
      // 所以改成:它只负责「换文件」,拉起新版本交给我们(见 linuxRelaunch.ts)。
      autoUpdater.autoRunAppAfterInstall = false

      // 新版本由 user manager 起在另一个 unit 里,启动时机不受我们控制;
      // 万一它比本进程退得还快,也不该被单实例锁挡在门外
      app.releaseSingleInstanceLock()

      let destination: string | null = null
      const onRenamed = (filePath: string): void => {
        destination = filePath
      }
      autoUpdater.on('appimage-filename-updated', onRenamed)
      try {
        // 同步走完「替换文件」;isForceRunAfter=false 时它走「只装不跑」分支
        // (AppRun 见到 APPIMAGE_EXIT_AFTER_INSTALL 就不 exec 应用,已实测)
        autoUpdater.quitAndInstall()
      } finally {
        autoUpdater.off('appimage-filename-updated', onRenamed)
      }

      // 有 destination = 文件确实换成新名字了。安装失败时它是 null,此时不能再拉起 ——
      // 那会启动第二个「旧版本」实例
      if (!destination) return
      relaunch(destination)
    }
  }
}
