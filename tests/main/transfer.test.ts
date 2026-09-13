import { describe, expect, it } from 'vitest'
import {
  buildExportPayload,
  EXIT_MARKER_TYPE,
  filterPortableSettings,
  parseImport,
  toLegacyMigration
} from '../../src/main/store/transfer'
import type { Group, Script, Settings } from '../../src/shared/types'

const SETTINGS: Settings = {
  theme: 'dark',
  shellId: 'zsh',
  customShells: [{ id: 'custom:/opt/zsh', name: 'zsh', path: '/opt/zsh' }],
  checkUpdateOnLaunch: false
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
  return { id: 'g1', name: '后端', order: 0, createdAt: '2026-01-01T00:00:00.000Z', ...over }
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
    expect(result.mode).toBe('v2')
    if (result.mode !== 'v2') return
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

  it('拒绝 v2 中内容为空的脚本', () => {
    const payload = buildExportPayload([makeScript({ content: '   ' })], [], SETTINGS)
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(false)
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

describe('parseImport — 裸数组(旧版 userData)', () => {
  it('识别裸数组为 legacy', () => {
    const legacy = [{ id: '1', name: 'a', content: 'echo a', group: 'backend', orderNum: 0 }]
    const result = parseImport(JSON.stringify(legacy))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mode).toBe('legacy')
  })
})

describe('parseImport — 旧版导出格式', () => {
  it('识别 easyops-scripts-config', () => {
    const legacy = {
      type: 'easyops-scripts-config',
      version: 1,
      exportedAt: '2025-01-01T00:00:00.000Z',
      scripts: [{ id: '1', name: 'a', content: 'echo a', group: 'frontend', orderNum: 0 }]
    }
    const result = parseImport(JSON.stringify(legacy))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mode).toBe('legacy')
    if (result.mode !== 'legacy') return
    expect(result.legacyScripts).toHaveLength(1)
  })
})

describe('toLegacyMigration', () => {
  it('把 group 字符串去重生成分组实体并回填 groupId', () => {
    const legacy = [
      { id: '1', name: 'a', content: 'echo a', group: 'backend', orderNum: 1 },
      { id: '2', name: 'b', content: 'echo b', group: 'frontend', orderNum: 0 },
      { id: '3', name: 'c', content: 'echo c', group: 'backend', orderNum: 2 }
    ]
    const result = toLegacyMigration(legacy)
    expect(result.groups.map((g) => g.name).sort()).toEqual(['backend', 'frontend'])
    expect(result.scripts).toHaveLength(3)
    expect(result.scripts.find((s) => s.id === '1')!.groupId).toBe(
      result.groups.find((g) => g.name === 'backend')!.id
    )
    expect(result.scripts.find((s) => s.id === '3')!.groupId).toBe(
      result.groups.find((g) => g.name === 'backend')!.id
    )
  })

  it('保留 orderNum 为 order', () => {
    const result = toLegacyMigration([{ id: '1', name: 'a', content: 'x', group: 'backend', orderNum: 7 }])
    expect(result.scripts[0].order).toBe(7)
  })

  it('group 为空时归入未分组', () => {
    const result = toLegacyMigration([{ id: '1', name: 'a', content: 'x' }])
    expect(result.scripts[0].groupId).toBeNull()
    expect(result.groups).toHaveLength(0)
  })

  it('跳过名称超长或内容为空的记录并记录 warning', () => {
    const legacy = [
      { id: '1', name: 'a'.repeat(31), content: 'x' },
      { id: '2', name: 'ok', content: '   ' },
      { id: '3', name: 'good', content: 'echo ok' }
    ]
    const result = toLegacyMigration(legacy)
    expect(result.scripts).toHaveLength(1)
    expect(result.scripts[0].id).toBe('3')
    expect(result.warnings.length).toBe(2)
  })

  it('无 id 时补生成 id', () => {
    const result = toLegacyMigration([{ name: 'a', content: 'x' }])
    expect(result.scripts[0].id.length).toBeGreaterThan(0)
  })

  it('非数组输入返回空结果', () => {
    const result = toLegacyMigration(null)
    expect(result.scripts).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
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
})
