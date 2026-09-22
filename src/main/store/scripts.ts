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
  createGroup: (name: string, parentId?: string | null) => Group
  updateGroup: (id: string, name: string) => Group
  moveGroup: (id: string, parentId: string | null) => void
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

/**
 * 旧版本落盘的 groups 没有 parentId,读取时统一补成 null;
 * 同时清洗非法值并断环 —— 这是所有读取入口(读盘/导入)的唯一关卡:
 * - 非字符串/空串/悬空(父目录不存在)/自引用 → 视为顶层
 * - 循环引用 → 断开环上一点的父链,否则防环 DFS 与渲染层递归都会死循环
 * 防御的原因:parseImport 只校验 name/id/order,手改 store JSON 也没有任何校验,
 * 坏数据一旦落盘,moveGroup 的 DFS 会挂死主进程,渲染层会把整棵子树静默渲染丢。
 */
function normalizeGroups(groups: Group[]): Group[] {
  const ids = new Set(groups.map((g) => g.id))
  // 第一遍:补缺省 + 剔非法。整体拷贝一份,避免清洗时改动调用方持有的原对象
  const cleaned = groups.map((g) => {
    const pid = g.parentId
    const valid = typeof pid === 'string' && pid !== '' && pid !== g.id && ids.has(pid)
    return valid ? { ...g } : { ...g, parentId: null }
  })
  // 第二遍:沿父链上溯断环。三色标记:undefined=未访问 0=当前路径 1=已完成
  const byId = new Map(cleaned.map((g) => [g.id, g]))
  const color = new Map<string, 0 | 1>()
  for (const g of cleaned) {
    if (color.get(g.id) === 1) continue
    const path: string[] = []
    let cur: string | null = g.id
    while (cur !== null && color.get(cur) === undefined) {
      color.set(cur, 0)
      path.push(cur)
      cur = byId.get(cur)!.parentId
    }
    // 上溯落回当前路径 → 成环;断开环上任一点的父链即可成树
    if (cur !== null && color.get(cur) === 0) {
      byId.get(cur)!.parentId = null
    }
    for (const id of path) color.set(id, 1)
  }
  return cleaned
}

/** 把某一父层的 order 重排为连续序号(0..n-1),消除洞与重复 */
function normalizeLayer(groups: Group[], parentId: string | null): Group[] {
  const layer = groups.filter((g) => (g.parentId ?? null) === parentId)
  if (layer.length === 0) return groups
  const orderById = new Map(normalizeOrder(layer).map((g) => [g.id, g.order]))
  return groups.map((g) => {
    const next = orderById.get(g.id)
    return next === undefined ? g : { ...g, order: next }
  })
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
      groups: normalizeGroups(Array.isArray(raw?.groups) ? raw.groups : [])
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
      // order 语义 = 兄弟内序号:逐父层重排为连续序号,再按树的前序(显示顺序)返回。
      // 之前对全量做 normalizeOrder 会把子目录的 order 混进全局序号里,与
      // createGroup/moveGroup 的兄弟内语义冲突(嵌套后 order 虚高且断言失败)。
      // normalizeGroups 已保证无环无悬空,前序遍历必然终止且覆盖全部节点。
      const byParent = new Map<string | null, Group[]>()
      for (const g of state().groups) {
        const key = g.parentId ?? null
        byParent.set(key, [...(byParent.get(key) ?? []), g])
      }
      const result: Group[] = []
      const walk = (parent: string | null): void => {
        for (const g of normalizeOrder(byParent.get(parent) ?? [])) {
          result.push(g)
          walk(g.id)
        }
      }
      walk(null)
      return result
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

    createGroup(name, parentId = null) {
      const nameCheck = validateGroupName(name)
      if (!nameCheck.ok) throw new Error(nameCheck.message)
      const data = state()
      const parent = parentId ?? null
      if (parent && !data.groups.some((g) => g.id === parent)) {
        throw new Error(`父分组不存在: ${parent}`)
      }
      // order 只在兄弟之间递增,嵌套后全局混排会让子目录 order 虚高
      const siblings = data.groups.filter((g) => (g.parentId ?? null) === parent)
      const group: Group = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        parentId: parent,
        order: nextOrder(siblings),
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

    moveGroup(id, parentId) {
      const target = parentId ?? null
      if (id === target) throw new Error('不能把目录移动到自己')
      const data = state()
      if (!data.groups.some((g) => g.id === id)) throw new Error(`分组不存在: ${id}`)
      if (target && !data.groups.some((g) => g.id === target)) {
        throw new Error(`父分组不存在: ${target}`)
      }
      // 防环:目标父目录不能是自己旗下任意后代。先建「父 → 子」索引,再从 id 往下走。
      // visited 兜底:normalizeGroups 已在入口断环,这里再拦一道,
      // 即使将来有入口绕过清洗,带环数据也不会把主进程拖成死循环
      const childrenOf = new Map<string | null, string[]>()
      for (const g of data.groups) {
        const key = g.parentId ?? null
        childrenOf.set(key, [...(childrenOf.get(key) ?? []), g.id])
      }
      const seen = new Set<string>()
      const stack = [...(childrenOf.get(id) ?? [])]
      while (stack.length > 0) {
        const cur = stack.pop()!
        if (seen.has(cur)) continue
        seen.add(cur)
        if (cur === target) throw new Error('不能把目录移动到自己的子目录')
        stack.push(...(childrenOf.get(cur) ?? []))
      }
      const from = data.groups.find((g) => g.id === id)!.parentId ?? null
      // order 落到新兄弟末尾:沿用旧 order 会在新兄弟间插入到不可预期的位置
      const newSiblings = data.groups.filter((g) => g.id !== id && (g.parentId ?? null) === target)
      let groups = data.groups.map((g) =>
        g.id === id ? { ...g, parentId: target, order: nextOrder(newSiblings) } : g
      )
      // 移动会让旧层留洞、新层追加,两层各重排一次,保证落盘的 order 连续且无重复
      groups = normalizeLayer(groups, target)
      groups = normalizeLayer(groups, from)
      commit({ ...data, groups })
    },

    deleteGroup(id) {
      const data = state()
      const target = data.groups.find((g) => g.id === id)
      if (!target) throw new Error(`分组不存在: ${id}`)
      // 不级联删除:子目录与脚本都上移到被删目录的父级,数据零丢失。
      // 子目录按原相对顺序拼接到被删目录的原位(前面的兄弟不动,后面的整体后移),
      // 否则子树会被已有兄弟从中间劈开,还可能与兄弟产生重复 order
      const parent = target.parentId ?? null
      const siblings = data.groups
        .filter((g) => g.id !== id && (g.parentId ?? null) === parent)
        .sort((a, b) => a.order - b.order)
      const children = data.groups.filter((g) => g.parentId === id).sort((a, b) => a.order - b.order)
      const insertAt = siblings.filter((g) => g.order < target.order).length
      const orderById = new Map(
        [...siblings.slice(0, insertAt), ...children, ...siblings.slice(insertAt)].map((g, i) => [g.id, i])
      )
      commit({
        groups: data.groups
          .filter((g) => g.id !== id)
          .map((g) => {
            const next = orderById.get(g.id)
            return next === undefined
              ? g
              : { ...g, parentId: g.parentId === id ? parent : g.parentId, order: next }
          }),
        scripts: data.scripts.map((s) => (s.groupId === id ? { ...s, groupId: parent } : s))
      })
    },

    reorderGroups(ids) {
      const data = state()
      commit({ ...data, groups: applyOrderById(data.groups, ids) })
    },

    replaceAll(next) {
      return commit({
        scripts: Array.isArray(next.scripts) ? next.scripts : [],
        groups: normalizeGroups(Array.isArray(next.groups) ? next.groups : [])
      })
    }
  }
}
