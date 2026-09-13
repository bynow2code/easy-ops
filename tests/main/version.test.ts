import { describe, expect, it } from 'vitest'
import { compareVersions, decideMacUpdateAction, isNewer, normalizeVersion } from '../../src/main/updater/version'

describe('normalizeVersion', () => {
  it('去掉前缀 v', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
  })

  it('保留纯数字版本号', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
  })
})

describe('compareVersions', () => {
  it('主版本更大时返回 1', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })

  it('相等返回 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('补丁版本更小时返回 -1', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
  })

  it('忽略 v 前缀', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('段数不同时按缺失段为 0 比较', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })
})

describe('isNewer', () => {
  it('远端更大时为 true', () => {
    expect(isNewer('0.7.15', 'v0.8.0')).toBe(true)
  })

  it('远端更小时为 false', () => {
    expect(isNewer('0.8.0', 'v0.7.15')).toBe(false)
  })
})

describe('decideMacUpdateAction', () => {
  it('应用位于 /Applications 且有写权限时可自动替换', () => {
    expect(
      decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: true })
    ).toBe('auto-replace')
  })

  it('应用不在 /Applications 时回退为引导手动下载', () => {
    expect(decideMacUpdateAction({ appPath: '/Users/x/Downloads/EasyOps.app', canWriteTarget: true })).toBe(
      'manual-download'
    )
  })

  it('无写权限时回退为引导手动下载', () => {
    expect(
      decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: false })
    ).toBe('manual-download')
  })

  it('路径同时满足但权限不足时不得自动替换', () => {
    expect(decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: false })).not.toBe(
      'auto-replace'
    )
  })
})
