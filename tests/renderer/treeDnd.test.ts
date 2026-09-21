import { describe, expect, it } from 'vitest'
import { computeDropAction, insertIntoSiblings } from '../../src/renderer/src/utils/treeDnd'

describe('computeDropAction', () => {
  const script = (id: string, parentId: string | null) => ({ id, type: 'script' as const, parentId })
  const group = (id: string, parentId: string | null) => ({ id, type: 'group' as const, parentId })

  it('拖到自己返回 null', () => {
    expect(computeDropAction(script('a', null), script('a', null), 'before')).toBeNull()
    expect(computeDropAction(group('g', null), group('g', null), 'into')).toBeNull()
  })

  it('脚本落到脚本行上半部 = 插到锚点之前,父目录取目标的父目录', () => {
    expect(computeDropAction(script('a', 'g1'), script('b', 'g1'), 'before')).toEqual({
      kind: 'reorder',
      parentId: 'g1',
      anchorId: 'b',
      position: 'before'
    })
  })

  it('跨父移动:脚本的最终父目录 = 目标的父目录', () => {
    expect(computeDropAction(script('a', null), script('b', 'g2'), 'after')).toEqual({
      kind: 'reorder',
      parentId: 'g2',
      anchorId: 'b',
      position: 'after'
    })
  })

  it('目录落到目录行:与脚本同规则', () => {
    expect(computeDropAction(group('g1', null), group('g2', 'root'), 'before')).toEqual({
      kind: 'reorder',
      parentId: 'root',
      anchorId: 'g2',
      position: 'before'
    })
  })

  it('目录行的中间区域 = 移入该目录', () => {
    expect(computeDropAction(script('a', null), group('g1', null), 'into')).toEqual({
      kind: 'move-into',
      parentId: 'g1',
      anchorId: 'g1',
      position: 'after'
    })
    expect(computeDropAction(group('g1', null), group('g2', null), 'into')!.kind).toBe('move-into')
  })

  it('目录不能锚在脚本行上', () => {
    expect(computeDropAction(group('g1', null), script('a', 'g1'), 'before')).toBeNull()
    expect(computeDropAction(group('g1', null), script('a', 'g1'), 'after')).toBeNull()
  })

  it('into 只对目录目标有效', () => {
    expect(computeDropAction(script('a', null), script('b', null), 'into')).toBeNull()
  })
})

describe('insertIntoSiblings', () => {
  it('同父重排:抽出再插到锚点前/后', () => {
    expect(insertIntoSiblings(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
    expect(insertIntoSiblings(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
  })

  it('跨目录插入:拖拽项不在序列里,直接插到锚点邻位', () => {
    expect(insertIntoSiblings(['b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
    expect(insertIntoSiblings(['b', 'c'], 'a', 'b', 'before')).toEqual(['a', 'b', 'c'])
  })

  it('锚点不在序列里时返回去掉拖拽项的序列(防御)', () => {
    expect(insertIntoSiblings(['a', 'b'], 'a', 'nope', 'after')).toEqual(['b'])
  })
})
