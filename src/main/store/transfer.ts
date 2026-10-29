import {
  DEFAULT_DETAIL_SPLIT_RATIO,
  DEFAULT_MAIN_SPLIT_RATIO,
  clampSplitRatio,
  validateGroupName,
  validateScriptContent,
  validateScriptName
} from '../../shared/types'
import type { CustomShell, Group, Script, Settings } from '../../shared/types'

export const EXIT_MARKER_TYPE = 'easyops-config'
export const EXPORT_VERSION = 2

export interface ExportPayload {
  type: typeof EXIT_MARKER_TYPE
  version: typeof EXPORT_VERSION
  exportedAt: string
  scripts: Script[]
  groups: Group[]
  settings: Settings
}

export function buildExportPayload(scripts: Script[], groups: Group[], settings: Settings): ExportPayload {
  return {
    type: EXIT_MARKER_TYPE,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    scripts,
    groups,
    settings
  }
}

export type ParseResult =
  | { ok: true; payload: ExportPayload }
  | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseImport(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: '不是合法的 JSON 文件' }
  }

  // 旧版(v0.7.x)的两种落盘形态:裸脚本数组、带 easyops-scripts-config 标记的对象。
  // 迁移能力已移除,但这里必须认出来并给一句明确的话 —— 否则用户拿着旧文件只会看到
  // 「文件结构无法识别」,以为是文件坏了或自己导错了
  if (Array.isArray(parsed)) {
    return { ok: false, reason: '这是旧版(v0.7.x)配置文件,本版本已不再支持导入旧版配置' }
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, reason: '文件结构无法识别' }
  }

  if (parsed.type === 'easyops-scripts-config') {
    return { ok: false, reason: '这是旧版(v0.7.x)配置文件,本版本已不再支持导入旧版配置' }
  }

  if (parsed.type === EXIT_MARKER_TYPE) {
    const scripts = parsed.scripts
    const groups = parsed.groups
    if (!Array.isArray(scripts) || !Array.isArray(groups)) {
      return { ok: false, reason: '配置文件缺少 scripts 或 groups' }
    }

    const seenScriptIds = new Set<string>()
    for (const script of scripts) {
      if (!isPlainObject(script)) return { ok: false, reason: '脚本记录结构无效' }
      const nameCheck = validateScriptName(script.name)
      if (!nameCheck.ok) return { ok: false, reason: `脚本名称无效:${nameCheck.message}` }
      const contentCheck = validateScriptContent(script.content)
      if (!contentCheck.ok) return { ok: false, reason: `脚本内容无效:${contentCheck.message}` }
      if (typeof script.id !== 'string' || script.id.length === 0) {
        return { ok: false, reason: '脚本记录缺少 id' }
      }
      if (!Number.isFinite(script.order)) {
        return { ok: false, reason: `脚本「${script.name}」缺少有效的 order` }
      }
      if (seenScriptIds.has(script.id)) {
        return { ok: false, reason: `脚本 id 重复:${script.id}` }
      }
      seenScriptIds.add(script.id)
    }

    const seenGroupIds = new Set<string>()
    for (const group of groups) {
      if (!isPlainObject(group)) return { ok: false, reason: '分组记录结构无效' }
      const nameCheck = validateGroupName(group.name)
      if (!nameCheck.ok) return { ok: false, reason: `分组名称无效:${nameCheck.message}` }
      if (typeof group.id !== 'string' || group.id.length === 0) {
        return { ok: false, reason: '分组记录缺少 id' }
      }
      if (!Number.isFinite(group.order)) {
        return { ok: false, reason: `分组「${String(group.name)}」缺少有效的 order` }
      }
      if (seenGroupIds.has(group.id)) {
        return { ok: false, reason: `分组 id 重复:${group.id}` }
      }
      seenGroupIds.add(group.id)
    }

    const rawSettings = isPlainObject(parsed.settings) ? parsed.settings : {}

    return {
      ok: true,
      payload: {
        type: EXIT_MARKER_TYPE,
        version: EXPORT_VERSION,
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
        scripts: scripts as Script[],
        groups: groups as Group[],
        settings: rawSettings as unknown as Settings
      }
    }
  }

  return { ok: false, reason: '无法识别的文件类型标识' }
}

export interface PortableSettingsContext {
  exists: (filePath: string) => boolean
  knownShellIds: string[]
}

export function filterPortableSettings(
  incoming: Settings,
  ctx: PortableSettingsContext
): { settings: Settings; warnings: string[] } {
  const warnings: string[] = []

  const source = incoming ?? ({} as Settings)

  const customShells: CustomShell[] = Array.isArray(source.customShells)
    ? source.customShells.filter((shell) => {
        if (!shell || typeof shell.path !== 'string') return false
        if (!ctx.exists(shell.path)) {
          warnings.push(`自定义 shell 路径在本机不存在,已忽略:${shell.path}`)
          return false
        }
        return true
      })
    : []

  let shellId: string | null = source.shellId ?? null
  if (shellId && !ctx.knownShellIds.includes(shellId)) {
    warnings.push(`默认 shell 在本机不可用,已重置:${shellId}`)
    shellId = null
  }

  return {
    settings: {
      theme: source.theme === 'light' || source.theme === 'dark' || source.theme === 'system' ? source.theme : 'system',
      shellId,
      customShells,
      // 字段缺失(旧版本导出的配置没有它)回落到默认打开,与 DEFAULT_SETTINGS 对齐;
      // 用 Boolean(undefined) 会把「没设置过」误判成「明确关闭」
      checkUpdateOnLaunch: source.checkUpdateOnLaunch === undefined ? true : Boolean(source.checkUpdateOnLaunch),
      // 分栏比例跟着配置走:备份恢复时能保住布局。越界的值一律夹紧到合法区间
      mainSplitRatio: clampSplitRatio(source.mainSplitRatio, DEFAULT_MAIN_SPLIT_RATIO),
      detailSplitRatio: clampSplitRatio(source.detailSplitRatio, DEFAULT_DETAIL_SPLIT_RATIO),
      // 折叠状态是设备本地 UI 状态:不随配置迁移。导入后目录集合已整体替换,
      // 来源机器的折叠 id 在本机也基本失效,统一重置为全展开
      collapsedGroupIds: []
    },
    warnings
  }
}
