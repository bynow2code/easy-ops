import { describe, expect, it } from 'vitest'
import { nextTitle } from '../../src/main/pty/title'

describe('nextTitle', () => {
  it('无同名时使用原始名称', () => {
    expect(nextTitle('启动服务', [])).toBe('启动服务')
  })

  it('存在同名时追加 (2)', () => {
    expect(nextTitle('启动服务', ['启动服务'])).toBe('启动服务 (2)')
  })

  it('继续冲突时递增', () => {
    expect(nextTitle('启动服务', ['启动服务', '启动服务 (2)'])).toBe('启动服务 (3)')
  })

  it('忽略不相关标题', () => {
    expect(nextTitle('a', ['b', 'c (2)'])).toBe('a')
  })

  it('名称内含括号时仍正确递增', () => {
    expect(nextTitle('a (2)', ['a (2)'])).toBe('a (2) (2)')
  })
})
