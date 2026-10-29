import { describe, expect, it } from 'vitest'
import {
  buildExportPayload,
  EXIT_MARKER_TYPE,
  filterPortableSettings,
  parseImport
} from '../../src/main/store/transfer'
import {
  DEFAULT_DETAIL_SPLIT_RATIO,
  DEFAULT_MAIN_SPLIT_RATIO,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  type Group,
  type Script,
  type Settings
} from '../../src/shared/types'

const SETTINGS: Settings = {
  theme: 'dark',
  shellId: 'zsh',
  customShells: [{ id: 'custom:/opt/zsh', name: 'zsh', path: '/opt/zsh' }],
  checkUpdateOnLaunch: false,
  mainSplitRatio: 50,
  detailSplitRatio: 60,
  collapsedGroupIds: []
}

function makeScript(over: Partial<Script> = {}): Script {
  return {
    id: 's1',
    name: 'a',
    content: 'echo a',
    groupId: null,
    shellId: null,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

function makeGroup(over: Partial<Group> = {}): Group {
  return { id: 'g1', name: '后端', parentId: null, order: 0, createdAt: '2026-01-01T00:00:00.000Z', ...over }
}

describe('buildExportPayload', () => {
  it('生成 v2 格式与时间戳', () => {
    const payload = buildExportPayload([makeScript()], [makeGroup()], SETTINGS)
    expect(payload.type).toBe(EXIT_MARKER_TYPE)
    expect(payload.version).toBe(2)
    expect(typeof payload.exportedAt).toBe('string')
    expect(payload.scripts).toHaveLength(1)
    expect(payload.groups).toHaveLength(1)
  })
})

describe('parseImport — v2', () => {
  it('识别 v2 载荷', () => {
    const payload = buildExportPayload([makeScript()], [makeGroup()], SETTINGS)
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.scripts).toHaveLength(1)
  })

  it('拒绝非法 JSON', () => {
    const result = parseImport('{ not json')
    expect(result.ok).toBe(false)
  })

  it('拒绝 v2 中 name 超长的脚本', () => {
    const payload = buildExportPayload([makeScript({ name: 'a'.repeat(31) })], [], SETTINGS)
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(false)
  })

  it('接受 v2 中内容为空的脚本:先建后写是合法状态', () => {
    const payload = buildExportPayload([makeScript({ content: '' })], [], SETTINGS)
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.scripts[0].content).toBe('')
  })

  it('拒绝缺少 id 的脚本', () => {
    const raw = JSON.stringify({
      type: 'easyops-config',
      version: 2,
      scripts: [{ name: 'a', content: 'echo a', groupId: null, shellId: null, order: 0 }],
      groups: []
    })
    const result = parseImport(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('id')
  })

  it('拒绝缺少有效 order 的脚本', () => {
    const raw = JSON.stringify({
      type: 'easyops-config',
      version: 2,
      scripts: [{ id: 's1', name: 'a', content: 'echo a', groupId: null, shellId: null }],
      groups: []
    })
    const result = parseImport(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('order')
  })

  it('拒绝 id 重复的脚本', () => {
    const payload = buildExportPayload(
      [makeScript({ content: 'echo a' }), makeScript({ name: 'b', content: 'echo b' })],
      [],
      SETTINGS
    )
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('重复')
  })

  it('拒绝缺少 id 的分组', () => {
    const raw = JSON.stringify({
      type: 'easyops-config',
      version: 2,
      scripts: [],
      groups: [{ name: '后端', order: 0 }]
    })
    const result = parseImport(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('id')
  })

  it('拒绝 id 重复的分组', () => {
    const payload = buildExportPayload([], [makeGroup(), makeGroup({ name: '前端' })], SETTINGS)
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('重复')
  })

  it('分组 id 与脚本 id 相同不算重复', () => {
    const payload = buildExportPayload([makeScript({ id: 'x1' })], [makeGroup({ id: 'x1' })], SETTINGS)
    expect(parseImport(JSON.stringify(payload)).ok).toBe(true)
  })
})

describe('parseImport — 旧版配置(已停止支持)', () => {
  it('裸脚本数组被明确拒绝,而不是报「结构无法识别」', () => {
    const legacy = [{ id: '1', name: 'a', content: 'echo a', group: 'backend', orderNum: 0 }]
    const result = parseImport(JSON.stringify(legacy))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('旧版')
  })

  it('easyops-scripts-config 格式同样被明确拒绝', () => {
    const legacy = {
      type: 'easyops-scripts-config',
      version: 1,
      exportedAt: '2025-01-01T00:00:00.000Z',
      scripts: [{ id: '1', name: 'a', content: 'echo a', group: 'frontend', orderNum: 0 }]
    }
    const result = parseImport(JSON.stringify(legacy))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('旧版')
  })
})

describe('filterPortableSettings', () => {
  it('丢弃本机不存在的自定义 shell 并记录 warning', () => {
    const { settings, warnings } = filterPortableSettings(SETTINGS, {
      exists: (p) => p === '/bin/zsh',
      knownShellIds: ['zsh', 'bash']
    })
    expect(settings.customShells).toHaveLength(0)
    expect(warnings.length).toBe(1)
  })

  it('保留存在的自定义 shell', () => {
    const { settings, warnings } = filterPortableSettings(SETTINGS, {
      exists: (p) => p === '/opt/zsh',
      knownShellIds: ['zsh']
    })
    expect(settings.customShells).toHaveLength(1)
    expect(warnings).toHaveLength(0)
  })

  it('shellId 不在已知列表时置空', () => {
    const { settings } = filterPortableSettings(SETTINGS, {
      exists: (p) => p === '/opt/zsh',
      knownShellIds: ['bash']
    })
    expect(settings.shellId).toBeNull()
  })

  it('主题等可移植项原样保留', () => {
    const { settings } = filterPortableSettings(SETTINGS, { exists: () => true, knownShellIds: ['zsh'] })
    expect(settings.theme).toBe('dark')
    expect(settings.checkUpdateOnLaunch).toBe(false)
  })

  it('checkUpdateOnLaunch 缺失时回落为默认打开(true),不被 Boolean(undefined) 打成 false', () => {
    const { settings } = filterPortableSettings(
      // 模拟旧版配置:没有这个字段
      { theme: 'dark' } as unknown as Settings,
      { exists: () => true, knownShellIds: ['zsh'] }
    )
    expect(settings.checkUpdateOnLaunch).toBe(true)
  })
})

describe('导入时夹住分栏比例', () => {
  const ctx = { exists: () => true, knownShellIds: ['zsh'] }

  it('越界的比例被夹到合法区间', () => {
    const { settings } = filterPortableSettings(
      { ...SETTINGS, mainSplitRatio: 5, detailSplitRatio: 99 },
      ctx
    )
    expect(settings.mainSplitRatio).toBe(SPLIT_RATIO_MIN)
    expect(settings.detailSplitRatio).toBe(SPLIT_RATIO_MAX)
  })

  it('缺失或非数字时回落到默认值', () => {
    const { settings } = filterPortableSettings(
      { ...SETTINGS, mainSplitRatio: undefined as never, detailSplitRatio: '60' as never },
      ctx
    )
    expect(settings.mainSplitRatio).toBe(DEFAULT_MAIN_SPLIT_RATIO)
    expect(settings.detailSplitRatio).toBe(DEFAULT_DETAIL_SPLIT_RATIO)
  })
})
