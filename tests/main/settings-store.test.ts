import { beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, DEFAULT_SETTINGS } from '../../src/main/store/settings'
import type { Settings } from '../../src/shared/types'

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
