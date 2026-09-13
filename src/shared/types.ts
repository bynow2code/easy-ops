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
}

export const SCRIPT_NAME_MAX = 30
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

export function validateScriptContent(content: unknown): ValidationResult {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, message: '脚本内容不能为空' }
  }
  return { ok: true }
}
