import { describe, expect, it } from 'vitest'
import type { Group } from '../../src/shared/types'
import { buildGroupTree, groupAncestorIds, groupParentIds } from '../../src/renderer/src/utils/groupTree'

const group = (
  id: string,
  name: string,
  order: number,
  parentId: string | null = null
): Group => ({ id, name, order, parentId, createdAt: '2026-01-01T00:00:00.000Z' })

/** 树转成「名字 + 子级」的紧凑描述,便于断言层级而不是断言对象引用 */
function describeTree(nodes: ReturnType<typeof buildGroupTree>): unknown[] {
  return nodes.map((n) => [n.group.name, describeTree(n.children)])
}

describe('buildGroupTree', () => {
  it('按 order 排序,同层顺序即渲染顺序', () => {
    const tree = buildGroupTree([group('c', '三', 2), group('a', '一', 0), group('b', '二', 1)])
    expect(describeTree(tree)).toEqual([['一', []], ['二', []], ['三', []]])
  })

  it('按 parentId 嵌套,子分组顺序同样按 order', () => {
    const tree = buildGroupTree([
      group('p', '父', 0),
      group('c2', '子二', 1, 'p'),
      group('c1', '子一', 0, 'p'),
      group('other', '另一个顶层', 1)
    ])
    expect(describeTree(tree)).toEqual([
      ['父', [['子一', []], ['子二', []]]],
      ['另一个顶层', []]
    ])
  })

  it('父分组不存在的孤儿数据落到顶层,不会整块消失', () => {
    const tree = buildGroupTree([group('x', '孤儿', 0, '已删除的父')])
    expect(describeTree(tree)).toEqual([['孤儿', []]])
  })

  it('成环的坏数据仍让每个分组都能出现(断环而不是丢节点)', () => {
    // a.parentId=b, b.parentId=a:两个节点都既不是根、也挂不到任何根下面
    const tree = buildGroupTree([group('a', '环A', 0, 'b'), group('b', '环B', 1, 'a')])
    const flat = JSON.stringify(describeTree(tree))
    expect(flat).toContain('环A')
    expect(flat).toContain('环B')
    // 断环后必定有且只有一个根,层级深度为 2
    expect(tree).toHaveLength(1)
    expect(tree[0].children).toHaveLength(1)
  })

  it('自引用的分组按顶层处理', () => {
    const tree = buildGroupTree([group('self', '自引用', 0, 'self')])
    expect(describeTree(tree)).toEqual([['自引用', []]])
  })
})

describe('groupAncestorIds / groupParentIds', () => {
  const groups = [
    group('a', 'A', 0),
    group('b', 'B', 0, 'a'),
    group('c', 'C', 0, 'b')
  ]

  it('祖先链自根向下且不含自身', () => {
    expect(groupAncestorIds(groups, 'c')).toEqual(['a', 'b'])
    expect(groupAncestorIds(groups, 'a')).toEqual([])
    expect(groupAncestorIds(groups, null)).toEqual([])
  })

  it('未分组或已不存在的 id 返回空链', () => {
    expect(groupAncestorIds(groups, '不存在')).toEqual([])
  })

  it('只把真正有子分组的分组算作父级', () => {
    expect(groupParentIds(groups).sort()).toEqual(['a', 'b'])
  })
})
