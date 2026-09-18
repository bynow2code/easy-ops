import {
  SCRIPT_NAME_MAX,
  validateGroupName,
  validateScriptContent,
  validateScriptName
} from '../../shared/types'
import type { Group, Script } from '../../shared/types'
import type { Persistence } from './persistence'

export interface ScriptsData {
  scripts: Script[]
  groups: Group[]
}

export type CreateScriptInput = {
  name: string
  content: string
  groupId: string | null
  shellId?: string | null
}

export type ScriptPatch = Partial<Pick<Script, 'name' | 'content' | 'groupId' | 'shellId'>>

export interface ScriptsStore {
  listScripts: () => Script[]
  listGroups: () => Group[]
  createScript: (input: CreateScriptInput) => Script
  duplicateScript: (id: string) => Script
  updateScript: (id: string, patch: ScriptPatch) => Script
  deleteScript: (id: string) => void
  reorderScripts: (ids: string[]) => void
  createGroup: (name: string) => Group
  updateGroup: (id: string, name: string) => Group
  deleteGroup: (id: string) => void
  reorderGroups: (ids: string[]) => void
  replaceAll: (data: ScriptsData) => ScriptsData
}

function nowIso(): string {
  return new Date().toISOString()
}

function nextOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1
}

function normalizeOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }))
}

function applyOrderById<T extends { id: string; order: number }>(items: T[], ids: string[]): T[] {
  const indexOf = new Map(ids.map((id, i) => [id, i]))
  return items.map((item) => {
    const next = indexOf.get(item.id)
    return next === undefined ? item : { ...item, order: next }
  })
}

const COPY_SUFFIX = ' 副本'

/** 递增尝试的上限;正常不会触顶,只是避免异常数据把生成逻辑拖成死循环 */
const COPY_NAME_ATTEMPTS = 999

function truncateTo(value: string, max: number): string {
  if (max <= 0) return ''
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join('')
}

/**
 * 副本名:原名后加「 副本」,已被占用则递增为「原名 副本 2」「原名 副本 3」…
 * 加后缀前先截断原名,保证结果不超过长度上限。
 */
function buildCopyName(sourceName: string, existingNames: string[]): string {
  const taken = new Set(existingNames)
  for (let n = 1; n <= COPY_NAME_ATTEMPTS; n++) {
    const suffix = n === 1 ? COPY_SUFFIX : `${COPY_SUFFIX} ${n}`
    const candidate = `${truncateTo(sourceName, SCRIPT_NAME_MAX - Array.from(suffix).length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error('无法生成可用的副本名称')
}

export function createScriptsStore(persistence: Persistence<ScriptsData>): ScriptsStore {
  const state = (): ScriptsData => {
    const raw = persistence.read()
    return {
      scripts: Array.isArray(raw?.scripts) ? raw.scripts : [],
      groups: Array.isArray(raw?.groups) ? raw.groups : []
    }
  }

  const commit = (next: ScriptsData): ScriptsData => {
    persistence.write(next)
    return next
  }

  return {
    listScripts() {
      return normalizeOrder(state().scripts)
    },

    listGroups() {
      return normalizeOrder(state().groups)
    },

    createScript(input) {
      const nameCheck = validateScriptName(input.name)
      if (!nameCheck.ok) throw new Error(nameCheck.message)
      const contentCheck = validateScriptContent(input.content)
      if (!contentCheck.ok) throw new Error(contentCheck.message)

      const data = state()
      const script: Script = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        content: input.content,
        groupId: input.groupId ?? null,
        shellId: input.shellId ?? null,
        order: nextOrder(data.scripts),
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
      commit({ ...data, scripts: [...data.scripts, script] })
      return script
    },

    duplicateScript(id) {
      const data = state()
      const ordered = normalizeOrder(data.scripts)
      const index = ordered.findIndex((s) => s.id === id)
      if (index === -1) throw new Error(`脚本不存在: ${id}`)

      const source = ordered[index]
      const name = buildCopyName(
        source.name,
        ordered.map((s) => s.name)
      )
      const nameCheck = validateScriptName(name)
      if (!nameCheck.ok) throw new Error(nameCheck.message)

      // 副本紧跟原脚本,但要让过该脚本已有的副本,连续复制时名称从上到下才是递增的
      const copyPrefix = `${source.name}${COPY_SUFFIX}`
      let insertAt = index + 1
      while (insertAt < ordered.length && ordered[insertAt].name.startsWith(copyPrefix)) insertAt++

      const copy: Script = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        content: source.content,
        groupId: source.groupId,
        shellId: source.shellId,
        order: insertAt,
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
      // 后续项顺延;order 整体重排,保证下次读取时顺序稳定
      const scripts = [...ordered.slice(0, insertAt), copy, ...ordered.slice(insertAt)].map(
        (s, i) => ({ ...s, order: i })
      )
      commit({ ...data, scripts })
      return copy
    },

    updateScript(id, patch) {
      const data = state()
      const index = data.scripts.findIndex((s) => s.id === id)
      if (index === -1) throw new Error(`脚本不存在: ${id}`)

      if (patch.name !== undefined) {
        const nameCheck = validateScriptName(patch.name)
        if (!nameCheck.ok) throw new Error(nameCheck.message)
      }
      if (patch.content !== undefined) {
        const contentCheck = validateScriptContent(patch.content)
        if (!contentCheck.ok) throw new Error(contentCheck.message)
      }

      const updated: Script = {
        ...data.scripts[index],
        ...patch,
        updatedAt: nowIso()
      }
      const scripts = [...data.scripts]
      scripts[index] = updated
      commit({ ...data, scripts })
      return updated
    },

    deleteScript(id) {
      const data = state()
      if (!data.scripts.some((s) => s.id === id)) throw new Error(`脚本不存在: ${id}`)
      commit({ ...data, scripts: data.scripts.filter((s) => s.id !== id) })
    },

    reorderScripts(ids) {
      const data = state()
      commit({ ...data, scripts: applyOrderById(data.scripts, ids) })
    },

    createGroup(name) {
      const nameCheck = validateGroupName(name)
      if (!nameCheck.ok) throw new Error(nameCheck.message)
      const data = state()
      const group: Group = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        order: nextOrder(data.groups),
        createdAt: nowIso()
      }
      commit({ ...data, groups: [...data.groups, group] })
      return group
    },

    updateGroup(id, name) {
      const nameCheck = validateGroupName(name)
      if (!nameCheck.ok) throw new Error(nameCheck.message)
      const data = state()
      const index = data.groups.findIndex((g) => g.id === id)
      if (index === -1) throw new Error(`分组不存在: ${id}`)
      const groups = [...data.groups]
      groups[index] = { ...groups[index], name }
      commit({ ...data, groups })
      return groups[index]
    },

    deleteGroup(id) {
      const data = state()
      if (!data.groups.some((g) => g.id === id)) throw new Error(`分组不存在: ${id}`)
      commit({
        groups: data.groups.filter((g) => g.id !== id),
        scripts: data.scripts.map((s) => (s.groupId === id ? { ...s, groupId: null } : s))
      })
    },

    reorderGroups(ids) {
      const data = state()
      commit({ ...data, groups: applyOrderById(data.groups, ids) })
    },

    replaceAll(next) {
      return commit({
        scripts: Array.isArray(next.scripts) ? next.scripts : [],
        groups: Array.isArray(next.groups) ? next.groups : []
      })
    }
  }
}
