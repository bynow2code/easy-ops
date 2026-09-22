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

describe('折叠目录持久化(collapsedGroupIds)', () => {
  it('默认折叠集合为空(旧配置无此字段,读盘合并回落)', () => {
    expect(store.get().collapsedGroupIds).toEqual([])
  })

  it('接受合法 id 数组并原样存取', () => {
    const next = store.update({ collapsedGroupIds: ['g1', 'g2'] })
    expect(next.collapsedGroupIds).toEqual(['g1', 'g2'])
    expect(saved.collapsedGroupIds).toEqual(['g1', 'g2'])
  })

  it('非数组一律回落空集合,数组内非字符串项被过滤', () => {
    expect(store.update({ collapsedGroupIds: 'g1' as never }).collapsedGroupIds).toEqual([])
    expect(store.update({ collapsedGroupIds: null as never }).collapsedGroupIds).toEqual([])
    const dirty = store.update({ collapsedGroupIds: ['g1', 123, '', 'g2'] as never })
    expect(dirty.collapsedGroupIds).toEqual(['g1', 'g2'])
  })

  it('更新折叠集合不会动到其它设置', () => {
    store.update({ theme: 'dark' })
    const next = store.update({ collapsedGroupIds: ['g9'] })
    expect(next.theme).toBe('dark')
    expect(next.mainSplitRatio).toBe(DEFAULT_MAIN_SPLIT_RATIO)
  })

  it('get/update 返回值与内部数组隔离,外部 push 不穿透', () => {
    store.update({ collapsedGroupIds: ['g1'] })
    const a = store.get()
    a.collapsedGroupIds.push('hacked')
    expect(store.get().collapsedGroupIds).toEqual(['g1'])

    const b = store.update({ collapsedGroupIds: ['g2'] })
    b.collapsedGroupIds.push('hacked2')
    expect(store.get().collapsedGroupIds).toEqual(['g2'])
    expect(saved.collapsedGroupIds).toEqual(['g2'])
  })
})

describe('读盘脏数据防御(collapsedGroupIds)', () => {
  function storeWithDisk(disk: unknown): ReturnType<typeof createSettingsStore> {
    return createSettingsStore({
      read: () => disk as Settings,
      write: (next) => {
        saved = next
      }
    })
  }

  it('手改配置的脏值在构造缓存时被清洗,不被 get 透出', () => {
    for (const bad of [null, 'oops', 123]) {
      expect(storeWithDisk({ ...DEFAULT_SETTINGS, collapsedGroupIds: bad }).get().collapsedGroupIds).toEqual([])
    }
  })

  it('数组内的非字符串/空串/重复项被过滤去重', () => {
    const dirty = storeWithDisk({ ...DEFAULT_SETTINGS, collapsedGroupIds: ['g1', 123, '', 'g1', 'g2'] })
    expect(dirty.get().collapsedGroupIds).toEqual(['g1', 'g2'])
  })

  it('脏值被清洗后,不涉及该字段的 update 不会再把脏值固化回磁盘', () => {
    const cleanStore = storeWithDisk({ ...DEFAULT_SETTINGS, collapsedGroupIds: null })
    const next = cleanStore.update({ theme: 'dark' })
    expect(next.collapsedGroupIds).toEqual([])
    expect(saved.collapsedGroupIds).toEqual([])
  })
})
