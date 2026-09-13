import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Group, Script, Settings } from '../../src/shared/types'
import { createScriptsStore, type ScriptsData } from '../../src/main/store/scripts'
import { createSettingsStore } from '../../src/main/store/settings'
import { createMemoryPersistence } from '../../src/main/store/persistence'

// 原生文件对话框无法在 Node 环境里真实弹出,这里用可控桩替代,落盘与数据替换仍走真实 fs
vi.mock('electron', () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const state: { savePath: string | null; openPath: string | null; canceled: boolean } = {
    savePath: null,
    openPath: null,
    canceled: false
  }
  return {
    __handlers: handlers,
    __state: state,
    dialog: {
      showSaveDialog: async () =>
        state.canceled || !state.savePath ? { canceled: true } : { canceled: false, filePath: state.savePath },
      showOpenDialog: async () =>
        state.canceled || !state.openPath
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [state.openPath] }
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: any[]) => any) => {
        handlers.set(channel, fn)
      }
    }
  }
})

import * as electronMock from 'electron'
import { registerConfigIpc } from '../../src/main/ipc/config'

const mock = electronMock as unknown as {
  __handlers: Map<string, (...args: any[]) => any>
  __state: { savePath: string | null; openPath: string | null; canceled: boolean }
}

const SETTINGS: Settings = {
  theme: 'dark',
  shellId: null,
  customShells: [
    { id: 'custom:/bin/sh', name: 'sh', path: '/bin/sh' },
    { id: 'custom:/definitely/not/here', name: 'ghost', path: '/definitely/not/here' }
  ],
  checkUpdateOnLaunch: false
}

function makeScript(over: Partial<Script> = {}): Script {
  return {
    id: 's1',
    name: 'a',
    content: 'echo a',
    groupId: 'g1',
    shellId: null,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

const GROUPS: Group[] = [{ id: 'g1', name: '后端', order: 0, createdAt: '2026-01-01T00:00:00.000Z' }]

let tmpDir = ''
let scripts: ReturnType<typeof createScriptsStore>
let settings: ReturnType<typeof createSettingsStore>
let call: (channel: string, payload?: unknown) => Promise<any>

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easyops-config-'))
  const scriptsData: ScriptsData = { scripts: [makeScript()], groups: GROUPS }
  scripts = createScriptsStore(createMemoryPersistence<ScriptsData>(scriptsData))
  settings = createSettingsStore(createMemoryPersistence<Settings>({ ...SETTINGS }))
  registerConfigIpc({ getWindow: () => null, scripts, settings })
  call = async (channel, payload) => mock.__handlers.get(channel)!(null, payload)
})

afterAll(async () => {
  // 宿主 safe-delete shim 可能拦截临时目录清理,失败不影响断言
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
})

describe('config:export', () => {
  it('写出 v2 载荷到所选路径', async () => {
    const target = path.join(tmpDir, 'out.json')
    mock.__state.canceled = false
    mock.__state.savePath = target

    const result = await call('config:export')
    expect(result.canceled).toBe(false)
    expect(result.path).toBe(target)

    const payload = await readJson(target)
    expect(payload.type).toBe('easyops-config')
    expect(payload.version).toBe(2)
    expect(payload.scripts).toHaveLength(1)
    expect(payload.groups).toHaveLength(1)
    expect(payload.settings.theme).toBe('dark')
  })

  it('取消保存对话框时不落盘', async () => {
    const target = path.join(tmpDir, 'canceled.json')
    mock.__state.canceled = true
    mock.__state.savePath = target

    const result = await call('config:export')
    expect(result.canceled).toBe(true)
    await expect(fs.access(target)).rejects.toThrow()
  })
})

describe('config:import', () => {
  it('导入 v2 后完整还原脚本、分组与可移植设置', async () => {
    const target = path.join(tmpDir, 'roundtrip.json')
    mock.__state.canceled = false
    mock.__state.savePath = target
    await call('config:export')

    const before = scripts.listScripts()
    scripts.replaceAll({ scripts: [], groups: [] })
    settings.update({ theme: 'light', checkUpdateOnLaunch: true, customShells: [] })
    expect(scripts.listScripts()).toHaveLength(0)

    mock.__state.openPath = target
    const result = await call('config:import', { mode: 'v2' })

    expect(result.canceled).toBe(false)
    expect(result.stats.imported).toBe(1)
    expect(result.stats.groups).toBe(1)
    expect(scripts.listScripts()).toEqual(before)
    expect(scripts.listGroups().map((g) => g.name)).toEqual(['后端'])
    expect(settings.get().theme).toBe('dark')
    expect(settings.get().checkUpdateOnLaunch).toBe(false)
    // 不存在的自定义 shell 被丢弃并给出中文警告
    expect(settings.get().customShells.map((s) => s.path)).toEqual(['/bin/sh'])
    expect(result.stats.warnings.join('\n')).toContain('/definitely/not/here')
  })

  it('导入旧版数组时按 group 字符串生成分组', async () => {
    const legacyFile = path.join(tmpDir, 'legacy.json')
    await fs.writeFile(
      legacyFile,
      JSON.stringify([
        { id: '1', name: 'a', content: 'echo a', group: 'backend', orderNum: 0 },
        { id: '2', name: 'b', content: 'echo b', group: 'frontend', orderNum: 1 },
        { id: '3', name: 'c', content: 'echo c', group: 'backend', orderNum: 2 }
      ]),
      'utf8'
    )

    scripts.replaceAll({ scripts: [], groups: [] })
    mock.__state.canceled = false
    mock.__state.openPath = legacyFile
    const result = await call('config:import', { mode: 'legacy' })

    expect(result.stats.imported).toBe(3)
    expect(result.stats.groups).toBe(2)
    expect(scripts.listGroups().map((g) => g.name).sort()).toEqual(['backend', 'frontend'])
    const backendId = scripts.listGroups().find((g) => g.name === 'backend')!.id
    expect(scripts.listScripts().filter((s) => s.groupId === backendId)).toHaveLength(2)
  })

  it('导入非法文件时抛中文错误且原数据保持不变', async () => {
    const badFile = path.join(tmpDir, 'bad.json')
    await fs.writeFile(badFile, '{ not json', 'utf8')

    const beforeScripts = scripts.listScripts()
    const beforeGroups = scripts.listGroups()
    const beforeSettings = settings.get()

    mock.__state.canceled = false
    mock.__state.openPath = badFile
    await expect(call('config:import', { mode: 'v2' })).rejects.toThrow('不是合法的 JSON 文件')

    expect(scripts.listScripts()).toEqual(beforeScripts)
    expect(scripts.listGroups()).toEqual(beforeGroups)
    expect(settings.get()).toEqual(beforeSettings)
  })

  it('旧数据含非法记录时导入合法部分并回报警告', async () => {
    const legacyFile = path.join(tmpDir, 'legacy-partial.json')
    await fs.writeFile(
      legacyFile,
      JSON.stringify([
        { id: '1', name: 'a'.repeat(31), content: 'echo a' },
        { id: '2', name: 'ok', content: 'echo ok', group: 'ops' }
      ]),
      'utf8'
    )

    scripts.replaceAll({ scripts: [], groups: [] })
    mock.__state.canceled = false
    mock.__state.openPath = legacyFile
    const result = await call('config:import', { mode: 'legacy' })

    expect(result.stats.imported).toBe(1)
    expect(result.stats.warnings).toHaveLength(1)
    expect(result.stats.warnings[0]).toContain('第 1 条记录被跳过')
    expect(scripts.listScripts().map((s) => s.name)).toEqual(['ok'])
  })

  it('取消打开对话框时原数据不变', async () => {
    const before = scripts.listScripts()
    mock.__state.canceled = true
    mock.__state.openPath = null
    const result = await call('config:import', { mode: 'v2' })
    expect(result.canceled).toBe(true)
    expect(scripts.listScripts()).toEqual(before)
  })
})
