import { beforeEach, describe, expect, it } from 'vitest'
import { SCRIPT_NAME_MAX, validateScriptName, type Group, type Script } from '../../src/shared/types'
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

  describe('嵌套分组', () => {
    it('创建子分组挂在父分组下,order 在兄弟间递增', () => {
      const root = store.createGroup('wms')
      const child1 = store.createGroup('pda', root.id)
      const child2 = store.createGroup('pda2', root.id)
      expect(child1.parentId).toBe(root.id)
      expect(child2.parentId).toBe(root.id)
      expect(child1.order).toBe(0)
      expect(child2.order).toBe(1)
    })

    it('不传 parentId 时创建顶层分组,parentId 为 null', () => {
      expect(store.createGroup('顶层').parentId).toBeNull()
    })

    it('创建时父分组不存在则抛错', () => {
      expect(() => store.createGroup('孤儿', 'nope')).toThrowError(/父分组不存在/)
    })

    it('moveGroup 换父', () => {
      const a = store.createGroup('a')
      const b = store.createGroup('b')
      store.moveGroup(a.id, b.id)
      expect(store.listGroups().find((g) => g.id === a.id)!.parentId).toBe(b.id)
    })

    it('moveGroup 换父后 order 落在新兄弟末尾', () => {
      const root = store.createGroup('root')
      const s1 = store.createGroup('s1', root.id)
      const s2 = store.createGroup('s2', root.id)
      const mover = store.createGroup('mover')
      store.moveGroup(mover.id, root.id)
      const groups = store.listGroups()
      // order 语义 = 兄弟内序号:listGroups 返回的 order 就是同层内的位置
      const moved = groups.find((g) => g.id === mover.id)!
      expect(moved.parentId).toBe(root.id)
      expect(moved.order).toBe(2)
      // 用 listGroups 的返回值断言兄弟位置,而不是 createGroup 时的过期快照
      expect(groups.find((g) => g.id === s1.id)!.order).toBe(0)
      expect(groups.find((g) => g.id === s2.id)!.order).toBe(1)
    })

    it('moveGroup 移到 null 表示移到顶层', () => {
      const root = store.createGroup('root')
      const child = store.createGroup('child', root.id)
      store.moveGroup(child.id, null)
      expect(store.listGroups().find((g) => g.id === child.id)!.parentId).toBeNull()
    })

    it('moveGroup 后新旧两层 order 连续无重复,旧层的洞被闭合', () => {
      const p1 = store.createGroup('p1')
      const p2 = store.createGroup('p2')
      const a = store.createGroup('a', p1.id)
      const b = store.createGroup('b', p1.id)
      const c = store.createGroup('c', p2.id)
      store.moveGroup(a.id, p2.id)
      const groups = store.listGroups()
      const layer1 = groups.filter((g) => g.parentId === p1.id).sort((x, y) => x.order - y.order)
      const layer2 = groups.filter((g) => g.parentId === p2.id).sort((x, y) => x.order - y.order)
      expect(layer1.map((g) => g.id)).toEqual([b.id])
      expect(layer1.map((g) => g.order)).toEqual([0])
      expect(layer2.map((g) => g.id)).toEqual([c.id, a.id])
      expect(layer2.map((g) => g.order)).toEqual([0, 1])
    })

    it('moveGroup 不能把目录移到自己或自己的后代(防环)', () => {
      const root = store.createGroup('root')
      const child = store.createGroup('child', root.id)
      const grand = store.createGroup('grand', child.id)
      expect(() => store.moveGroup(root.id, root.id)).toThrowError(/自己/)
      expect(() => store.moveGroup(root.id, grand.id)).toThrowError(/子目录/)
    })

    it('删除中间目录:子分组与脚本上移到父级,不级联删除', () => {
      const root = store.createGroup('root')
      const mid = store.createGroup('mid', root.id)
      const leaf = store.createGroup('leaf', mid.id)
      const s = store.createScript({ name: 'a', content: 'echo', groupId: mid.id })
      store.deleteGroup(mid.id)
      const groups = store.listGroups()
      expect(groups.find((g) => g.id === leaf.id)!.parentId).toBe(root.id)
      expect(store.listScripts().find((x) => x.id === s.id)!.groupId).toBe(root.id)
      expect(groups.some((g) => g.id === mid.id)).toBe(false)
    })

    it('删除顶层目录:子目录与脚本落到顶层', () => {
      const top = store.createGroup('top')
      const child = store.createGroup('child', top.id)
      const s = store.createScript({ name: 'x', content: 'echo', groupId: top.id })
      store.deleteGroup(top.id)
      const groups = store.listGroups()
      expect(groups.find((g) => g.id === child.id)!.parentId).toBeNull()
      expect(store.listScripts().find((x) => x.id === s.id)!.groupId).toBeNull()
    })

    it('删除中间目录:子目录拼接到被删目录原位,同层 order 连续无重复', () => {
      const p = store.createGroup('p')
      const a = store.createGroup('a', p.id)
      const b = store.createGroup('b', p.id)
      const c = store.createGroup('c', a.id)
      const d = store.createGroup('d', a.id)
      store.deleteGroup(a.id)
      const layer = store.listGroups().filter((g) => g.parentId === p.id).sort((x, y) => x.order - y.order)
      // 子树整体占据被删目录的原位(排在 b 前面),不被 b 夹开
      expect(layer.map((g) => g.id)).toEqual([c.id, d.id, b.id])
      expect(layer.map((g) => g.order)).toEqual([0, 1, 2])
    })

    it('listGroups 返回树的前序(显示顺序),order 为兄弟内序号', () => {
      const r1 = store.createGroup('r1')
      const c1 = store.createGroup('c1', r1.id)
      const r2 = store.createGroup('r2')
      const ids = store.listGroups().map((g) => g.id)
      expect(ids).toEqual([r1.id, c1.id, r2.id])
      expect(store.listGroups().map((g) => g.order)).toEqual([0, 0, 1])
    })

    it('读取旧数据(无 parentId)时 normalize 为 null', () => {
      data = {
        scripts: [],
        // 模拟旧版本落盘:groups 没有 parentId 字段
        groups: [{ id: 'g1', name: '旧', order: 0, createdAt: '2026-01-01T00:00:00.000Z' }] as Group[]
      }
      expect(store.listGroups()[0].parentId).toBeNull()
    })
  })

  describe('损坏数据防御:parentId 清洗(normalizeGroups sanitize)', () => {
    const base = { name: 'x', order: 0, createdAt: '2026-01-01T00:00:00.000Z' }

    it('循环 parentId 读取后断环为树,所有节点可达且上溯有限步', () => {
      data = {
        scripts: [],
        groups: [
          { id: 'A', ...base, parentId: 'C' },
          { id: 'B', ...base, parentId: 'A' },
          { id: 'C', ...base, parentId: 'B' }
        ] as Group[]
      }
      const groups = store.listGroups()
      expect(groups).toHaveLength(3)
      for (const g of groups) {
        let cur: Group = g
        let steps = 0
        while (cur.parentId !== null) {
          const next: Group | undefined = groups.find((x) => x.id === cur.parentId)
          expect(next).toBeDefined()
          if (!next) break
          cur = next
          steps += 1
          expect(steps).toBeLessThan(10)
        }
      }
      // 断环后的数据上做 move,不再有死循环风险
      expect(() => store.moveGroup('A', null)).not.toThrow()
    })

    it('悬空/自引用/非字符串/空串 parentId 一律视为顶层', () => {
      data = {
        scripts: [],
        groups: [
          { id: 'g1', ...base, parentId: 'ghost' },
          { id: 'g2', ...base, parentId: 'g2' },
          { id: 'g3', ...base, parentId: 123 },
          { id: 'g4', ...base, parentId: '' }
        ] as unknown as Group[]
      }
      const groups = store.listGroups()
      expect(groups.map((g) => g.parentId)).toEqual([null, null, null, null])
    })

    it('replaceAll 导入同样过清洗:环数据落盘前被断开', () => {
      store.replaceAll({
        scripts: [],
        groups: [
          { id: 'A', name: 'A', order: 0, parentId: 'B', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'B', name: 'B', order: 1, parentId: 'A', createdAt: '2026-01-01T00:00:00.000Z' }
        ] as Group[]
      })
      const groups = store.listGroups()
      expect(groups).toHaveLength(2)
      expect(groups.filter((g) => g.parentId === null)).toHaveLength(1)
    })

    it('replaceAll 清洗脚本里悬空的 groupId 引用为未分组', () => {
      // 导入文件只校验各自结构,不保证脚本引用的分组存在;落盘前统一归位
      store.replaceAll({
        scripts: [
          { id: 's1', name: '有分组', content: '', groupId: 'real', shellId: null, order: 0, createdAt: '', updatedAt: '' },
          { id: 's2', name: '悬空', content: '', groupId: 'ghost', shellId: null, order: 1, createdAt: '', updatedAt: '' },
          { id: 's3', name: '未分组', content: '', groupId: null, shellId: null, order: 2, createdAt: '', updatedAt: '' }
        ] as Script[],
        groups: [{ id: 'real', name: 'R', order: 0, parentId: null, createdAt: '2026-01-01T00:00:00.000Z' }]
      })
      const scripts = store.listScripts()
      expect(scripts.find((s) => s.id === 's1')!.groupId).toBe('real')
      expect(scripts.find((s) => s.id === 's2')!.groupId).toBeNull()
      expect(scripts.find((s) => s.id === 's3')!.groupId).toBeNull()
    })

    it('子目录挂在被清洗为顶层的目录下时仍保持父子关系', () => {
      // dangling 父目录被清成顶层后,指向它的子目录不该再被误判悬空
      data = {
        scripts: [],
        groups: [
          { id: 'p', name: 'p', order: 0, parentId: 'ghost', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'c', name: 'c', order: 0, parentId: 'p', createdAt: '2026-01-01T00:00:00.000Z' }
        ] as Group[]
      }
      const groups = store.listGroups()
      expect(groups.find((g) => g.id === 'p')!.parentId).toBeNull()
      expect(groups.find((g) => g.id === 'c')!.parentId).toBe('p')
    })
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
