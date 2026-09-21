/**
 * 树形拖拽的落点判定:把「拖拽什么、放到哪个目标的哪个位置」翻译成一次数据操作。
 * 纯函数,不碰 UI 与 IPC,方便单测。
 */

export type DragType = 'script' | 'group'
export type DropPosition = 'before' | 'after' | 'into'

export interface DragItem {
  id: string
  type: DragType
  /** 当前所在父目录;null = 顶层 */
  parentId: string | null
}

export interface DropTarget {
  id: string
  type: DragType
  parentId: string | null
}

export interface DropAction {
  /** reorder = 同父重排(或移入目标父级后插到其邻位);move-into = 落入目标目录内部 */
  kind: 'reorder' | 'move-into'
  /** 拖拽项最终所在的父目录 */
  parentId: string | null
  /** reorder 时的锚点目标(before/after 它) */
  anchorId: string
  position: 'before' | 'after'
}

/**
 * 计算落点动作。
 * 约定:
 * - 「into」只对目录目标有意义;目录放进脚本之间没有锚点语义,返回 null。
 * - 目录只能以目录为锚(before/after/into);脚本可以落到脚本行(邻位)或目录行(into)。
 * - 拖到自己 = null;调用方还需自行拦截「拖到自己的后代」(需要整棵树,这里看不到)。
 */
export function computeDropAction(drag: DragItem, target: DropTarget, position: DropPosition): DropAction | null {
  if (drag.id === target.id) return null

  if (position === 'into') {
    // 目录行的中间区域:移入该目录
    if (target.type !== 'group') return null
    return { kind: 'move-into', parentId: target.id, anchorId: target.id, position: 'after' }
  }

  // 目录锚在脚本行上:没有兄弟语义,不受理
  if (drag.type === 'group' && target.type === 'script') return null

  return {
    kind: 'reorder',
    // 邻位插入的父目录 = 目标的父目录:同父时即纯重排,跨父时即「移过去并插到锚点旁」
    parentId: target.parentId,
    anchorId: target.id,
    position
  }
}

/**
 * 把拖拽项从兄弟序列中抽出、插到锚点的 before/after,返回新序列。
 * 传进来的 siblings 需已按展示顺序排好;拖拽项不在序列里(跨目录移动)时直接插入。
 */
export function insertIntoSiblings(siblings: string[], draggedId: string, anchorId: string, position: 'before' | 'after'): string[] {
  const without = siblings.filter((id) => id !== draggedId)
  const anchorIndex = without.indexOf(anchorId)
  if (anchorIndex === -1) return without
  const insertAt = position === 'before' ? anchorIndex : anchorIndex + 1
  return [...without.slice(0, insertAt), draggedId, ...without.slice(insertAt)]
}
