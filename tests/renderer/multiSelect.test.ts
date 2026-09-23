import { describe, expect, it } from 'vitest'
import {
  buildBatchDeletePlan,
  rangeBetween,
  resolveShiftAnchor
} from '../../src/renderer/src/utils/multiSelect'

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

describe('buildBatchDeletePlan(批量删除方案)', () => {
  const item = (id: string, name: string): { id: string; name: string } => ({ id, name })

  it('目标为空:返回 null(调用方提示而非弹确认框)', () => {
    expect(buildBatchDeletePlan([], ['s1'])).toBeNull()
    expect(buildBatchDeletePlan([item('s1', 'A')], [])).toBeNull()
  })

  it('脏 id 被求交剔除:只保留现存项', () => {
    const plan = buildBatchDeletePlan([item('s1', 'A')], ['s1', 'ghost'])
    expect(plan?.targets).toEqual([{ id: 's1', name: 'A' }])
    // 正文只按「剔除后的实际目标数」报数:请求了 2 个但只剩 1 个有效目标,
    // 必须报 1 —— 报 2 会让用户以为幽灵 id 也会被删。
    expect(plan?.content).toContain('确定删除 1 个脚本')
  })

  it('正文含不可撤销警示', () => {
    expect(buildBatchDeletePlan([item('s1', 'A')], ['s1'])?.content).toContain('不可撤销')
  })

  it('单目标文案与批量同句式:确定删除 1 个脚本(不做单复数变体)', () => {
    const plan = buildBatchDeletePlan([item('s1', 'A')], ['s1'])
    expect(plan?.content).toBe('确定删除 1 个脚本?此操作不可撤销。')
  })

  it('多目标:正文只含总数,不列任何脚本名(2026-09-23 用户定稿)', () => {
    const scripts = [1, 2, 3, 4, 5].map((i) => item(`s${i}`, `脚本${i}`))
    const plan = buildBatchDeletePlan(scripts, scripts.map((s) => s.id))
    expect(plan?.content).toBe('确定删除 5 个脚本?此操作不可撤销。')
    // 名字对决策没帮助,且长名字会让确认框臃肿 —— 锁住「不出现名字」这条约定
    expect(plan?.content).not.toContain('「')
    expect(plan?.content).not.toContain('脚本1')
    // 早期版本会用「等 N 个脚本」收尾,现已完全废弃
    expect(plan?.content).not.toContain('等')
  })

  it('超过 10 个目标同样只报数:不截断、不收尾、名字一律不出现', () => {
    const scripts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) =>
      item(`s${i}`, `一个很长的脚本名字${i}`)
    )
    const plan = buildBatchDeletePlan(scripts, scripts.map((s) => s.id))
    expect(plan?.content).toBe('确定删除 12 个脚本?此操作不可撤销。')
    expect(plan?.content).not.toContain('「')
    expect(plan?.content).not.toContain('等')
  })

  it('顺序跟随列表顺序,而非请求 id 顺序(文案与列表视觉一致)', () => {
    const scripts = [item('s2', '第二个'), item('s1', '第一个')]
    const plan = buildBatchDeletePlan(scripts, ['s1', 's2'])
    expect(plan?.targets.map((t) => t.id)).toEqual(['s2', 's1'])
  })
})

describe('resolveShiftAnchor(Shift 锚点有效性判定)', () => {
  it('锚点可见且未主动清空:原样返回,范围选择正常展开', () => {
    expect(resolveShiftAnchor(order, 's2', false)).toBe('s2')
  })

  it('锚点为 null(从未点击过):返回 null,调用方会顺手立锚', () => {
    expect(resolveShiftAnchor(order, null, false)).toBeNull()
  })

  it('用户刚主动清空过选区(Esc/搜索):锚点作废,即使它仍在可见前序里', () => {
    expect(resolveShiftAnchor(order, 's2', true)).toBeNull()
  })

  it('锚点因所在目录被折叠而不可见:返回 null,避免范围选择塌缩成空选区(I-A)', () => {
    // 's9' 不在可见前序里(它的目录被折叠了 / 或它已被删)
    expect(resolveShiftAnchor(order, 's9', false)).toBeNull()
    // 对照组:若直接把失效锚点喂给 rangeBetween,只会拿到 [target](丢掉「无锚点」语义)
    expect(rangeBetween(order, 's9', 's3')).toEqual(['s3'])
  })

  it('空列表(搜索无结果):任何锚点都作废', () => {
    expect(resolveShiftAnchor([], 's1', false)).toBeNull()
  })
})
