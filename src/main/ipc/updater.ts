import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { createUpdater, type Updater, type UpdateEvent } from '../updater'

export interface UpdaterIpcHandle {
  updater: Updater
  checkOnLaunch: () => void
}

export function registerUpdaterIpc(getWindow: () => BrowserWindow | null): UpdaterIpcHandle {
  const emit = (event: UpdateEvent): void => {
    getWindow()?.webContents.send('update:event', event)
  }

  const updater = createUpdater(emit)

  ipcMain.handle('update:check', async () => {
    await updater.check()
  })

  ipcMain.handle('update:download', async () => {
    await updater.download()
  })

  ipcMain.handle('update:install', () => {
    updater.install()
  })

  return {
    updater,
    checkOnLaunch: () => {
      void updater.check().catch((err: unknown) => {
        emit({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    }
  }
}
