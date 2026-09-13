import { app, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { compareVersions, decideMacUpdateAction } from './version'
import type { UpdateEvent } from './win-linux'

const REPO = 'bynow2code/easy-ops'

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface Release {
  tag: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

async function fetchLatestRelease(): Promise<Release> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EasyOps' }
  })
  if (!response.ok) throw new Error(`获取最新版本失败:HTTP ${response.status}`)
  const json = (await response.json()) as {
    tag_name?: string
    html_url?: string
    assets?: ReleaseAsset[]
  }
  return {
    tag: json.tag_name ?? '',
    htmlUrl: json.html_url ?? `https://github.com/${REPO}/releases/latest`,
    assets: json.assets ?? []
  }
}

async function canWrite(targetDir: string): Promise<boolean> {
  try {
    await fs.access(targetDir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function runDitto(source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ditto', ['-x', '-k', source, target], (err) => (err ? reject(err) : resolve()))
  })
}

export interface MacUpdaterHandle {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => void
}

export function createMacUpdater(emit: (event: UpdateEvent) => void): MacUpdaterHandle {
  let pendingRelease: Release | null = null
  let extractedAppPath: string | null = null

  const openReleasePage = async (url: string): Promise<void> => {
    await shell.openExternal(url)
  }

  return {
    async check() {
      if (!app.isPackaged) {
        emit({ status: 'error', message: '开发模式不支持检查更新' })
        return
      }
      emit({ status: 'checking' })
      try {
        const release = await fetchLatestRelease()
        if (!release.tag) {
          emit({ status: 'error', message: '未获取到版本标签' })
          return
        }
        const current = app.getVersion()
        if (compareVersions(current, release.tag) >= 0) {
          emit({ status: 'not-available' })
          return
        }
        pendingRelease = release
        emit({ status: 'available', version: release.tag.replace(/^v/i, '') })
      } catch (err) {
        emit({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    },

    async download() {
      if (!pendingRelease) {
        emit({ status: 'error', message: '请先检查更新' })
        return
      }

      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const asset =
        pendingRelease.assets.find((a) => a.name.endsWith(`${arch}.zip`)) ??
        pendingRelease.assets.find((a) => a.name.endsWith('.zip'))

      if (!asset) {
        emit({ status: 'error', message: '未找到适用于当前架构的更新包' })
        await openReleasePage(pendingRelease.htmlUrl)
        return
      }

      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easyops-update-'))
      const zipPath = path.join(workDir, asset.name)

      try {
        const response = await fetch(asset.browser_download_url, { redirect: 'follow' })
        if (!response.ok || !response.body) throw new Error(`下载失败:HTTP ${response.status}`)
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(zipPath))

        emit({ status: 'downloading', percent: 100 })

        const extractDir = path.join(workDir, 'extract')
        await fs.mkdir(extractDir, { recursive: true })
        await runDitto(zipPath, extractDir)

        const entries = await fs.readdir(extractDir)
        const appBundle = entries.find((name) => name.endsWith('.app'))
        if (!appBundle) throw new Error('更新包中未找到 .app')
        extractedAppPath = path.join(extractDir, appBundle)

        emit({ status: 'downloaded', version: pendingRelease.tag.replace(/^v/i, '') })
      } catch (err) {
        emit({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        await openReleasePage(pendingRelease.htmlUrl)
      }
    },

    install() {
      void (async () => {
        if (!pendingRelease) return
        if (!extractedAppPath) {
          await openReleasePage(pendingRelease.htmlUrl)
          return
        }

        const appPath = app.getAppPath().replace(/\/Contents\/Resources\/app\.asar$/, '')
        const targetDir = path.dirname(appPath)
        const writable = await canWrite(targetDir)

        const action = decideMacUpdateAction({ appPath, canWriteTarget: writable })
        if (action === 'manual-download') {
          emit({
            status: 'error',
            message: '当前安装位置或权限不支持自动更新,已打开下载页面,请手动替换应用'
          })
          await openReleasePage(pendingRelease.htmlUrl)
          return
        }

        // 构造后台替换脚本:等待主进程退出 → 替换 → 去隔离 → 重启
        const script = [
          '#!/bin/sh',
          `while pgrep -f "${appPath}" > /dev/null 2>&1; do sleep 1; done`,
          `rm -rf "${appPath}"`,
          `ditto "${extractedAppPath}" "${appPath}"`,
          `xattr -dr com.apple.quarantine "${appPath}" 2>/dev/null || true`,
          `open "${appPath}"`
        ].join('\n')

        const scriptPath = path.join(os.tmpdir(), `easyops-replace-${Date.now()}.sh`)
        await fs.writeFile(scriptPath, script, { mode: 0o755 })

        const child = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' })
        child.unref()

        app.quit()
      })()
    }
  }
}
