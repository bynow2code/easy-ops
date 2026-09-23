import { describe, expect, it } from 'vitest'
import { rangeBetween } from '../../src/renderer/src/utils/multiSelect'

// 模拟树前序扁平列表:g1 下 s1、s2,顶层 s3、s4
const order = ['s1', 's2', 's3', 's4']

describe('rangeBetween(Shift 范围选择)', () => {
  it('正向范围:含两端', () => {
    expect(rangeBetween(order, 's1', 's3')).toEqual(['s1', 's2', 's3'])
  })

  it('反向范围:锚点在目标之后,结果仍按视觉顺序排列', () => {
    expect(rangeBetween(order, 's3', 's1')).toEqual(['s1', 's2', 's3'])
  })

  it('相邻两行:只含两行', () => {
    expect(rangeBetween(order, 's2', 's3')).toEqual(['s2', 's3'])
  })

  it('锚点与目标是同一行:只含该行', () => {
    expect(rangeBetween(order, 's2', 's2')).toEqual(['s2'])
  })

  it('锚点为 null(无锚点):等价普通单击,只含目标', () => {
    expect(rangeBetween(order, null, 's3')).toEqual(['s3'])
  })

  it('锚点不在列表里(已删/脏数据):回退为只含目标', () => {
    expect(rangeBetween(order, 'ghost', 's3')).toEqual(['s3'])
  })
})
