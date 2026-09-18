export interface Script {
  id: string
  name: string
  content: string
  groupId: string | null
  shellId: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export interface Group {
  id: string
  name: string
  order: number
  createdAt: string
}

export interface CustomShell {
  id: string
  name: string
  path: string
}

export interface ShellInfo {
  id: string
  name: string
  path: string
  args: string[]
  version?: string
  source: 'detected' | 'custom'
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface Settings {
  theme: ThemeMode
  shellId: string | null
  customShells: CustomShell[]
  checkUpdateOnLaunch: boolean
  /** 左半(脚本区)占工作区宽度的百分比,可拖动中间那条分割条调整 */
  mainSplitRatio: number
  /** 左半内部:脚本列表占左半高度的百分比,可拖动上下那条分割条调整 */
  detailSplitRatio: number
}

export const SCRIPT_NAME_MAX = 30

/** 分栏比例的合法区间:留够下限,免得把某一侧拖到看不见 */
export const SPLIT_RATIO_MIN = 25
export const SPLIT_RATIO_MAX = 75
export const DEFAULT_MAIN_SPLIT_RATIO = 50
export const DEFAULT_DETAIL_SPLIT_RATIO = 60

/**
 * 把任意输入夹成分栏比例:非有限数字(空、null、字符串、NaN)一律回落默认值。
 * 落盘、导入、拖动的三个入口都过这一道,界面上拿到的永远是区间内的数。
 */
export function clampSplitRatio(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, n))
}

export const GROUP_NAME_MAX = 15

export interface ValidationResult {
  ok: boolean
  message?: string
}

export function validateScriptName(name: unknown): ValidationResult {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, message: '脚本名称不能为空' }
  }
  if (Array.from(name).length > SCRIPT_NAME_MAX) {
    return { ok: false, message: `脚本名称不能超过 ${SCRIPT_NAME_MAX} 个字符` }
  }
  return { ok: true }
}

export function validateGroupName(name: unknown): ValidationResult {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, message: '分组名称不能为空' }
  }
  if (Array.from(name).length > GROUP_NAME_MAX) {
    return { ok: false, message: `分组名称不能超过 ${GROUP_NAME_MAX} 个字符` }
  }
  return { ok: true }
}

/**
 * 内容校验:只要求是字符串。
 * 内容现在在内容面板里编辑,新建/导入时为空是合法状态(先建后写)。
 */
export function validateScriptContent(content: unknown): ValidationResult {
  if (typeof content !== 'string') {
    return { ok: false, message: '脚本内容必须是字符串' }
  }
  return { ok: true }
}
