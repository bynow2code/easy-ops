import type { CustomShell, Script, ShellInfo } from '../../../shared/types'

/** 「跟随全局」在下拉里的哨兵值(真实 shell id 不会以 __ 开头) */
export const FOLLOW_GLOBAL = '__global__'

export interface ShellSelectOption {
  label: string
  value: string
}

/** 下拉项文案:同名不同路径的 shell 需要靠路径区分,自定义项标注来源 */
export function shellOptionLabel(shell: ShellInfo): string {
  return `${shell.name} · ${shell.source === 'custom' ? '自定义' : shell.path}`
}

export function buildShellOptions(shells: ShellInfo[]): ShellSelectOption[] {
  return [
    { label: '跟随全局', value: FOLLOW_GLOBAL },
    ...shells.map((shell) => ({ label: shellOptionLabel(shell), value: shell.id }))
  ]
}

/** 单个脚本的下拉选项:线性情况下补一项标注「已不可用」的占位,让失效的旧值仍可读出来 */
export function buildOverrideOptions(shells: ShellInfo[], script: Script): ShellSelectOption[] {
  const options = buildShellOptions(shells)
  const { value, stale } = resolveScriptOverride(
    script,
    shells.map((s) => s.id)
  )
  if (!stale) return options
  return [...options, { label: `${value}(已不可用)`, value }]
}

export function toSelectValue(shellId: string | null): string {
  return shellId ?? FOLLOW_GLOBAL
}

export function toShellIdPatch(value: string): string | null {
  return value === FOLLOW_GLOBAL ? null : value
}

export interface ScriptOverrideState {
  value: string
  /** 脚本指定过的 shell 已不在当前可用列表中(如自定义项被删除) */
  stale: boolean
}

export function resolveScriptOverride(script: Script, knownShellIds: string[]): ScriptOverrideState {
  if (!script.shellId) return { value: FOLLOW_GLOBAL, stale: false }
  return { value: script.shellId, stale: !knownShellIds.includes(script.shellId) }
}

/** 「跟随全局」实际会落到哪个 shell,用于给跟随项一个可读提示 */
export function globalShellLabel(shells: ShellInfo[], selectedShellId: string | null): string | null {
  if (shells.length === 0) return null
  const selected = selectedShellId ? shells.find((s) => s.id === selectedShellId) : undefined
  return (selected ?? shells[0]).name
}

export function buildCustomShell(target: string): CustomShell {
  const name = target.split(/[\\/]/).filter(Boolean).pop() ?? target
  return { id: `custom:${target}`, name, path: target }
}
