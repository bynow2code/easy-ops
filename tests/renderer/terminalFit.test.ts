import { describe, expect, it } from 'vitest'
import { isSignificantResize, terminalSizeChanged } from '../../src/renderer/src/utils/terminalFit'

describe('终端容器尺寸判定', () => {
  it('首次(prev 为空)必须 fit', () => {
    expect(isSignificantResize(null, { width: 800, height: 300 })).toBe(true)
  })

  it('尺寸完全相同不重排 —— 浮层闪现引起的重复回调应该被吃掉', () => {
    expect(isSignificantResize({ width: 800, height: 300 }, { width: 800, height: 300 })).toBe(false)
  })

  it('亚像素差异不重排', () => {
    expect(isSignificantResize({ width: 800, height: 300 }, { width: 800.4, height: 299.6 })).toBe(false)
  })

  it('宽或高变化达到 1px 就重排', () => {
    expect(isSignificantResize({ width: 800, height: 300 }, { width: 799, height: 300 })).toBe(true)
    expect(isSignificantResize({ width: 800, height: 300 }, { width: 800, height: 301 })).toBe(true)
  })
})

describe('pty.resize 的必要性判定', () => {
  it('行列都没变时不发 resize', () => {
    expect(terminalSizeChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false)
  })

  it('列数或行数变化时要发 resize', () => {
    expect(terminalSizeChanged({ cols: 80, rows: 24 }, { cols: 81, rows: 24 })).toBe(true)
    expect(terminalSizeChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 25 })).toBe(true)
  })
})
