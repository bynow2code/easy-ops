import {
  DEFAULT_DETAIL_SPLIT_RATIO,
  DEFAULT_MAIN_SPLIT_RATIO,
  clampSplitRatio,
  type Settings,
  type ThemeMode
} from '../../shared/types'
import type { Persistence } from './persistence'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  shellId: null,
  customShells: [],
  checkUpdateOnLaunch: true,
  mainSplitRatio: DEFAULT_MAIN_SPLIT_RATIO,
  detailSplitRatio: DEFAULT_DETAIL_SPLIT_RATIO,
  collapsedGroupIds: []
}

const THEMES: ThemeMode[] = ['light', 'dark', 'system']

/**
 * 折叠目录 id 的唯一清洗关卡:非数组回落 [],数组内只留非空字符串并去重。
 * 读盘与写盘(update patch)两路共用 —— 读盘侧不设防的话,手改 JSON 的脏值会
 * 穿透缓存,并被之后任意一次不涉及该字段的 update 原样固化回磁盘。
 * electron-store 的 read 是 `as T` 强转,类型标注不代表运行时干净,必须做运行时防御。
 */
function sanitizeCollapsedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

export interface SettingsStore {
  get: () => Settings
  update: (patch: Partial<Settings>) => Settings
}

export function createSettingsStore(persistence: Persistence<Settings>): SettingsStore {
  const persisted = persistence.read()
  // 读盘即清洗:cache 里永远是干净的 Settings(见 sanitizeCollapsedIds 注释)
  let cache: Settings = {
    ...DEFAULT_SETTINGS,
    ...persisted,
    collapsedGroupIds: sanitizeCollapsedIds(persisted.collapsedGroupIds)
  }

  return {
    get() {
      // 数组是设置值里唯一的引用类型:返回时拷贝,防外部 push 直接改到内部状态
      return { ...cache, collapsedGroupIds: [...cache.collapsedGroupIds] }
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

      if (patch.mainSplitRatio !== undefined) {
        next.mainSplitRatio = clampSplitRatio(patch.mainSplitRatio, DEFAULT_MAIN_SPLIT_RATIO)
      }
      if (patch.detailSplitRatio !== undefined) {
        next.detailSplitRatio = clampSplitRatio(patch.detailSplitRatio, DEFAULT_DETAIL_SPLIT_RATIO)
      }
      if (patch.collapsedGroupIds !== undefined) {
        next.collapsedGroupIds = sanitizeCollapsedIds(patch.collapsedGroupIds)
      }

      cache = next
      persistence.write(next)
      return { ...next, collapsedGroupIds: [...next.collapsedGroupIds] }
    }
  }
}
