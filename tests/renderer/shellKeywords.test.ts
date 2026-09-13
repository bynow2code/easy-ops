import { describe, expect, it } from 'vitest'
import { SHELL_KEYWORDS, completionsFor } from '../../src/renderer/src/editor/shellKeywords'

describe('SHELL_KEYWORDS', () => {
  it('包含核心内建命令', () => {
    for (const word of ['cd', 'echo', 'export', 'source', 'alias', 'set']) {
      expect(SHELL_KEYWORDS.some((k) => k.label === word)).toBe(true)
    }
  })

  it('包含常用外部命令', () => {
    for (const word of ['ls', 'grep', 'awk', 'git', 'npm']) {
      expect(SHELL_KEYWORDS.some((k) => k.label === word)).toBe(true)
    }
  })

  it('词表规模控制在精简范围内', () => {
    expect(SHELL_KEYWORDS.length).toBeGreaterThan(20)
    expect(SHELL_KEYWORDS.length).toBeLessThanOrEqual(80)
  })
})

describe('completionsFor', () => {
  it('前缀匹配返回候选', () => {
    const labels = completionsFor('ex').map((c) => c.label)
    expect(labels).toContain('export')
  })

  it('空输入返回空数组', () => {
    expect(completionsFor('')).toEqual([])
  })

  it('无匹配返回空数组', () => {
    expect(completionsFor('zzzzzz')).toEqual([])
  })

  it('结果上限为 20 条', () => {
    expect(completionsFor('e').length).toBeLessThanOrEqual(20)
  })
})
