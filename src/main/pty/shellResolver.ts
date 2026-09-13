import type { ShellInfo } from '../../shared/types'

export interface ShellResolverDeps {
  /** 检测到的系统 shell 列表 */
  detect: () => Promise<ShellInfo[]>
  /** 用户在设置中添加的自定义 shell */
  getCustomShells: () => { id: string; name: string; path: string }[]
  /** 设置中的默认 shell id */
  getPreferredShellId: () => string | null
}

/**
 * 解析脚本执行要用的 shell。
 * 解析优先级:脚本指定的 shellId > 设置中的首选 shell > 第一个检测到的 shell。
 * 指定的 id 无法解析时显式报错,绝不静默 fallback 到别的 shell。
 */
export function createShellResolver(
  deps: ShellResolverDeps
): (scriptShellId: string | null) => Promise<ShellInfo> {
  return async (scriptShellId) => {
    const shells = await deps.detect()
    const wanted = scriptShellId ?? deps.getPreferredShellId()

    const found = wanted ? shells.find((s) => s.id === wanted) : undefined
    if (found) return found

    if (wanted) {
      const custom = deps.getCustomShells().find((s) => s.id === wanted)
      if (custom) {
        return { id: custom.id, name: custom.name, path: custom.path, args: ['-i'], source: 'custom' }
      }
      throw new Error(`找不到脚本指定的 shell(${wanted}),请在脚本设置或应用设置中重新选择`)
    }

    const fallback = shells[0]
    if (!fallback) throw new Error('未检测到可用的 shell,请在设置中配置')
    return fallback
  }
}
