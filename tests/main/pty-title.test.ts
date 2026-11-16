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

describe('nextTitle —— 序号单调递增,不复用空缺', () => {
  /** 连开 n 张同名卡片后返回其标题列表(模拟多次执行同一脚本) */
  const openMany = (n: number): string[] => {
    const titles: string[] = []
    for (let i = 0; i < n; i += 1) titles.push(nextTitle('构建', titles))
    return titles
  }

  it('连开 4 个得到 构建 / (2) / (3) / (4)', () => {
    expect(openMany(4)).toEqual(['构建', '构建 (2)', '构建 (3)', '构建 (4)'])
  })

  it('关掉中间的 (2) 后再开,拿到 (5) 而不是复用 (2)', () => {
    // 卡片最新的在最上:复用 (2) 会出现 4 / 3 / 2 / 1 的错乱读数(用户报的 bug)
    const rest = openMany(4).filter((t) => t !== '构建 (2)')
    expect(nextTitle('构建', rest)).toBe('构建 (5)')
  })

  it('关掉基础名后再开,也不回填基础名', () => {
    // 回填会让新卡片被当成「第一个」,(2)(3)(4) 反而成了它「前面」的序号
    const rest = openMany(4).filter((t) => t !== '构建')
    expect(nextTitle('构建', rest)).toBe('构建 (5)')
  })

  it('只剩 (2)(3) 时新卡片是 (4)', () => {
    expect(nextTitle('构建', ['构建 (2)', '构建 (3)'])).toBe('构建 (4)')
  })

  it('基础名与序号都不冲突时仍用基础名', () => {
    expect(nextTitle('构建', ['部署', '部署 (2)'])).toBe('构建')
  })

  it('末尾括号非数字的残留标题不算同族,不抬高序号', () => {
    // 例如手工改过或旧版本产生的「构建 (旧)」
    expect(nextTitle('构建', ['构建 (旧)'])).toBe('构建')
  })
})
