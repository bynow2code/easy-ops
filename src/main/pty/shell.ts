import { app } from 'electron'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import type { ShellInfo } from '../../shared/types'

export interface ShellProbe {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  readFile: (filePath: string) => Promise<string>
  which: (cmd: string) => Promise<string | null>
  fileExists: (filePath: string) => Promise<boolean>
  execVersion: (filePath: string, args: string[]) => Promise<string | null>
}

const POSIX_FALLBACKS = ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/zsh', '/usr/bin/bash']

const WIN_GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
]

export function parseEtcShells(content: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (seen.has(line)) continue
    seen.add(line)
    result.push(line)
  }
  return result
}

export function preferMacShells(paths: string[]): string[] {
  const rank = (p: string): number => {
    const base = path.basename(p)
    if (base === 'zsh') return 0
    if (base === 'bash') return 1
    return 2
  }
  return [...paths].sort((a, b) => rank(a) - rank(b))
}

export function buildShellInfo(
  shellPath: string,
  version: string | null,
  source: 'detected' | 'custom'
): ShellInfo {
  const base = path.basename(shellPath).replace(/\.exe$/i, '')
  return {
    id: source === 'custom' ? `custom:${shellPath}` : base,
    name: base,
    path: shellPath,
    args: ['-i'],
    version: version ?? undefined,
    source
  }
}

async function safeVersion(probe: ShellProbe, shellPath: string): Promise<string | null> {
  try {
    return await probe.execVersion(shellPath, ['--version'])
  } catch {
    return null
  }
}

export function dedupeShellIds(shells: ShellInfo[]): ShellInfo[] {
  const seen = new Map<string, number>()
  return shells.map((shell) => {
    const count = seen.get(shell.id) ?? 0
    seen.set(shell.id, count + 1)
    if (count === 0) return shell
    const hash = createHash('sha1').update(shell.path).digest('hex').slice(0, 6)
    return { ...shell, id: `${shell.id}-${hash}` }
  })
}

async function detectPosix(probe: ShellProbe): Promise<ShellInfo[]> {
  let candidates: string[] = []

  try {
    const content = await probe.readFile('/etc/shells')
    candidates = parseEtcShells(content)
  } catch {
    candidates = []
  }

  const fallback = probe.env['SHELL'] ? [probe.env['SHELL'] as string, ...POSIX_FALLBACKS] : POSIX_FALLBACKS
  for (const candidate of fallback) {
    if (!candidates.includes(candidate)) candidates.push(candidate)
  }

  if (probe.platform === 'darwin') candidates = preferMacShells(candidates)

  const results: ShellInfo[] = []
  for (const candidate of candidates) {
    if (!(await probe.fileExists(candidate))) continue
    const version = await safeVersion(probe, candidate)
    results.push(buildShellInfo(candidate, version, 'detected'))
  }

  // Linux 上把 bash 提到首位(稳定排序,非 bash 项保持原顺序)
  if (probe.platform === 'linux') {
    results.sort((a, b) => Number(b.name === 'bash') - Number(a.name === 'bash'))
  }

  // 同 basename 的多个路径(如 /bin/zsh 与 /usr/bin/zsh)会用 basename 撞 id,追加路径短 hash 去重
  return dedupeShellIds(results)
}

async function detectWindows(probe: ShellProbe): Promise<ShellInfo[]> {
  const results: ShellInfo[] = []

  const gitBashCandidates = [...WIN_GIT_BASH_CANDIDATES]
  const found = await probe.which('bash.exe')
  if (found) gitBashCandidates.unshift(found)

  for (const candidate of gitBashCandidates) {
    if (!(await probe.fileExists(candidate))) continue
    const version = await safeVersion(probe, candidate)
    if (!version) continue
    const info = buildShellInfo(candidate, version, 'detected')
    results.push({ ...info, id: `gitbash:${candidate}`, args: ['-i'] })
    break
  }

  const wslPath = await probe.which('wsl.exe')
  if (wslPath) {
    const list = await probe.execVersion(wslPath, ['-l', '-q'])
    const distros = (list ?? '')
      .split(/\r?\n/)
      .map((s) => s.replace(/\u0000/g, '').trim())
      .filter(Boolean)
    for (const distro of distros) {
      results.push({
        id: `wsl:${distro}`,
        name: `WSL · ${distro}`,
        path: wslPath,
        args: ['-d', distro, '--', 'bash', '-i'],
        version: 'WSL',
        source: 'detected'
      })
    }
    if (distros.length === 0) {
      results.push({
        id: 'wsl:default',
        name: 'WSL · 默认发行版',
        path: wslPath,
        args: ['--', 'bash', '-i'],
        version: 'WSL',
        source: 'detected'
      })
    }
  }

  return results
}

export async function detectShells(probe: ShellProbe): Promise<ShellInfo[]> {
  return probe.platform === 'win32' ? detectWindows(probe) : detectPosix(probe)
}

export interface ShellPathValidation {
  valid: boolean
  version?: string
  reason?: string
}

export async function isValidShellPath(
  shellPath: string,
  probe: ShellProbe
): Promise<ShellPathValidation> {
  if (!(await probe.fileExists(shellPath))) {
    // fileExists 实为 X_OK 校验,故不可执行的文件也会落在此分支,文案需覆盖两种原因
    return { valid: false, reason: '文件不存在或不可执行' }
  }
  const version = await safeVersion(probe, shellPath)
  if (!version) {
    return { valid: false, reason: '文件无法执行或未返回版本信息' }
  }
  return { valid: true, version }
}

export function createNodeShellProbe(): ShellProbe {
  return {
    platform: process.platform,
    env: process.env,
    readFile: (filePath) => fs.readFile(filePath, 'utf8'),
    which: (cmd) =>
      new Promise((resolve) => {
        execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], (err, stdout) => {
          if (err) return resolve(null)
          const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
          resolve(first ?? null)
        })
      }),
    fileExists: async (filePath) => {
      try {
        await fs.access(filePath, fs.constants.X_OK)
        return true
      } catch {
        return false
      }
    },
    execVersion: (filePath, args) =>
      new Promise((resolve) => {
        execFile(filePath, args, { timeout: 4000 }, (err, stdout) => {
          if (err) return resolve(null)
          const text = stdout.trim().split(/\r?\n/)[0] ?? ''
          resolve(text.length > 0 ? text : null)
        })
      })
  }
}

export function shellHomeDir(): string {
  try {
    return app.getPath('home') || os.homedir()
  } catch {
    return os.homedir()
  }
}
