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

    if (parsed.mode === 'legacy') {
      const migrated = toLegacyMigration(parsed.legacyScripts)
      const probe = createNodeShellProbe()
      const knownShells = await detectShells(probe)
      const knownIds = knownShells.map((s) => s.id)
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

    const probe = createNodeShellProbe()
    const knownShells = await detectShells(probe)
    const { settings, warnings } = filterPortableSettings(parsed.payload.settings, {
      exists: (p) => {
        try {
          // 同步检查即可:仅用于导入时的路径有效性判定
          syncFs.accessSync(p, syncFs.constants.X_OK)
          return true
        } catch {
          return false
        }
      },
      knownShellIds: knownShells.map((s) => s.id)
    })

    await deps.scripts.replaceAll({ scripts: parsed.payload.scripts, groups: parsed.payload.groups })
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
