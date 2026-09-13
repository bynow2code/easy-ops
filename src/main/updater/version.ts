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
