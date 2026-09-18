import { beforeEach, describe, expect, it } from 'vitest'
import { SCRIPT_NAME_MAX, validateScriptName } from '../../src/shared/types'
import { createScriptsStore, type ScriptsData } from '../../src/main/store/scripts'

let data: ScriptsData
let store: ReturnType<typeof createScriptsStore>

beforeEach(() => {
  data = { scripts: [], groups: [] }
  store = createScriptsStore({
    read: () => data,
    write: (next) => {
      data = next
    }
  })
})

describe('分组', () => {
  it('创建分组时校验名称长度', () => {
    expect(() => store.createGroup('a'.repeat(16))).toThrowError(/15/)
    expect(data.groups).toHaveLength(0)
  })

  it('创建分组并分配递增 order', () => {
    const g1 = store.createGroup('后端')
    const g2 = store.createGroup('前端')
    expect(g1.name).toBe('后端')
    expect(g1.order).toBe(0)
    expect(g2.order).toBe(1)
    expect(data.groups).toHaveLength(2)
  })

  it('删除分组时其下脚本的 groupId 置空', () => {
    const g = store.createGroup('后端')
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: g.id })
    expect(s.groupId).toBe(g.id)
    store.deleteGroup(g.id)
    expect(store.listScripts()[0].groupId).toBeNull()
    expect(data.groups).toHaveLength(0)
  })

  it('更新分组名称超长被拒', () => {
    const g = store.createGroup('A')
    expect(() => store.updateGroup(g.id, 'a'.repeat(16))).toThrowError(/15/)
    expect(data.groups[0].name).toBe('A')
  })

  it('更新不存在的分组抛错', () => {
    expect(() => store.updateGroup('nope', 'X')).toThrowError(/不存在/)
  })
})

describe('脚本', () => {
  it('创建脚本时校验名称超长', () => {
    expect(() => store.createScript({ name: 'a'.repeat(31), content: 'echo', groupId: null })).toThrowError(/30/)
  })

  it('允许空内容:内容在面板里编辑,先建后写是正常状态', () => {
    expect(store.createScript({ name: 'a', content: '', groupId: null }).content).toBe('')
  })

  it('允许 groupId 为 null(分组不必选)', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    expect(s.groupId).toBeNull()
  })

  it('创建时未指定 shell,落 null 表示跟随全局', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    expect(s.shellId).toBeNull()
  })

  it('创建时可一并指定脚本级 shell', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null, shellId: 'zsh' })
    expect(s.shellId).toBe('zsh')
    expect(store.listScripts()[0].shellId).toBe('zsh')
  })

  it('更新时可改写脚本级 shell', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null, shellId: 'zsh' })
    expect(store.updateScript(s.id, { shellId: 'bash' }).shellId).toBe('bash')
  })

  it('更新时置 null 表示清空覆盖,回到跟随全局', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null, shellId: 'zsh' })
    expect(store.updateScript(s.id, { shellId: null }).shellId).toBeNull()
  })

  it('更新名称时同样执行长度校验', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    expect(() => store.updateScript(s.id, { name: 'b'.repeat(31) })).toThrowError(/30/)
    expect(store.listScripts()[0].name).toBe('a')
  })

  it('更新时刷新 updatedAt', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    const before = s.updatedAt
    const updated = store.updateScript(s.id, { content: 'echo b' })
    expect(updated.content).toBe('echo b')
    expect(updated.updatedAt >= before).toBe(true)
  })

  it('删除脚本', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    store.deleteScript(s.id)
    expect(store.listScripts()).toHaveLength(0)
  })

  it('按 ids 重排脚本 order', () => {
    const a = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    const b = store.createScript({ name: 'b', content: 'echo b', groupId: null })
    const c = store.createScript({ name: 'c', content: 'echo c', groupId: null })
    store.reorderScripts([c.id, a.id, b.id])
    expect(store.listScripts().map((s) => s.id)).toEqual([c.id, a.id, b.id])
    expect(store.listScripts().map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('将脚本移入分组', () => {
    const g = store.createGroup('后端')
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    const moved = store.updateScript(s.id, { groupId: g.id })
    expect(moved.groupId).toBe(g.id)
  })

  it('操作不存在的脚本时抛错', () => {
    expect(() => store.updateScript('nope', { name: 'x' })).toThrowError(/不存在/)
    expect(() => store.deleteScript('nope')).toThrowError(/不存在/)
  })
})

describe('脚本复制', () => {
  it('照搬内容、分组与脚本级 shell', () => {
    const g = store.createGroup('后端')
    const s = store.createScript({
      name: '构建',
      content: 'echo build',
      groupId: g.id,
      shellId: 'bash'
    })

    const copy = store.duplicateScript(s.id)

    expect(copy.id).not.toBe(s.id)
    expect(copy.content).toBe('echo build')
    expect(copy.groupId).toBe(g.id)
    expect(copy.shellId).toBe('bash')
  })

  it('副本名称在原名称后追加「副本」', () => {
    const s = store.createScript({ name: '构建', content: 'echo build', groupId: null })
    expect(store.duplicateScript(s.id).name).toBe('构建 副本')
  })

  it('同名副本已存在时名称递增,不会产生两个同名脚本', () => {
    const s = store.createScript({ name: '构建', content: 'echo build', groupId: null })
    expect(store.duplicateScript(s.id).name).toBe('构建 副本')
    expect(store.duplicateScript(s.id).name).toBe('构建 副本 2')
    expect(store.duplicateScript(s.id).name).toBe('构建 副本 3')
  })

  it('原名称接近长度上限时先截断再加后缀,结果仍合法', () => {
    const s = store.createScript({ name: 'a'.repeat(SCRIPT_NAME_MAX), content: 'echo a', groupId: null })

    const copy = store.duplicateScript(s.id)

    expect(Array.from(copy.name).length).toBeLessThanOrEqual(SCRIPT_NAME_MAX)
    expect(copy.name.endsWith(' 副本')).toBe(true)
    expect(validateScriptName(copy.name).ok).toBe(true)
  })

  it('副本排在同一分组的原脚本正后方', () => {
    const g = store.createGroup('后端')
    const a = store.createScript({ name: 'a', content: 'echo a', groupId: g.id })
    const b = store.createScript({ name: 'b', content: 'echo b', groupId: g.id })
    const c = store.createScript({ name: 'c', content: 'echo c', groupId: g.id })

    const copy = store.duplicateScript(b.id)

    expect(store.listScripts().map((s) => s.id)).toEqual([a.id, b.id, copy.id, c.id])
    expect(store.listScripts().map((s) => s.order)).toEqual([0, 1, 2, 3])
  })

  it('连续复制同一个脚本时,副本按名称递增顺序排在原脚本之后', () => {
    const s = store.createScript({ name: '构建', content: 'echo build', groupId: null })

    store.duplicateScript(s.id)
    store.duplicateScript(s.id)
    store.duplicateScript(s.id)

    expect(store.listScripts().map((x) => x.name)).toEqual([
      '构建',
      '构建 副本',
      '构建 副本 2',
      '构建 副本 3'
    ])
  })

  it('复制不存在的脚本时抛错', () => {
    expect(() => store.duplicateScript('nope')).toThrowError(/不存在/)
  })
})

describe('分组重排', () => {
  it('按 ids 重排分组 order', () => {
    const g1 = store.createGroup('A')
    const g2 = store.createGroup('B')
    store.reorderGroups([g2.id, g1.id])
    expect(store.listGroups().map((g) => g.id)).toEqual([g2.id, g1.id])
    expect(store.listGroups().map((g) => g.order)).toEqual([0, 1])
  })
})
