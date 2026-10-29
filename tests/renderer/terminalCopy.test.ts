import { describe, expect, it } from 'vitest'
import { isCopyShortcut } from '../../src/renderer/src/utils/terminalCopy'

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init)

describe('终端复制快捷键判定', () => {
  it('Ctrl+Shift+C 是复制(Linux/Windows 终端惯例)', () => {
    expect(isCopyShortcut(key({ code: 'KeyC', key: 'C', ctrlKey: true, shiftKey: true }), false)).toBe(true)
  })

  it('Ctrl+C 不是复制 —— 必须留给 SIGINT', () => {
    expect(isCopyShortcut(key({ code: 'KeyC', key: 'c', ctrlKey: true }), false)).toBe(false)
  })

  it('Ctrl+Alt+Shift+C 不拦截(AltGr 组合交给终端)', () => {
    expect(
      isCopyShortcut(key({ code: 'KeyC', key: 'C', ctrlKey: true, shiftKey: true, altKey: true }), false)
    ).toBe(false)
  })

  it('Ctrl+Insert 也是复制(Windows 传统键)', () => {
    expect(isCopyShortcut(key({ code: 'Insert', key: 'Insert', ctrlKey: true }), false)).toBe(true)
  })

  it('macOS 上 Cmd+C 复制,Cmd+Shift+C 同样认', () => {
    expect(isCopyShortcut(key({ code: 'KeyC', key: 'c', metaKey: true }), true)).toBe(true)
    expect(isCopyShortcut(key({ code: 'KeyC', key: 'C', metaKey: true, shiftKey: true }), true)).toBe(true)
  })

  it('macOS 上 Ctrl+Shift+C 不是复制(那是非 mac 的约定)', () => {
    expect(isCopyShortcut(key({ code: 'KeyC', key: 'C', ctrlKey: true, shiftKey: true }), true)).toBe(false)
  })

  it('非 mac 上 Cmd/Win+C 不拦截', () => {
    expect(isCopyShortcut(key({ code: 'KeyC', key: 'c', metaKey: true }), false)).toBe(false)
  })

  it('普通字母键与别的组合键都不拦', () => {
    expect(isCopyShortcut(key({ code: 'KeyC', key: 'c' }), false)).toBe(false)
    expect(isCopyShortcut(key({ code: 'KeyV', key: 'v', ctrlKey: true, shiftKey: true }), false)).toBe(false)
  })
})
