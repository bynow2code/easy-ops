import type { Group } from '../../../shared/types'

/** 分组树的纯结构节点:只表达层级,不挂脚本、不做搜索剪枝 */
export interface GroupTreeNode {
  group: Group
  children: GroupTreeNode[]
}

/**
 * 把扁平的分组数组按 parentId 组织成树。
 *
 * 规则与侧栏(`Sidebar.tsx` 里的整树构建)一致:
 * - 同层按 `order` 升序,顺序即渲染顺序;
 * - 父分组不存在的(旧孤儿数据)落到顶层,而不是整块消失;
 * - 自引用(parentId === id)按顶层处理。
 *
 * 额外的断环处理:`normalizeGroups` 已经保证无环,但"选择器"没有资格
 * 假设上游永远干净 —— 一旦成环,环上的节点既不是根、也挂不到任何根下面,
 * 整环都不会出现在 `roots` 里,弹窗中的分组会凭空消失。
 * 这里对每个节点向上走一遍祖先链,走出环就把该节点的父边剪掉(提升为顶层);
 * 只剪一条边就足以破环,其余链路保持原样。
 */
export function buildGroupTree(groups: Group[]): GroupTreeNode[] {
  const sorted = [...groups].sort((a, b) => a.order - b.order)
  const byId = new Map(sorted.map((g) => [g.id, g]))

  const parentOf = new Map<string, string | null>()
  for (const g of sorted) {
    const pid = g.parentId
    parentOf.set(g.id, pid && pid !== g.id && byId.has(pid) ? pid : null)
  }

  for (const g of sorted) {
    const seen = new Set<string>([g.id])
    let cursor = parentOf.get(g.id) ?? null
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = parentOf.get(cursor) ?? null
    }
    // cursor 仍非空 = 撞上了链上已有的节点,说明成环:把当前节点提到顶层
    if (cursor) parentOf.set(g.id, null)
  }

  const nodes = new Map<string, GroupTreeNode>(
    sorted.map((g) => [g.id, { group: g, children: [] as GroupTreeNode[] }])
  )
  const roots: GroupTreeNode[] = []
  for (const g of sorted) {
    const node = nodes.get(g.id)!
    const pid = parentOf.get(g.id) ?? null
    const parent = pid ? nodes.get(pid) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/**
 * 取某分组的祖先 id 链(自根向下,不含自身)。
 *
 * 用途:打开选择器时展开"已选分组的祖先",否则选中的值藏在收起的父级里,
 * 用户看不到自己在哪一层。同一个 id 只认第一次出现,成环时立即停止。
 */
export function groupAncestorIds(groups: Group[], id: string | null): string[] {
  if (!id) return []
  const byId = new Map(groups.map((g) => [g.id, g]))
  const chain: string[] = []
  const seen = new Set<string>([id])
  let cursor = byId.get(id)?.parentId ?? null
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    chain.push(cursor)
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return chain.reverse()
}

/** 所有"带子分组"的分组 id —— 搜索态下用它们把整棵树摊开,保证命中项一定可见 */
export function groupParentIds(groups: Group[]): string[] {
  const withChild = new Set<string>()
  const ids = new Set(groups.map((g) => g.id))
  for (const g of groups) {
    if (g.parentId && g.parentId !== g.id && ids.has(g.parentId)) withChild.add(g.parentId)
  }
  return [...withChild]
}
