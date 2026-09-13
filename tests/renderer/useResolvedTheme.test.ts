import { describe, expect, it } from 'vitest'
import { resolveTheme } from '../../src/renderer/src/theme/useResolvedTheme'

describe('resolveTheme', () => {
  it('light 直接返回 light', () => {
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('dark 直接返回 dark', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
  })

  it('system 跟随系统为深色', () => {
    expect(resolveTheme('system', true)).toBe('dark')
  })

  it('system 跟随系统为浅色', () => {
    expect(resolveTheme('system', false)).toBe('light')
  })
})
