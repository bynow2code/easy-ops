import { beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, DEFAULT_SETTINGS } from '../../src/main/store/settings'
import {
  DEFAULT_DETAIL_SPLIT_RATIO,
  DEFAULT_MAIN_SPLIT_RATIO,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  type Settings
} from '../../src/shared/types'

let saved: Settings
let store: ReturnType<typeof createSettingsStore>

beforeEach(() => {
  saved = { ...DEFAULT_SETTINGS }
  store = createSettingsStore({
    read: () => saved,
    write: (next) => {
      saved = next
    }
  })
})

describe('settingsStore', () => {
  it('默认主题为 system', () => {
    expect(store.get().theme).toBe('system')
  })

  it('接受合法主题值', () => {
    expect(store.update({ theme: 'dark' }).theme).toBe('dark')
    expect(saved.theme).toBe('dark')
  })

  it('拒绝非法主题值', () => {
    expect(() => store.update({ theme: 'blue' as never })).toThrowError(/主题/)
  })

  it('把空字符串 shellId 归一化为 null', () => {
    expect(store.update({ shellId: '' }).shellId).toBeNull()
    expect(store.update({ shellId: 'zsh' }).shellId).toBe('zsh')
  })

  it('过滤掉结构不完整的自定义 shell', () => {
    const result = store.update({
      customShells: [
        { id: 'custom:/bin/x', name: 'x', path: '/bin/x' },
        { id: 'bad', name: 'missing path' } as never
      ]
    })
    expect(result.customShells).toHaveLength(1)
    expect(result.customShells[0].path).toBe('/bin/x')
  })

  it('get 返回副本,外部修改不影响内部状态', () => {
    const a = store.get()
    a.theme = 'dark'
    expect(store.get().theme).toBe('system')
  })
})

describe('分栏比例', () => {
  it('默认左右各半、左半上下 60/40', () => {
    expect(store.get().mainSplitRatio).toBe(50)
    expect(store.get().detailSplitRatio).toBe(60)
  })

  it('接受区间内的比例', () => {
    expect(store.update({ mainSplitRatio: 35 }).mainSplitRatio).toBe(35)
    expect(store.update({ detailSplitRatio: 70 }).detailSplitRatio).toBe(70)
  })

  it('越界的值被夹到区间边界,而不是原样存下', () => {
    expect(store.update({ mainSplitRatio: 5 }).mainSplitRatio).toBe(SPLIT_RATIO_MIN)
    expect(store.update({ mainSplitRatio: 95 }).mainSplitRatio).toBe(SPLIT_RATIO_MAX)
    // 两条各自独立夹紧,互不影响
    expect(store.update({ detailSplitRatio: 0 }).detailSplitRatio).toBe(SPLIT_RATIO_MIN)
  })

  it('非数字一律回落默认值,挡住脏配置', () => {
    for (const bad of [null, undefined, '60', NaN, Infinity] as unknown[]) {
      expect(store.update({ mainSplitRatio: bad as never }).mainSplitRatio).toBe(
        DEFAULT_MAIN_SPLIT_RATIO
      )
      expect(store.update({ detailSplitRatio: bad as never }).detailSplitRatio).toBe(
        DEFAULT_DETAIL_SPLIT_RATIO
      )
    }
  })

  it('改分栏比例不会动到其它设置', () => {
    store.update({ theme: 'dark', shellId: 'zsh' })
    const next = store.update({ mainSplitRatio: 30 })
    expect(next.theme).toBe('dark')
    expect(next.shellId).toBe('zsh')
    expect(next.checkUpdateOnLaunch).toBe(DEFAULT_SETTINGS.checkUpdateOnLaunch)
  })
})
