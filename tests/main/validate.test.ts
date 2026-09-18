import { describe, expect, it } from 'vitest'
import {
  SCRIPT_NAME_MAX,
  GROUP_NAME_MAX,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  clampSplitRatio,
  validateGroupName,
  validateScriptContent,
  validateScriptName
} from '../../src/shared/types'

describe('validateScriptName', () => {
  it('拒绝空字符串', () => {
    expect(validateScriptName('').ok).toBe(false)
  })

  it('拒绝纯空白', () => {
    expect(validateScriptName('   ').ok).toBe(false)
  })

  it('拒绝非字符串', () => {
    expect(validateScriptName(undefined).ok).toBe(false)
    expect(validateScriptName(123).ok).toBe(false)
  })

  it('接受 30 个字符', () => {
    expect(validateScriptName('a'.repeat(SCRIPT_NAME_MAX)).ok).toBe(true)
  })

  it('拒绝 31 个字符', () => {
    expect(validateScriptName('a'.repeat(SCRIPT_NAME_MAX + 1)).ok).toBe(false)
  })

  it('中文按字符计数:30 个汉字通过', () => {
    expect(validateScriptName('测'.repeat(30)).ok).toBe(true)
  })

  it('中文按字符计数:31 个汉字被拒', () => {
    expect(validateScriptName('测'.repeat(31)).ok).toBe(false)
  })

  it('emoji 代理对按字符计数:30 个通过', () => {
    expect(validateScriptName('😀'.repeat(30)).ok).toBe(true)
  })

  it('emoji 代理对按字符计数:31 个被拒', () => {
    expect(validateScriptName('😀'.repeat(31)).ok).toBe(false)
  })
})

describe('validateGroupName', () => {
  it('接受 15 个字符', () => {
    expect(validateGroupName('a'.repeat(GROUP_NAME_MAX)).ok).toBe(true)
  })

  it('拒绝 16 个字符', () => {
    expect(validateGroupName('a'.repeat(GROUP_NAME_MAX + 1)).ok).toBe(false)
  })

  it('拒绝空字符串', () => {
    expect(validateGroupName('').ok).toBe(false)
  })
})

describe('validateScriptContent', () => {
  it('接受空内容:内容在面板里编辑,先建后写是正常状态', () => {
    expect(validateScriptContent('').ok).toBe(true)
    expect(validateScriptContent('\n\t  ').ok).toBe(true)
  })

  it('拒绝非字符串', () => {
    expect(validateScriptContent(null).ok).toBe(false)
    expect(validateScriptContent(undefined).ok).toBe(false)
    expect(validateScriptContent(42).ok).toBe(false)
  })

  it('接受有内容的脚本', () => {
    expect(validateScriptContent('echo hi').ok).toBe(true)
  })
})

describe('clampSplitRatio', () => {
  it('区间内的值原样返回', () => {
    expect(clampSplitRatio(40, 50)).toBe(40)
    expect(clampSplitRatio(SPLIT_RATIO_MIN, 50)).toBe(SPLIT_RATIO_MIN)
    expect(clampSplitRatio(SPLIT_RATIO_MAX, 50)).toBe(SPLIT_RATIO_MAX)
  })

  it('越界值夹到边界', () => {
    expect(clampSplitRatio(0, 50)).toBe(SPLIT_RATIO_MIN)
    expect(clampSplitRatio(-999, 50)).toBe(SPLIT_RATIO_MIN)
    expect(clampSplitRatio(100, 50)).toBe(SPLIT_RATIO_MAX)
  })

  it('非有限数字回落默认值', () => {
    expect(clampSplitRatio(undefined, 60)).toBe(60)
    expect(clampSplitRatio(null, 60)).toBe(60)
    expect(clampSplitRatio('60', 60)).toBe(60)
    expect(clampSplitRatio(NaN, 60)).toBe(60)
    expect(clampSplitRatio(Infinity, 60)).toBe(60)
  })
})
