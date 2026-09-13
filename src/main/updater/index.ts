import { createMacUpdater } from './mac'
import { createWinLinuxUpdater, type UpdateEvent } from './win-linux'

export type { UpdateEvent }

export interface Updater {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => void
}

export function createUpdater(emit: (event: UpdateEvent) => void): Updater {
  return process.platform === 'darwin' ? createMacUpdater(emit) : createWinLinuxUpdater(emit)
}
