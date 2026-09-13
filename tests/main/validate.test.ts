import { describe, expect, it } from 'vitest'
import {
  SCRIPT_NAME_MAX,
  GROUP_NAME_MAX,
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
  it('拒绝空内容', () => {
    expect(validateScriptContent('').ok).toBe(false)
  })

  it('拒绝纯空白内容', () => {
    expect(validateScriptContent('\n\t  ').ok).toBe(false)
  })

  it('接受有内容的脚本', () => {
    expect(validateScriptContent('echo hi').ok).toBe(true)
  })
})
