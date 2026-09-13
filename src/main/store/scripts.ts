import {
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
