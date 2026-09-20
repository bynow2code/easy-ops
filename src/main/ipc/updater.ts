import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { createUpdater, type Updater, type UpdateEvent } from '../updater'
import { consumeMacUpdateError } from '../updater/mac'

export interface UpdaterIpcHandle {
  updater: Updater
  checkOnLaunch: () => void
}

// 只有「一次检查的结论」值得缓存回放:available / downloaded 是用户需要采取行动的信息,
// not-available / error 是本次检查的答复,几分钟后打开设置仍有意义。
// checking / downloading 是瞬态进度,回放会让用户看到一个早已结束的「检查中/下载中」,
// 反而误导,故不缓存。
const REPLAYABLE_STATUS: ReadonlySet<UpdateEvent['status']> = new Set([
  'available',
  'downloaded',
  'error',
  'not-available'
])

export function isReplayableUpdateEvent(event: UpdateEvent): boolean {
  return REPLAYABLE_STATUS.has(event.status)
}

export function registerUpdaterIpc(getWindow: () => BrowserWindow | null): UpdaterIpcHandle {
  // 设置面板由 antd Modal 包裹,首次打开前 children 不渲染,启动时(3s 后)推送的事件会被丢弃,
  // 因此这里缓存最近一次可回放的事件,供渲染层挂载时主动来取。
  let lastEvent: UpdateEvent | null = null

  const emit = (event: UpdateEvent): void => {
    if (isReplayableUpdateEvent(event)) {
      lastEvent = event
    }
    getWindow()?.webContents.send('update:event', event)
  }

  const updater = createUpdater(emit)

  // mac 自研替换脚本在 app 退出后才运行,失败无处上报 —— 它把原因写进固定错误文件,
  // 这里在启动时消费并转为可回放的 error 事件:设置面板挂载回放时用户能看到上次失败的原因
  const lastInstallError = consumeMacUpdateError()
  if (lastInstallError) {
    emit({
      status: 'error',
      message: `上次自动更新未完成:${lastInstallError},请重新检查更新,仍失败时请手动下载安装`
    })
  }

  ipcMain.handle('update:check', async () => {
    await updater.check()
  })

  ipcMain.handle('update:download', async () => {
    await updater.download()
  })

  ipcMain.handle('update:install', () => {
    updater.install()
  })

  ipcMain.handle('update:lastEvent', (): UpdateEvent | null => lastEvent)

  return {
    updater,
    checkOnLaunch: () => {
      void updater.check().catch((err: unknown) => {
        emit({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    }
  }
}
