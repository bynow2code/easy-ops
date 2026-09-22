import {
  DEFAULT_DETAIL_SPLIT_RATIO,
  DEFAULT_MAIN_SPLIT_RATIO,
  GROUP_NAME_MAX,
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

export interface LegacyScriptRecord {
  id?: unknown
  name?: unknown
  content?: unknown
  group?: unknown
  orderNum?: unknown
  shellId?: unknown
  createdAt?: unknown
}

export type ParseResult =
  | { ok: true; mode: 'v2'; payload: ExportPayload }
  | { ok: true; mode: 'legacy'; legacyScripts: LegacyScriptRecord[] }
  | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeLegacyRecord(value: unknown): value is LegacyScriptRecord {
  if (!isPlainObject(value)) return false
  return typeof value.name === 'string' || typeof value.content === 'string' || 'group' in value
}

export function parseImport(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: '不是合法的 JSON 文件' }
  }

  if (Array.isArray(parsed)) {
    if (!parsed.every(looksLikeLegacyRecord)) {
      return { ok: false, reason: '数组内容不是有效的旧版脚本列表' }
    }
    return { ok: true, mode: 'legacy', legacyScripts: parsed }
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, reason: '文件结构无法识别' }
  }

  if (parsed.type === 'easyops-scripts-config') {
    const scripts = parsed.scripts
    if (!Array.isArray(scripts)) return { ok: false, reason: '旧版配置文件缺少 scripts 数组' }
    return { ok: true, mode: 'legacy', legacyScripts: scripts as LegacyScriptRecord[] }
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
      mode: 'v2',
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

export interface LegacyMigrationResult {
  scripts: Script[]
  groups: Group[]
  warnings: string[]
}

function genId(seed: string): string {
  return `${seed}-${Math.random().toString(36).slice(2, 8)}`
}

export function toLegacyMigration(input: unknown): LegacyMigrationResult {
  if (!Array.isArray(input)) {
    return { scripts: [], groups: [], warnings: ['输入不是数组,已跳过全部记录'] }
  }

  const warnings: string[] = []
  const groups: Group[] = []
  const groupIdByName = new Map<string, string>()
  const scripts: Script[] = []
  const now = new Date().toISOString()

  input.forEach((record, index) => {
    if (!looksLikeLegacyRecord(record)) {
      warnings.push(`第 ${index + 1} 条记录结构无法识别,已跳过`)
      return
    }

    const nameCheck = validateScriptName(record.name)
    if (!nameCheck.ok) {
      warnings.push(`第 ${index + 1} 条记录被跳过:${nameCheck.message}`)
      return
    }
    const contentCheck = validateScriptContent(record.content)
    if (!contentCheck.ok) {
      warnings.push(`第 ${index + 1} 条记录被跳过:${contentCheck.message}`)
      return
    }

    let groupId: string | null = null
    const rawGroup = typeof record.group === 'string' ? record.group.trim() : ''
    if (rawGroup) {
      const existing = groupIdByName.get(rawGroup)
      if (existing) {
        groupId = existing
      } else {
        const id = genId('group')
        groupIdByName.set(rawGroup, id)
        // CSV 导入的分组一律是顶层;嵌套目前只在 store 内产生
        groups.push({ id, name: rawGroup.slice(0, GROUP_NAME_MAX), parentId: null, order: groups.length, createdAt: now })
        groupId = id
      }
    }

    const order =
      typeof record.orderNum === 'number' && Number.isFinite(record.orderNum) ? record.orderNum : scripts.length

    scripts.push({
      id: typeof record.id === 'string' && record.id.length > 0 ? record.id : genId('script'),
      name: record.name as string,
      content: record.content as string,
      groupId,
      shellId: typeof record.shellId === 'string' && record.shellId.length > 0 ? record.shellId : null,
      order,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      updatedAt: now
    })
  })

  return { scripts, groups, warnings }
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
      // 字段缺失(旧版配置没有它)回落到默认打开,与 DEFAULT_SETTINGS 对齐;
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
