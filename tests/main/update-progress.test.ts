import { describe, expect, it } from 'vitest'
import {
  createPercentReporter,
  parseContentLength,
  toDownloadPercent
} from '../../src/main/updater/progress'

describe('parseContentLength', () => {
  it('解析合法的 content-length', () => {
    expect(parseContentLength('115112002')).toBe(115112002)
  })

  it('缺失或非法时返回 null,而不是 0', () => {
    // 0 会被当成合法分母并算出 Infinity,必须挡在门外
    expect(parseContentLength(null)).toBeNull()
    expect(parseContentLength('')).toBeNull()
    expect(parseContentLength('0')).toBeNull()
    expect(parseContentLength('-1')).toBeNull()
    expect(parseContentLength('chunked')).toBeNull()
  })
})

describe('toDownloadPercent', () => {
  it('按已下载字节换算百分比', () => {
    expect(toDownloadPercent(50, 100)).toBe(50)
    expect(toDownloadPercent(1, 4)).toBe(25)
  })

  it('下载完成时为 100', () => {
    expect(toDownloadPercent(115112002, 115112002)).toBe(100)
  })

  it('超出总长度时夹紧在 100(重定向后长度口径不一致也不越界)', () => {
    expect(toDownloadPercent(120, 100)).toBe(100)
  })

  it('取整向下,不提前虚报进度', () => {
    expect(toDownloadPercent(99, 1000)).toBe(9)
  })

  it('总长度未知时返回 null —— 宁可不显示进度,也不虚报', () => {
    expect(toDownloadPercent(1024, null)).toBeNull()
    expect(toDownloadPercent(1024, 0)).toBeNull()
  })
})

describe('createPercentReporter', () => {
  it('百分比没变化就不上报,避免每个 chunk 都过一次 IPC', () => {
    const seen: number[] = []
    const report = createPercentReporter((percent) => seen.push(percent))

    // 同一个百分比内的多个 chunk
    report(1, 1000)
    report(5, 1000)
    report(9, 1000)
    expect(seen).toEqual([0])

    report(10, 1000)
    expect(seen).toEqual([0, 1])
  })

  it('慢速下载的全过程都能看到进度递增,而不是一直 0', () => {
    const seen: number[] = []
    const report = createPercentReporter((percent) => seen.push(percent))

    const total = 115112002
    for (let received = 0; received <= total; received += total / 20) {
      report(Math.floor(received), total)
    }
    report(total, total)

    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBe(100)
    // 单调不降,且确实跨过了中间档位
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(seen.length).toBeGreaterThan(10)
  })

  it('总长度未知时不上报任何进度(渲染层维持初始态,不虚报数字)', () => {
    const seen: number[] = []
    const report = createPercentReporter((percent) => seen.push(percent))

    report(1024, null)
    report(8192, null)
    expect(seen).toEqual([])
  })
})
