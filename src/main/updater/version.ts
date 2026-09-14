export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = normalizeVersion(a).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const right = normalizeVersion(b).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (l > r) return 1
    if (l < r) return -1
  }
  return 0
}

export function isNewer(current: string, remote: string): boolean {
  return compareVersions(current, remote) < 0
}

/** 把 `app.getAppPath()` 剥到 .app 层级;剥不掉时原样返回,便于上层走手动下载回退 */
export function deriveAppPath(appPath: string): string {
  return appPath.replace(/\/Contents\/Resources\/app\.asar$/, '')
}

/**
 * 单引号包裹:双引号内 `$()`、反引号、`\` 仍会被 shell 展开,而路径里可能带有归档条目名等
 * 外部可控片段(见 mac 更新器对 .app 条目名的读取),必须彻底关掉展开。
 */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * 后台替换脚本:等待主进程退出(上限 60 秒)→ 拷到 .new → 移除旧包 → 改名 → 去隔离 → 重启。
 * 拷贝成功前绝不删除旧包,避免 ditto 失败时把应用删成不可用。
 */
export function buildReplaceScript(input: { appPath: string; extractedAppPath: string; workDir: string }): string {
  const { appPath, extractedAppPath, workDir } = input
  const staged = `${appPath}.new`
  const q = shQuote

  return [
    '#!/bin/sh',
    'WAITED=0',
    `while pgrep -f ${q(appPath)} > /dev/null 2>&1; do`,
    '  WAITED=$((WAITED + 1))',
    '  if [ "$WAITED" -ge 60 ]; then exit 1; fi',
    '  sleep 1',
    'done',
    `ditto ${q(extractedAppPath)} ${q(staged)} || exit 1`,
    `rm -rf ${q(appPath)}`,
    `mv ${q(staged)} ${q(appPath)} || exit 1`,
    `xattr -dr com.apple.quarantine ${q(appPath)} 2>/dev/null || true`,
    `open ${q(appPath)}`,
    `rm -rf ${q(workDir)}`
  ].join('\n')
}

export type MacUpdateAction = 'auto-replace' | 'manual-download'

export function decideMacUpdateAction(input: {
  appPath: string
  canWriteTarget: boolean
}): MacUpdateAction {
  const inApplications = input.appPath.startsWith('/Applications/') || input.appPath === '/Applications'
  if (!inApplications) return 'manual-download'
  if (!input.canWriteTarget) return 'manual-download'
  return 'auto-replace'
}
