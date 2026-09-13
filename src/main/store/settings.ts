import type { Settings, ThemeMode } from '../../shared/types'
import type { Persistence } from './persistence'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  shellId: null,
  customShells: [],
  checkUpdateOnLaunch: true
}

const THEMES: ThemeMode[] = ['light', 'dark', 'system']

export interface SettingsStore {
  get: () => Settings
  update: (patch: Partial<Settings>) => Settings
}

export function createSettingsStore(persistence: Persistence<Settings>): SettingsStore {
  let cache: Settings = { ...DEFAULT_SETTINGS, ...persistence.read() }

  return {
    get() {
      return { ...cache }
    },

    update(patch) {
      const next: Settings = { ...cache }

      if (patch.theme !== undefined) {
        if (!THEMES.includes(patch.theme)) throw new Error(`无效的主题值: ${String(patch.theme)}`)
        next.theme = patch.theme
      }
      if (patch.shellId !== undefined) {
        next.shellId = typeof patch.shellId === 'string' && patch.shellId.length > 0 ? patch.shellId : null
      }
      if (patch.checkUpdateOnLaunch !== undefined) {
        next.checkUpdateOnLaunch = Boolean(patch.checkUpdateOnLaunch)
      }
      if (patch.customShells !== undefined) {
        next.customShells = Array.isArray(patch.customShells)
          ? patch.customShells
              .filter((s) => s && typeof s.id === 'string' && typeof s.path === 'string')
              .map((s) => ({ id: s.id, name: String(s.name ?? s.path), path: s.path }))
          : []
      }

      cache = next
      persistence.write(next)
      return { ...next }
    }
  }
}
