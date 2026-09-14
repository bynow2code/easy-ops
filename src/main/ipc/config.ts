import * as fs from 'node:fs/promises'
import * as syncFs from 'node:fs'
import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  buildExportPayload,
  filterPortableSettings,
  parseImport,
  toLegacyMigration
} from '../store/transfer'
import { createNodeShellProbe, detectShells } from '../pty/shell'
import type { ScriptsStore } from '../store/scripts'
import type { SettingsStore } from '../store/settings'

export interface ConfigIpcDeps {
  getWindow: () => BrowserWindow | null
  scripts: ScriptsStore
  settings: SettingsStore
}

async function pickSavePath(win: BrowserWindow | null): Promise<string | null> {
  const options = {
    defaultPath: `easyops-config-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

async function pickOpenPath(win: BrowserWindow | null): Promise<string | null> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export function registerConfigIpc(deps: ConfigIpcDeps): void {
  ipcMain.handle('config:export', async () => {
    const filePath = await pickSavePath(deps.getWindow())
    if (!filePath) return { canceled: true }

    const payload = buildExportPayload(
      deps.scripts.listScripts(),
      deps.scripts.listGroups(),
      deps.settings.get()
    )
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { canceled: false, path: filePath }
  })

  ipcMain.handle('config:import', async (_event, payload: { mode: 'v2' | 'legacy' }) => {
    const filePath = await pickOpenPath(deps.getWindow())
    if (!filePath) return { canceled: true }

    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = parseImport(raw)

    // 先解析校验再落盘:解析失败抛错,原数据保持不变
    if (!parsed.ok) {
      throw new Error(parsed.reason)
    }

    const probe = createNodeShellProbe()
    const knownShells = await detectShells(probe)
    const detectedIds = knownShells.map((s) => s.id)
    const currentCustomIds = deps.settings.get().customShells.map((s) => s.id)

    const exists = (target: string): boolean => {
      try {
        // 同步检查即可:仅用于导入时的路径有效性判定
        syncFs.accessSync(target, syncFs.constants.X_OK)
        return true
      } catch {
        return false
      }
    }

    if (parsed.mode === 'legacy') {
      const knownIds = [...detectedIds, ...currentCustomIds]
      const migrated = toLegacyMigration(parsed.legacyScripts)
      const normalized = migrated.scripts.map((s) =>
        s.shellId && !knownIds.includes(s.shellId) ? { ...s, shellId: null } : s
      )
      await deps.scripts.replaceAll({ scripts: normalized, groups: migrated.groups })
      return {
        canceled: false,
        stats: {
          imported: normalized.length,
          groups: migrated.groups.length,
          warnings: migrated.warnings
        }
      }
    }

    // 文件自带的自定义 shell:路径在本机可用即视为已知。否则换机导入时
    // 「刚导入进来的 shell」会被判成不存在 —— 既清空脚本覆盖,又对默认 shell 误报警告。
    const incoming = parsed.payload.settings
    const incomingCustomIds = Array.isArray(incoming?.customShells)
      ? incoming.customShells
          .filter((shell) => shell && typeof shell.path === 'string' && exists(shell.path))
          .map((shell) => shell.id)
      : []

    const { settings, warnings } = filterPortableSettings(incoming, {
      exists,
      knownShellIds: [...detectedIds, ...incomingCustomIds, ...currentCustomIds]
    })

    // 与 legacy 路径对称:换机导入时旧 shellId 可能在本机不存在,留着会让脚本一运行就报错。
    // 这里用「过滤后真正落盘」的自定义 shell,避免保留指向已失效路径的覆盖。
    const finalIds = [...detectedIds, ...settings.customShells.map((s) => s.id)]
    const scripts = parsed.payload.scripts.map((s) =>
      s.shellId && !finalIds.includes(s.shellId) ? { ...s, shellId: null } : s
    )

    await deps.scripts.replaceAll({ scripts, groups: parsed.payload.groups })
    deps.settings.update(settings)

    return {
      canceled: false,
      stats: {
        imported: parsed.payload.scripts.length,
        groups: parsed.payload.groups.length,
        warnings
      }
    }
  })
}
