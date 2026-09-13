# EasyOps 重构 · 计划 2/3:Shell 检测与交互式终端

> **面向 AI 代理的工作者:** 必需子技能:使用 subagent-driven-development(推荐)或 executing-plans 逐任务实现此计划。步骤使用复选框(`- [ ]`)语法来跟踪进度。

**目标:** 实现 Shell 自动检测与切换,以及基于 node-pty + xterm.js 的交互式终端:可执行脚本、可实时交互、可最大化、可单个/批量关闭。

**架构:** 主进程用 `PtyManager` 持有唯一的会话表 `Map<runId, PtySession>`,node-pty 会话在此创建;脚本内容写入临时文件后经 `source` 在当前 shell 上下文执行;输出经 `pty:data` 事件流到渲染进程的 xterm 实例,键盘输入经 `pty:write` 回灌。`PtyManager` 通过注入 `PtyLike` 工厂函数隔离 node-pty,使其会话表逻辑可在 vitest 中完整测试。

**技术栈:** node-pty 1.1.0 / @xterm/xterm 5.5.0 / @xterm/addon-fit 0.10.0 / @xterm/addon-web-links 0.11.0

**规格:** `docs/superpowers/specs/2026-09-13-easyops-refactor-design.md`

**前置:** 计划 1 必须已完成(骨架、数据层、IPC 基础、主题系统均可用)。

## 全局约束

- `node-pty` 固定 `1.1.0`,列在 `dependencies`;`electron-builder.yml` 中 `asarUnpack: ['**/node_modules/node-pty/**']`。
- `@xterm/xterm` 固定 `5.5.0`;`@xterm/addon-fit` 固定 `0.10.0`;`@xterm/addon-web-links` 固定 `0.11.0`。
- **终端只保留一个用户概念「关闭」**:关闭 = `\x03` → `pty.kill()` → 从会话表移除 → 移除面板。**不设**独立的「停止」按钮,中断脚本由用户按 Ctrl+C 完成。
- **不做**会话状态机、不做脚本执行状态机、不做结束哨兵(OSC 序列)、不做 `pty:list` 快照恢复、不做输出回滚缓冲、不做三层降级终止链。
- **保留的正确性底线**:① 主进程持有唯一会话表;② 窗口关闭 / 应用退出必须 `disposeAll()`;③ 临时脚本文件必须清理。
- 脚本执行时 **cwd 取用户主目录**;shell 以**交互模式**启动(`-i`)。
- 同一脚本多次执行时,终端标题追加序号 `(2)`、`(3)`。
- 涉及 PTY 的代码只把**纯逻辑**(标题序号、命令拼装、会话表操作)交给 vitest;真实 pty 行为靠手动验证。

---

## 文件结构

| 路径 | 职责 |
|---|---|
| `src/main/pty/shell.ts` | Shell 检测、解析与自定义路径校验(解析为纯函数,IO 可注入) |
| `src/main/pty/types.ts` | `PtyLike` / `PtySpawnFn` 抽象,隔离 node-pty |
| `src/main/pty/title.ts` | 终端标题序号计算(纯函数) |
| `src/main/pty/runner.ts` | 临时脚本文件写入、`source` 命令拼装与清理(纯逻辑 + fs) |
| `src/main/pty/manager.ts` | 会话表、启动/写入/缩放/关闭/全部清理 |
| `src/main/pty/nodePtyAdapter.ts` | 把 node-pty 适配为 `PtyLike` |
| `src/main/ipc/pty.ts` | 终端域 IPC 注册 |
| `src/main/ipc/shell.ts` | Shell 域 IPC 注册 |
| `src/preload/index.ts` | 追加 `pty` 与 `shell` API 及事件订阅 |
| `src/renderer/src/store/useTerminalStore.ts` | 终端会话的渲染侧状态(纯逻辑,可测) |
| `src/renderer/src/components/TerminalView.tsx` | 单个 xterm 实例容器 |
| `src/renderer/src/components/TerminalDock.tsx` | 终端面板区(标签、最大化、关闭、批量关闭) |
| `src/renderer/src/hooks/usePtyEvents.ts` | 订阅 `pty:data` / `pty:exit` 并按 runId 分发 |
| `tests/main/shell.test.ts` | Shell 解析与校验单测 |
| `tests/main/pty-title.test.ts` | 标题序号单测 |
| `tests/main/runner.test.ts` | `source` 命令拼装单测 |
| `tests/main/ptymanager.test.ts` | 会话表逻辑单测(注入 fake pty) |
| `tests/renderer/terminalStore.test.ts` | 终端列表状态单测 |

---

## 任务 8:Shell 检测与自定义路径校验

**文件:**
- 创建:`src/main/pty/shell.ts`
- 创建:`src/main/ipc/shell.ts`
- 修改:`src/main/ipc/index.ts`(注册 shell 域并注入 `PtyManager` 之前先注入 shell 检测)
- 修改:`src/preload/index.ts`(追加 `shell` API)
- 测试:`tests/main/shell.test.ts`

- [ ] **步骤 1:写失败的测试**

`tests/main/shell.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildShellInfo,
  detectShells,
  isValidShellPath,
  parseEtcShells,
  preferMacShells,
  type ShellProbe
} from '../../src/main/pty/shell'

function makeProbe(overrides: Partial<ShellProbe> = {}): ShellProbe {
  return {
    platform: 'darwin',
    env: { SHELL: '/bin/zsh' },
    readFile: async () => '',
    which: async () => null,
    fileExists: async () => false,
    execVersion: async () => null,
    ...overrides
  }
}

describe('parseEtcShells', () => {
  it('忽略注释与空行', () => {
    const content = ['# comment', '', '/bin/sh', '  /bin/bash  ', '#/bin/nologin'].join('\n')
    expect(parseEtcShells(content)).toEqual(['/bin/sh', '/bin/bash'])
  })

  it('去重并保持顺序', () => {
    expect(parseEtcShells('/bin/bash\n/bin/bash\n/bin/zsh')).toEqual(['/bin/bash', '/bin/zsh'])
  })
})

describe('preferMacShells', () => {
  it('zsh 排在最前', () => {
    expect(preferMacShells(['/bin/bash', '/bin/zsh', '/bin/sh'])).toEqual([
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh'
    ])
  })

  it('没有 zsh 时保持原顺序并把 bash 提前', () => {
    expect(preferMacShells(['/bin/sh', '/bin/bash'])).toEqual(['/bin/bash', '/bin/sh'])
  })
})

describe('buildShellInfo', () => {
  it('生成 args 为 -i 的交互式启动参数', () => {
    const info = buildShellInfo('/bin/zsh', 'zsh 5.9', 'detected')
    expect(info.args).toEqual(['-i'])
    expect(info.id).toBe('zsh')
    expect(info.name).toBe('zsh')
    expect(info.version).toBe('zsh 5.9')
    expect(info.source).toBe('detected')
  })

  it('自定义 shell 的 id 带 custom: 前缀', () => {
    const info = buildShellInfo('/opt/bin/mysh', null, 'custom')
    expect(info.id).toBe('custom:/opt/bin/mysh')
    expect(info.name).toBe('mysh')
  })
})

describe('detectShells — macOS', () => {
  it('从 /etc/shells 解析并优先返回 zsh', async () => {
    const probe = makeProbe({
      readFile: async () => '/bin/sh\n/bin/bash\n/bin/zsh\n',
      fileExists: async () => true,
      execVersion: async (p) => `${p} 1.0`
    })
    const shells = await detectShells(probe)
    expect(shells[0].path).toBe('/bin/zsh')
    expect(shells.map((s) => s.path)).toContain('/bin/bash')
  })

  it('/etc/shells 不存在时回退到 $SHELL 与常见路径', async () => {
    const probe = makeProbe({
      readFile: async () => {
        throw new Error('ENOENT')
      },
      fileExists: async (p) => p === '/bin/zsh' || p === '/bin/bash',
      execVersion: async () => 'x 1.0'
    })
    const shells = await detectShells(probe)
    expect(shells.length).toBeGreaterThan(0)
    expect(shells[0].path).toBe('/bin/zsh')
  })
})

describe('detectShells — linux', () => {
  it('默认把 bash 放在首位', async () => {
    const probe = makeProbe({
      platform: 'linux',
      env: { SHELL: '/bin/bash' },
      readFile: async () => '/bin/sh\n/bin/bash\n',
      fileExists: async () => true,
      execVersion: async () => 'GNU bash 5.2'
    })
    const shells = await detectShells(probe)
    expect(shells[0].path).toBe('/bin/bash')
  })
})

describe('detectShells — windows', () => {
  it('探测到 WSL 时生成 wsl 项', async () => {
    const probe = makeProbe({
      platform: 'win32',
      env: {},
      readFile: async () => {
        throw new Error('ENOENT')
      },
      which: async (cmd) => (cmd === 'wsl.exe' ? 'C:\\Windows\\System32\\wsl.exe' : null),
      fileExists: async () => false,
      execVersion: async (_p, args) => (args.includes('-l') ? 'Ubuntu\n' : null)
    })
    const shells = await detectShells(probe)
    expect(shells.some((s) => s.id.startsWith('wsl:'))).toBe(true)
  })

  it('探测到 Git Bash 时生成 gitbash 项', async () => {
    const probe = makeProbe({
      platform: 'win32',
      env: {},
      readFile: async () => {
        throw new Error('ENOENT')
      },
      which: async () => null,
      fileExists: async (p) => p.toLowerCase().includes('git') && p.endsWith('bash.exe'),
      execVersion: async () => 'GNU bash 5.2'
    })
    const shells = await detectShells(probe)
    expect(shells.some((s) => s.id.startsWith('gitbash:'))).toBe(true)
  })
})

describe('isValidShellPath', () => {
  it('路径不存在时无效', async () => {
    const probe = makeProbe({ fileExists: async () => false })
    const result = await isValidShellPath('/nope/sh', probe)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/不存在/)
  })

  it('--version 探测失败时无效', async () => {
    const probe = makeProbe({ fileExists: async () => true, execVersion: async () => null })
    const result = await isValidShellPath('/bin/broken', probe)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/无法执行/)
  })

  it('可执行且能返回版本时有效', async () => {
    const probe = makeProbe({ fileExists: async () => true, execVersion: async () => 'zsh 5.9' })
    const result = await isValidShellPath('/bin/zsh', probe)
    expect(result.valid).toBe(true)
    expect(result.version).toBe('zsh 5.9')
  })
})
```

- [ ] **步骤 2:运行测试验证失败**

运行:`npx vitest run tests/main/shell.test.ts`
预期:FAIL,报错无法解析 `../../src/main/pty/shell`。

- [ ] **步骤 3:实现 Shell 检测模块**

`src/main/pty/shell.ts`:

```ts
import { app } from 'electron'
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

  // Linux 上把 bash 提到首位
  if (probe.platform === 'linux') {
    results.sort((a, b) => (a.name === 'bash' ? -1 : b.name === 'bash' ? 1 : 0))
  }

  return results
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
    return { valid: false, reason: '文件不存在' }
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
```

- [ ] **步骤 4:运行测试验证通过**

运行:`npx vitest run tests/main/shell.test.ts`
预期:全部 PASS。

- [ ] **步骤 5:写 Shell 域 IPC**

`src/main/ipc/shell.ts`:

```ts
import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { createNodeShellProbe, detectShells, isValidShellPath } from '../pty/shell'
import type { SettingsStore } from '../store/settings'

export function registerShellIpc(getWindow: () => BrowserWindow | null, settings: SettingsStore): void {
  ipcMain.handle('shell:detect', async () => {
    const probe = createNodeShellProbe()
    const detected = await detectShells(probe)
    const custom = settings.get().customShells.map((s) => ({
      id: s.id,
      name: s.name,
      path: s.path,
      args: ['-i'],
      source: 'custom' as const
    }))
    return [...detected, ...custom]
  })

  ipcMain.handle('shell:validate', async (_event, payload: { path: string }) => {
    const probe = createNodeShellProbe()
    return isValidShellPath(payload.path, probe)
  })

  ipcMain.handle('shell:browse', async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile', 'showHiddenFiles'] })
      : await dialog.showOpenDialog({ properties: ['openFile', 'showHiddenFiles'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
```

- [ ] **步骤 6:在 IPC 注册中心接入**

在 `src/main/ipc/index.ts` 顶部导入:

```ts
import { registerShellIpc } from './shell'
```

在 `registerIpc` 内、`registerGroupIpc` 之后追加:

```ts
  registerShellIpc(ctx.getWindow, ctx.settings)
```

- [ ] **步骤 7:在 preload 暴露 shell API**

在 `src/preload/index.ts` 的 `api` 对象中追加(放在 `settings` 之前):

```ts
  shell: {
    detect: (): Promise<ShellInfo[]> => ipcRenderer.invoke('shell:detect'),
    validate: (path: string): Promise<{ valid: boolean; version?: string; reason?: string }> =>
      ipcRenderer.invoke('shell:validate', { path }),
    browse: (): Promise<string | null> => ipcRenderer.invoke('shell:browse')
  },
```

并在文件顶部类型导入中加入 `ShellInfo`:

```ts
import type { Group, Script, Settings, ShellInfo } from '../shared/types'
```

- [ ] **步骤 8:类型检查并手动验证检测结果**

```bash
npm run typecheck && npm run dev
```

在 DevTools Console 执行:

```js
await window.api.shell.detect()
```

预期(macOS):返回数组,第一项 `path` 为 `/bin/zsh`,`args` 为 `['-i']`,且含 `/bin/bash`。若本机无 zsh,则第一项为 `/bin/bash`。

再执行:

```js
await window.api.shell.validate('/bin/definitely-not-exist')
```

预期:`{ valid: false, reason: '文件不存在' }`。

- [ ] **步骤 9:Commit**

```bash
git add src/main/pty/shell.ts src/main/ipc/shell.ts src/main/ipc/index.ts src/preload/ tests/main/shell.test.ts
git commit -m "feat: 实现 shell 自动检测与自定义路径校验"
```

---

## 任务 9:PTY 会话管理

**文件:**
- 创建:`src/main/pty/types.ts`
- 创建:`src/main/pty/title.ts`
- 创建:`src/main/pty/runner.ts`
- 创建:`src/main/pty/manager.ts`
- 创建:`src/main/pty/nodePtyAdapter.ts`
- 创建:`src/main/ipc/pty.ts`
- 修改:`src/main/index.ts`(装配 PtyManager、注册 IPC、退出清理)
- 修改:`src/main/window.ts`(窗口关闭时清理)
- 修改:`src/preload/index.ts`(pty API 与事件订阅)
- 测试:`tests/main/pty-title.test.ts`
- 测试:`tests/main/runner.test.ts`
- 测试:`tests/main/ptymanager.test.ts`

- [ ] **步骤 1:写失败的测试(标题序号)**

`tests/main/pty-title.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextTitle } from '../../src/main/pty/title'

describe('nextTitle', () => {
  it('无同名时使用原始名称', () => {
    expect(nextTitle('启动服务', [])).toBe('启动服务')
  })

  it('存在同名时追加 (2)', () => {
    expect(nextTitle('启动服务', ['启动服务'])).toBe('启动服务 (2)')
  })

  it('继续冲突时递增', () => {
    expect(nextTitle('启动服务', ['启动服务', '启动服务 (2)'])).toBe('启动服务 (3)')
  })

  it('忽略不相关标题', () => {
    expect(nextTitle('a', ['b', 'c (2)'])).toBe('a')
  })

  it('名称内含括号时仍正确递增', () => {
    expect(nextTitle('a (2)', ['a (2)'])).toBe('a (2) (2)')
  })
})
```

- [ ] **步骤 2:运行测试验证失败**

运行:`npx vitest run tests/main/pty-title.test.ts`
预期:FAIL,无法解析模块。

- [ ] **步骤 3:实现标题与 PTY 抽象**

`src/main/pty/title.ts`:

```ts
export function nextTitle(baseName: string, existingTitles: string[]): string {
  if (!existingTitles.includes(baseName)) return baseName
  let index = 2
  while (existingTitles.includes(`${baseName} (${index})`)) index += 1
  return `${baseName} (${index})`
}
```

`src/main/pty/types.ts`:

```ts
export interface PtyExitEvent {
  exitCode: number
  signal?: number
}

export interface PtyLike {
  readonly pid: number
  onData: (listener: (data: string) => void) => { dispose: () => void }
  onExit: (listener: (event: PtyExitEvent) => void) => { dispose: () => void }
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
}

export interface PtySpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export type PtySpawnFn = (file: string, args: string[], options: PtySpawnOptions) => PtyLike
```

- [ ] **步骤 4:写失败的测试(runner 命令拼装)**

`tests/main/runner.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSourceCommand, cleanupTempScript, writeTempScript } from '../../src/main/pty/runner'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'easyops-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('buildSourceCommand', () => {
  it('用单引号包裹路径以容忍空格', () => {
    expect(buildSourceCommand('/tmp/a b/c.sh')).toBe("source '/tmp/a b/c.sh'")
  })

  it('转义路径中的单引号', () => {
    expect(buildSourceCommand("/tmp/it's.sh")).toBe("source '/tmp/it'\\''s.sh'")
  })

  it('命令结尾带换行', () => {
    expect(buildSourceCommand('/tmp/a.sh').endsWith('\n')).toBe(true)
  })
})

describe('writeTempScript', () => {
  it('写入脚本内容并返回路径', async () => {
    const filePath = await writeTempScript(dir, 'run-1', 'echo hello\n')
    expect(path.dirname(filePath)).toBe(dir)
    expect(path.basename(filePath)).toBe('easyops-run-1.sh')
    expect(await readFile(filePath, 'utf8')).toBe('echo hello\n')
  })

  it('内容不以换行结尾时自动补换行', async () => {
    const filePath = await writeTempScript(dir, 'run-2', 'echo no-newline')
    expect(await readFile(filePath, 'utf8')).toBe('echo no-newline\n')
  })

  it('清理后文件不存在', async () => {
    const filePath = await writeTempScript(dir, 'run-3', 'echo x')
    await cleanupTempScript(filePath)
    await expect(readFile(filePath, 'utf8')).rejects.toThrow()
  })

  it('清理不存在的文件不抛错', async () => {
    await expect(cleanupTempScript(path.join(dir, 'nope.sh'))).resolves.toBeUndefined()
  })
})
```

- [ ] **步骤 5:运行测试验证失败**

运行:`npx vitest run tests/main/runner.test.ts`
预期:FAIL,无法解析模块。

- [ ] **步骤 6:实现 runner**

`src/main/pty/runner.ts`:

```ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export function buildSourceCommand(scriptPath: string): string {
  const escaped = scriptPath.replace(/'/g, `'\\''`)
  return `source '${escaped}'\n`
}

export function tempScriptName(runId: string): string {
  return `easyops-${runId}.sh`
}

export async function writeTempScript(dir: string, runId: string, content: string): Promise<string> {
  const filePath = path.join(dir, tempScriptName(runId))
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  await fs.writeFile(filePath, normalized, 'utf8')
  return filePath
}

export async function cleanupTempScript(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch {
    // 文件不存在或已被清理,视为成功
  }
}

export async function cleanupStaleTempScripts(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir)
    await Promise.all(
      entries
        .filter((name) => name.startsWith('easyops-') && name.endsWith('.sh'))
        .map((name) => cleanupTempScript(path.join(dir, name)))
    )
  } catch {
    // 目录不可读时忽略
  }
}
```

- [ ] **步骤 7:运行测试验证通过**

运行:`npx vitest run tests/main/runner.test.ts tests/main/pty-title.test.ts`
预期:全部 PASS。

- [ ] **步骤 8:写失败的测试(会话表)**

`tests/main/ptymanager.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPtyManager, type PtyManager } from '../../src/main/pty/manager'
import type { PtyLike, PtySpawnFn } from '../../src/main/pty/types'

interface FakePty extends PtyLike {
  written: string[]
  killed: boolean
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
}

function createFakeSpawn(): { spawn: PtySpawnFn; last: () => FakePty | null; count: () => number } {
  const created: FakePty[] = []
  const spawn: PtySpawnFn = () => {
    const dataListeners: ((d: string) => void)[] = []
    const exitListeners: ((e: { exitCode: number }) => void)[] = []
    const fake: FakePty = {
      pid: 1000 + created.length,
      written: [],
      killed: false,
      onData(listener) {
        dataListeners.push(listener)
        return { dispose: () => {} }
      },
      onExit(listener) {
        exitListeners.push(listener)
        return { dispose: () => {} }
      },
      write(data) {
        fake.written.push(data)
      },
      resize: vi.fn(),
      kill() {
        fake.killed = true
      },
      emitData(data) {
        dataListeners.forEach((l) => l(data))
      },
      emitExit(exitCode) {
        exitListeners.forEach((l) => l({ exitCode }))
      }
    }
    created.push(fake)
    return fake
  }
  return { spawn, last: () => created.at(-1) ?? null, count: () => created.length }
}

let manager: PtyManager
let fake: ReturnType<typeof createFakeSpawn>
let emitted: { channel: string; payload: unknown }[]

beforeEach(() => {
  fake = createFakeSpawn()
  emitted = []
  manager = createPtyManager({
    spawn: fake.spawn,
    tempDir: '/tmp/easyops-test',
    homeDir: '/Users/test',
    writeTempScript: async (_dir, runId) => `/tmp/easyops-test/easyops-${runId}.sh`,
    cleanupTempScript: async () => {},
    emit: (channel, payload) => emitted.push({ channel, payload }),
    env: { PATH: '/usr/bin' },
    platform: 'darwin'
  })
})

const SHELL = { path: '/bin/zsh', args: ['-i'], id: 'zsh', name: 'zsh', source: 'detected' as const }

describe('启动会话', () => {
  it('返回 runId 与标题,并注册进会话表', async () => {
    const result = await manager.start({ scriptId: 's1', scriptName: '启动服务', content: 'echo hi', shell: SHELL })
    expect(result.title).toBe('启动服务')
    expect(manager.list()).toHaveLength(1)
    expect(manager.list()[0].runId).toBe(result.runId)
  })

  it('同名脚本第二次启动时标题追加序号', async () => {
    await manager.start({ scriptId: 's1', scriptName: '启动服务', content: 'echo a', shell: SHELL })
    const second = await manager.start({ scriptId: 's2', scriptName: '启动服务', content: 'echo b', shell: SHELL })
    expect(second.title).toBe('启动服务 (2)')
  })

  it('以交互模式启动 shell 并写入 source 命令', async () => {
    const shellUsed: string[] = []
    const capturingSpawn: PtySpawnFn = (file, args, options) => {
      shellUsed.push(file, ...args)
      return fake.spawn(file, args, options)
    }
    const m = createPtyManager({
      spawn: capturingSpawn,
      tempDir: '/tmp/easyops-test',
      homeDir: '/Users/test',
      writeTempScript: async (_dir, runId) => `/tmp/easyops-test/easyops-${runId}.sh`,
      cleanupTempScript: async () => {},
      emit: () => {},
      env: {},
      platform: 'darwin'
    })
    const { runId } = await m.start({ scriptId: 's1', scriptName: 'a', content: 'echo hi', shell: SHELL })
    expect(shellUsed).toContain('/bin/zsh')
    expect(shellUsed).toContain('-i')
    expect(fake.last()!.written[0]).toBe(`source '/tmp/easyops-test/easyops-${runId}.sh'\n`)
  })

  it('cwd 使用传入的 homeDir', async () => {
    let usedCwd = ''
    const capturingSpawn: PtySpawnFn = (_file, _args, options) => {
      usedCwd = options.cwd
      return fake.spawn(_file, _args, options)
    }
    const m = createPtyManager({
      spawn: capturingSpawn,
      tempDir: '/tmp/easyops-test',
      homeDir: '/Users/test',
      writeTempScript: async (_dir, runId) => `/tmp/easyops-test/easyops-${runId}.sh`,
      cleanupTempScript: async () => {},
      emit: () => {},
      env: {},
      platform: 'darwin'
    })
    await m.start({ scriptId: 's1', scriptName: 'a', content: 'echo hi', shell: SHELL })
    expect(usedCwd).toBe('/Users/test')
  })
})

describe('数据流转发', () => {
  it('pty 输出转发为 pty:data 事件', async () => {
    const { runId } = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    fake.last()!.emitData('hello\r\n')
    expect(emitted).toEqual([{ channel: 'pty:data', payload: { runId, chunk: 'hello\r\n' } }])
  })

  it('写入数据转发到 pty', async () => {
    const { runId } = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    manager.write(runId, 'ls\n')
    expect(fake.last()!.written).toContain('ls\n')
  })

  it('对不存在的 runId 写入时抛错', async () => {
    expect(() => manager.write('nope', 'x')).toThrowError(/不存在/)
  })
})

describe('退出与关闭', () => {
  it('pty 退出时发 pty:exit 并从会话表移除', async () => {
    const { runId } = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    fake.last()!.emitExit(0)
    expect(emitted.some((e) => e.channel === 'pty:exit')).toBe(true)
    expect(manager.list()).toHaveLength(0)
  })

  it('关闭会话时先写 Ctrl+C 再 kill', async () => {
    const { runId } = await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    await manager.close(runId)
    const pty = fake.last()!
    expect(pty.written).toContain('\x03')
    expect(pty.killed).toBe(true)
    expect(manager.list()).toHaveLength(0)
  })

  it('关闭不存在的会话不抛错', async () => {
    await expect(manager.close('nope')).resolves.toBeUndefined()
  })

  it('closeAll 关闭全部会话', async () => {
    await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    await manager.start({ scriptId: 's2', scriptName: 'b', content: 'echo', shell: SHELL })
    expect(manager.list()).toHaveLength(2)
    await manager.closeAll()
    expect(manager.list()).toHaveLength(0)
  })

  it('disposeAll 关闭全部会话(应用退出路径)', async () => {
    await manager.start({ scriptId: 's1', scriptName: 'a', content: 'echo', shell: SHELL })
    await manager.disposeAll()
    expect(manager.list()).toHaveLength(0)
    expect(fake.last()!.killed).toBe(true)
  })
})
```

- [ ] **步骤 9:运行测试验证失败**

运行:`npx vitest run tests/main/ptymanager.test.ts`
预期:FAIL,无法解析 `../../src/main/pty/manager`。

- [ ] **步骤 10:实现 PtyManager**

`src/main/pty/manager.ts`:

```ts
import type { ShellInfo } from '../../shared/types'
import { buildSourceCommand } from './runner'
import { nextTitle } from './title'
import type { PtyLike, PtySpawnFn } from './types'

export interface StartInput {
  scriptId: string
  scriptName: string
  content: string
  shell: Pick<ShellInfo, 'path' | 'args'>
}

export interface StartResult {
  runId: string
  title: string
}

export interface PtyManagerDeps {
  spawn: PtySpawnFn
  tempDir: string
  homeDir: string
  writeTempScript: (dir: string, runId: string, content: string) => Promise<string>
  cleanupTempScript: (filePath: string) => Promise<void>
  emit: (channel: 'pty:data' | 'pty:exit', payload: unknown) => void
  env: Record<string, string>
  platform: NodeJS.Platform
}

export interface SessionSummary {
  runId: string
  scriptId: string
  title: string
}

interface Session {
  runId: string
  scriptId: string
  title: string
  pty: PtyLike
  tempFile: string
  disposers: { dispose: () => void }[]
}

export interface PtyManager {
  start: (input: StartInput) => Promise<StartResult>
  write: (runId: string, data: string) => void
  resize: (runId: string, cols: number, rows: number) => void
  close: (runId: string) => Promise<void>
  closeAll: () => Promise<void>
  disposeAll: () => Promise<void>
  list: () => SessionSummary[]
}

let counter = 0

function makeRunId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter}`
}

export function createPtyManager(deps: PtyManagerDeps): PtyManager {
  const sessions = new Map<string, Session>()

  const titles = (): string[] => Array.from(sessions.values()).map((s) => s.title)

  const destroy = async (session: Session): Promise<void> => {
    session.disposers.forEach((d) => d.dispose())
    try {
      session.pty.write('\x03')
    } catch {
      // pty 可能已退出
    }
    try {
      session.pty.kill()
    } catch {
      // pty 可能已退出
    }
    sessions.delete(session.runId)
    await deps.cleanupTempScript(session.tempFile)
  }

  return {
    async start(input) {
      const runId = makeRunId()
      const title = nextTitle(input.scriptName, titles())
      const tempFile = await deps.writeTempScript(deps.tempDir, runId, input.content)

      const env: Record<string, string> = {
        ...deps.env,
        TERM: 'xterm-256color',
        EASYOPS_RUN_ID: runId
      }

      const pty = deps.spawn(input.shell.path, input.shell.args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: deps.homeDir,
        env
      })

      const session: Session = { runId, scriptId: input.scriptId, title, pty, tempFile, disposers: [] }
      sessions.set(runId, session)

      session.disposers.push(
        pty.onData((chunk) => deps.emit('pty:data', { runId, chunk })),
        pty.onExit(({ exitCode, signal }) => {
          session.disposers.forEach((d) => d.dispose())
          session.disposers = []
          const stillPresent = sessions.delete(runId)
          if (stillPresent) {
            deps.emit('pty:exit', { runId, exitCode, signal: signal ?? null })
          }
          void deps.cleanupTempScript(tempFile)
        })
      )

      pty.write(buildSourceCommand(tempFile))

      return { runId, title }
    },

    write(runId, data) {
      const session = sessions.get(runId)
      if (!session) throw new Error(`终端会话不存在: ${runId}`)
      session.pty.write(data)
    },

    resize(runId, cols, rows) {
      const session = sessions.get(runId)
      if (!session) return
      try {
        session.pty.resize(cols, rows)
      } catch {
        // 会话可能正在退出,忽略
      }
    },

    async close(runId) {
      const session = sessions.get(runId)
      if (!session) return
      await destroy(session)
    },

    async closeAll() {
      await Promise.all(Array.from(sessions.values()).map((s) => destroy(s)))
    },

    async disposeAll() {
      await Promise.all(Array.from(sessions.values()).map((s) => destroy(s)))
    },

    list() {
      return Array.from(sessions.values()).map((s) => ({
        runId: s.runId,
        scriptId: s.scriptId,
        title: s.title
      }))
    }
  }
}
```

- [ ] **步骤 11:运行测试验证通过**

运行:`npx vitest run tests/main/ptymanager.test.ts`
预期:全部 PASS。

- [ ] **步骤 12:实现 node-pty 适配器**

`src/main/pty/nodePtyAdapter.ts`:

```ts
import * as pty from 'node-pty'
import type { PtyLike, PtySpawnFn, PtySpawnOptions } from './types'

export const spawnNodePty: PtySpawnFn = (
  file: string,
  args: string[],
  options: PtySpawnOptions
): PtyLike => {
  const child = pty.spawn(file, args, {
    name: options.name,
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env
  })

  return {
    get pid() {
      return child.pid
    },
    onData: (listener) => child.onData(listener),
    onExit: (listener) => child.onExit(({ exitCode, signal }) => listener({ exitCode, signal })),
    write: (data) => child.write(data),
    resize: (cols, rows) => child.resize(cols, rows),
    kill: (signal) => child.kill(signal)
  }
}
```

- [ ] **步骤 13:实现终端域 IPC**

`src/main/ipc/pty.ts`:

```ts
import { ipcMain } from 'electron'
import type { PtyManager } from '../pty/manager'
import type { ShellInfo } from '../../shared/types'
import type { SettingsStore } from '../store/settings'

export function registerPtyIpc(manager: PtyManager, settings: SettingsStore, detect: () => Promise<ShellInfo[]>): void {
  const resolveShell = async (scriptShellId: string | null): Promise<ShellInfo> => {
    const shells = await detect()
    const wanted = scriptShellId ?? settings.get().shellId
    const found = wanted ? shells.find((s) => s.id === wanted) : undefined
    if (found) return found
    const fallback = shells[0]
    if (!fallback) throw new Error('未检测到可用的 shell,请在设置中配置')
    return fallback
  }

  ipcMain.handle(
    'pty:start',
    async (_event, payload: { scriptId: string; scriptName: string; content: string; shellId: string | null }) => {
      const shell = await resolveShell(payload.shellId)
      return manager.start({
        scriptId: payload.scriptId,
        scriptName: payload.scriptName,
        content: payload.content,
        shell: { path: shell.path, args: shell.args }
      })
    }
  )

  ipcMain.handle('pty:write', (_event, payload: { runId: string; data: string }) => {
    manager.write(payload.runId, payload.data)
  })

  ipcMain.handle('pty:resize', (_event, payload: { runId: string; cols: number; rows: number }) => {
    manager.resize(payload.runId, payload.cols, payload.rows)
  })

  ipcMain.handle('pty:close', async (_event, payload: { runId: string }) => {
    await manager.close(payload.runId)
  })

  ipcMain.handle('pty:closeAll', async () => {
    await manager.closeAll()
  })
}
```

- [ ] **步骤 14:在主进程装配 PtyManager 与退出清理**

在 `src/main/index.ts` 顶部补充导入:

```ts
import * as os from 'node:os'
import { createNodeShellProbe, detectShells } from './pty/shell'
import { createPtyManager } from './pty/manager'
import { spawnNodePty } from './pty/nodePtyAdapter'
import { cleanupStaleTempScripts, cleanupTempScript, writeTempScript } from './pty/runner'
import { registerPtyIpc } from './ipc/pty'
```

在 `whenReady` 回调内、`registerIpc(...)` 之后追加:

```ts
    const tempDir = os.tmpdir()
    await cleanupStaleTempScripts(tempDir)

    const ptyManager = createPtyManager({
      spawn: spawnNodePty,
      tempDir,
      homeDir: app.getPath('home'),
      writeTempScript,
      cleanupTempScript,
      emit: (channel, payload) => {
        mainWindow?.webContents.send(channel, payload)
      },
      env: process.env as Record<string, string>,
      platform: process.platform
    })

    registerPtyIpc(ptyManager, settingsStore, () => detectShells(createNodeShellProbe()))
```

并在 `mainWindow.on('closed', ...)` 回调内、`mainWindow = null` 之前插入:

```ts
      void ptyManager.disposeAll()
```

在 `app.on('window-all-closed', ...)` 之前追加应用级兜底清理:

```ts
  app.on('before-quit', () => {
    void ptyManagerRef?.disposeAll()
  })
```

> 为让 `before-quit` 能访问到 manager,在文件顶层 `let mainWindow: BrowserWindow | null = null` 下方增加:
> `let ptyManagerRef: ReturnType<typeof createPtyManager> | null = null`
> 并在创建后赋值:`ptyManagerRef = ptyManager`

- [ ] **步骤 15:在 preload 暴露 pty API 与事件订阅**

在 `src/preload/index.ts` 的 `api` 对象中追加:

```ts
  pty: {
    start: (input: { scriptId: string; scriptName: string; content: string; shellId: string | null }): Promise<{
      runId: string
      title: string
    }> => ipcRenderer.invoke('pty:start', input),
    write: (runId: string, data: string): Promise<void> => ipcRenderer.invoke('pty:write', { runId, data }),
    resize: (runId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('pty:resize', { runId, cols, rows }),
    close: (runId: string): Promise<void> => ipcRenderer.invoke('pty:close', { runId }),
    closeAll: (): Promise<void> => ipcRenderer.invoke('pty:closeAll'),
    onData: (listener: (payload: { runId: string; chunk: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: { runId: string; chunk: string }): void => listener(payload)
      ipcRenderer.on('pty:data', handler)
      return () => ipcRenderer.removeListener('pty:data', handler)
    },
    onExit: (listener: (payload: { runId: string; exitCode: number; signal: number | null }) => void): (() => void) => {
      const handler = (_e: unknown, payload: { runId: string; exitCode: number; signal: number | null }): void =>
        listener(payload)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    }
  },
```

- [ ] **步骤 16:类型检查与手动验证终端执行**

```bash
npm run typecheck && npm run dev
```

在 DevTools Console 执行:

```js
const infos = await window.api.shell.detect()
const started = await window.api.pty.start({ scriptId: 's1', scriptName: '冒烟', content: 'echo pty-smoke-ok; ls', shellId: infos[0].id })
console.log('runId', started.runId, 'title', started.title)
window.api.pty.onData(({ chunk }) => console.log('DATA:', JSON.stringify(chunk)))
window.api.pty.onExit(({ exitCode }) => console.log('EXIT:', exitCode))
```

预期:Console 打印 `DATA: ...pty-smoke-ok...` 以及 `ls` 的目录列表;因 shell 保持交互,**不会**立即出现 `EXIT`。

再执行以下命令验证交互与关闭:

```js
await window.api.pty.write(started.runId, 'echo interactive-ok\n')
await window.api.pty.close(started.runId)
```

预期:先打印 `interactive-ok`,随后 Console 出现 `EXIT:` 且 `/tmp` 下 `easyops-*.sh` 被清理。

- [ ] **步骤 17:Commit**

```bash
git add src/main/pty/ src/main/ipc/pty.ts src/main/ipc/index.ts src/main/index.ts src/preload/ tests/main/
git commit -m "feat: 实现 PTY 会话管理与终端 IPC"
```

---

## 任务 10:终端界面(面板、最大化、单个/批量关闭)

**文件:**
- 创建:`src/renderer/src/store/useTerminalStore.ts`
- 创建:`src/renderer/src/hooks/usePtyEvents.ts`
- 创建:`src/renderer/src/components/TerminalView.tsx`
- 创建:`src/renderer/src/components/TerminalDock.tsx`
- 修改:`src/renderer/src/App.tsx`
- 修改:`src/renderer/src/components/Sidebar.tsx`(脚本行增加「执行」按钮)
- 测试:`tests/renderer/terminalStore.test.ts`

- [ ] **步骤 1:写失败的测试(终端列表状态)**

`tests/renderer/terminalStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { terminalActions, useTerminalStore } from '../../src/renderer/src/store/useTerminalStore'

beforeEach(() => {
  useTerminalStore.setState({ sessions: [], activeRunId: null, maximizedRunId: null })
})

describe('终端列表', () => {
  it('新增终端后出现在列表中', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    expect(terminalActions.get().sessions).toHaveLength(1)
    expect(terminalActions.get().sessions[0].title).toBe('a')
  })

  it('新增后自动成为活动终端', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('移除终端后活动项切换到剩余的第一个', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.remove('r2')
    expect(terminalActions.get().sessions.map((s) => s.runId)).toEqual(['r1'])
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('移除最后一个终端后活动项为 null', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.remove('r1')
    expect(terminalActions.get().sessions).toHaveLength(0)
    expect(terminalActions.get().activeRunId).toBeNull()
  })

  it('标记退出后保留终端但记录退出码', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.markExited('r1', 0)
    expect(terminalActions.get().sessions).toHaveLength(1)
    expect(terminalActions.get().sessions[0].exited).toBe(true)
    expect(terminalActions.get().sessions[0].exitCode).toBe(0)
  })

  it('切换活动终端', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.setActive('r1')
    expect(terminalActions.get().activeRunId).toBe('r1')
  })

  it('最大化状态按 runId 记录,取消后清空', () => {
    terminalActions.add({ runId: 'r1', title: 'a', scriptId: 's1' })
    terminalActions.add({ runId: 'r2', title: 'b', scriptId: 's2' })
    terminalActions.setMaximized('r1', true)
    expect(terminalActions.get().maximizedRunId).toBe('r1')
    terminalActions.setMaximized('r2', true)
    expect(terminalActions.get().maximizedRunId).toBe('r2')
    terminalActions.setMaximized('r2', false)
    expect(terminalActions.get().maximizedRunId).toBeNull()
  })
})
```

- [ ] **步骤 2:运行测试验证失败**

运行:`npx vitest run tests/renderer/terminalStore.test.ts`
预期:FAIL,无法解析模块。

- [ ] **步骤 3:实现终端 store**

`src/renderer/src/store/useTerminalStore.ts`:

```ts
import { create } from 'zustand'

export interface TerminalSessionView {
  runId: string
  title: string
  scriptId: string
  exited: boolean
  exitCode: number | null
}

export interface TerminalState {
  sessions: TerminalSessionView[]
  activeRunId: string | null
  maximizedRunId: string | null
}

export const useTerminalStore = create<TerminalState>(() => ({
  sessions: [],
  activeRunId: null,
  maximizedRunId: null
}))

export interface TerminalActions {
  get: () => TerminalState
  add: (input: { runId: string; title: string; scriptId: string }) => void
  remove: (runId: string) => void
  markExited: (runId: string, exitCode: number) => void
  setActive: (runId: string | null) => void
  setMaximized: (runId: string, maximized: boolean) => void
}

export const terminalActions: TerminalActions = {
  get: () => useTerminalStore.getState(),

    add({ runId, title, scriptId }) {
      useTerminalStore.setState((state) => ({
        sessions: [...state.sessions, { runId, title, scriptId, exited: false, exitCode: null }],
        activeRunId: runId
      }))
    },

    remove(runId) {
      useTerminalStore.setState((state) => {
        const sessions = state.sessions.filter((s) => s.runId !== runId)
        return {
          sessions,
          activeRunId: state.activeRunId === runId ? (sessions[0]?.runId ?? null) : state.activeRunId,
          maximizedRunId: state.maximizedRunId === runId ? null : state.maximizedRunId
        }
      })
    },

    markExited(runId, exitCode) {
      useTerminalStore.setState((state) => ({
        sessions: state.sessions.map((s) => (s.runId === runId ? { ...s, exited: true, exitCode } : s))
      }))
    },

    setActive(runId) {
      useTerminalStore.setState({ activeRunId: runId })
    },

    setMaximized(runId, maximized) {
      useTerminalStore.setState({ maximizedRunId: maximized ? runId : null })
    }
}
```

> 设计说明:状态本体放在 zustand store(供 React 订阅),操作集中在 `terminalActions`(供非组件代码与测试调用);二者共享同一份状态,因此不需要工厂函数。步骤 1 的测试已在 `beforeEach` 中通过 `useTerminalStore.setState(...)` 重置。

- [ ] **步骤 4:运行测试验证通过**

运行:`npx vitest run tests/renderer/terminalStore.test.ts`
预期:全部 PASS。

- [ ] **步骤 5:实现事件订阅 hook**

`src/renderer/src/hooks/usePtyEvents.ts`:

```ts
import { useEffect, useRef } from 'react'
import { terminalActions } from '../store/useTerminalStore'

export interface PtyDataHandler {
  (runId: string, chunk: string): void
}

export function usePtyEvents(onData: PtyDataHandler): void {
  const handlerRef = useRef(onData)
  handlerRef.current = onData

  useEffect(() => {
    const offData = window.api.pty.onData(({ runId, chunk }) => handlerRef.current(runId, chunk))
    const offExit = window.api.pty.onExit(({ runId, exitCode }) => {
      terminalActions.markExited(runId, exitCode)
    })

    return () => {
      offData()
      offExit()
    }
  }, [])
}
```

- [ ] **步骤 6:实现单个终端视图**

`src/renderer/src/components/TerminalView.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '../theme/provider'

const LIGHT_THEME = { background: '#ffffff', foreground: '#1f1f1f', cursor: '#1f1f1f' }
const DARK_THEME = { background: '#141414', foreground: '#e6e6e6', cursor: '#e6e6e6' }

export function TerminalView({
  runId,
  active,
  onRegisterWriter
}: {
  runId: string
  active: boolean
  onRegisterWriter: (runId: string, writer: (chunk: string) => void) => void
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const { resolved } = useTheme()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme: resolved === 'dark' ? DARK_THEME : LIGHT_THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    onRegisterWriter(runId, (chunk) => term.write(chunk))

    const inputDisposable = term.onData((data) => {
      void window.api.pty.write(runId, data)
    })

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        void window.api.pty.resize(runId, term.cols, term.rows)
      } catch {
        // 容器尺寸为 0 时 fit 会抛错,忽略即可
      }
    })
    observer.observe(container)

    void window.api.pty.resize(runId, term.cols, term.rows)

    return () => {
      observer.disconnect()
      inputDisposable.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [runId, onRegisterWriter])

  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = resolved === 'dark' ? DARK_THEME : LIGHT_THEME
  }, [resolved])

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit()
        if (termRef.current) void window.api.pty.resize(runId, termRef.current.cols, termRef.current.rows)
      } catch {
        // 忽略尺寸计算失败
      }
      termRef.current?.focus()
    }, 30)
    return () => clearTimeout(timer)
  }, [active, runId])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}
```

- [ ] **步骤 7:实现终端面板区**

`src/renderer/src/components/TerminalDock.tsx`:

```tsx
import { useCallback, useMemo, useRef, useState } from 'react'
import { Badge, Button, Empty, Space, Tag, Tooltip, Typography } from 'antd'
import { CloseOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons'
import { terminalActions, useTerminalStore } from '../store/useTerminalStore'
import { usePtyEvents } from '../hooks/usePtyEvents'
import { TerminalView } from './TerminalView'

export function TerminalDock(): JSX.Element {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeRunId = useTerminalStore((s) => s.activeRunId)
  const maximizedRunId = useTerminalStore((s) => s.maximizedRunId)

  const writers = useRef(new Map<string, (chunk: string) => void>())
  const buffers = useRef(new Map<string, string[]>())
  const [, forceRender] = useState(0)

  const registerWriter = useCallback((runId: string, writer: (chunk: string) => void) => {
    writers.current.set(runId, writer)
    const pending = buffers.current.get(runId)
    if (pending && pending.length > 0) {
      pending.forEach((chunk) => writer(chunk))
      buffers.current.delete(runId)
    }
  }, [])

  usePtyEvents((runId, chunk) => {
    const writer = writers.current.get(runId)
    if (writer) {
      writer(chunk)
      return
    }
    const pending = buffers.current.get(runId) ?? []
    pending.push(chunk)
    buffers.current.set(runId, pending)
  })

  const handleClose = async (runId: string): Promise<void> => {
    await window.api.pty.close(runId)
    writers.current.delete(runId)
    buffers.current.delete(runId)
    terminalActions.remove(runId)
    forceRender((n) => n + 1)
  }

  const handleCloseAll = async (): Promise<void> => {
    await window.api.pty.closeAll()
    writers.current.clear()
    buffers.current.clear()
    useTerminalStore.setState({ sessions: [], activeRunId: null, maximizedRunId: null })
    forceRender((n) => n + 1)
  }

  const activeSession = useMemo(
    () => sessions.find((s) => s.runId === activeRunId) ?? null,
    [sessions, activeRunId]
  )

  if (sessions.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="还没有运行中的终端,在左侧脚本上点击「执行」" />
      </div>
    )
  }

  const isMaximized = maximizedRunId !== null

  const tabBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
      {sessions.map((s) => (
        <Tag.CheckableTag
          key={s.runId}
          checked={s.runId === activeRunId}
          onChange={() => terminalActions.setActive(s.runId)}
          style={{ cursor: 'pointer', marginInlineEnd: 0 }}
        >
          <Space size={4}>
            <span>{s.title}</span>
            {s.exited ? <Badge status="default" text={`退出 ${s.exitCode ?? 0}`} /> : <Badge status="processing" />}
          </Space>
        </Tag.CheckableTag>
      ))}
      <Button size="small" onClick={handleCloseAll} danger>
        关闭全部
      </Button>
    </div>
  )

  const activePanel = activeSession ? (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderBottom: '1px solid rgba(5,5,5,0.06)'
        }}
      >
        <Typography.Text strong style={{ fontSize: 12 }}>
          {activeSession.title}
        </Typography.Text>
        <Space size={2}>
          <Tooltip title={isMaximized ? '还原' : '最大化'}>
            <Button
              type="text"
              size="small"
              icon={isMaximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() =>
                terminalActions.setMaximized(activeSession.runId, !isMaximized)
              }
            />
          </Tooltip>
          <Tooltip title="关闭此终端">
            <Button
              type="text"
              size="small"
              danger
              icon={<CloseOutlined />}
              onClick={() => void handleClose(activeSession.runId)}
            />
          </Tooltip>
        </Space>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 4 }}>
        {sessions.map((s) => (
          <div
            key={s.runId}
            style={{
              height: '100%',
              display: s.runId === activeSession.runId ? 'block' : 'none'
            }}
          >
            <TerminalView runId={s.runId} active={s.runId === activeSession.runId} onRegisterWriter={registerWriter} />
          </div>
        ))}
      </div>
    </div>
  ) : null

  if (isMaximized) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'var(--easyops-terminal-bg, #fff)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {tabBar}
        {activePanel}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {tabBar}
      <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid rgba(5,5,5,0.06)' }}>{activePanel}</div>
    </div>
  )
}
```

> 说明:最大化使用 `position: fixed; inset: 0` 覆盖整个窗口(仅作用于渲染进程文档,不是 Electron 的原生全屏),按「还原」按钮退出。

- [ ] **步骤 8:在脚本行增加「执行」按钮**

修改 `src/renderer/src/components/Sidebar.tsx`:

1. 顶部导入增加:

```tsx
import { PlayCircleOutlined } from '@ant-design/icons'
import { terminalActions } from '../store/useTerminalStore'
```

2. 在组件内 `handleDeleteScript` 之前增加执行处理函数:

```tsx
  const handleRun = async (script: Script): Promise<void> => {
    try {
      const { runId, title } = await window.api.pty.start({
        scriptId: script.id,
        scriptName: script.name,
        content: script.content,
        shellId: script.shellId
      })
      terminalActions.add({ runId, title, scriptId: script.id })
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }
```

3. 在 `renderScript` 的按钮组中、编辑按钮之前插入执行按钮:

```tsx
        <Tooltip title="执行">
          <Button
            type="text"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              void handleRun(script)
            }}
          />
        </Tooltip>
```

- [ ] **步骤 9:在 App 中接入终端面板**

修改 `src/renderer/src/App.tsx`:导入 `TerminalDock`:

```tsx
import { TerminalDock } from './components/TerminalDock'
```

将 `Workspace` 的 `<main>` 内容改为「脚本详情 + 终端面板」的上下布局:

```tsx
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ flex: '0 0 40%', padding: 16, overflow: 'auto', minHeight: 0 }}>
          {selected ? (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Space>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  {selected.name}
                </Typography.Title>
                <Button size="small" onClick={() => openForm({ type: 'script-edit', script: selected })}>
                  编辑
                </Button>
              </Space>
              <ScriptEditor value={selected.content} readOnly height="220px" />
            </Space>
          ) : (
            <Typography.Text type="secondary">从左侧选择一个脚本查看详情</Typography.Text>
          )}
        </div>
        <div style={{ flex: 1, borderTop: '1px solid rgba(5,5,5,0.06)', minHeight: 0 }}>
          <TerminalDock />
        </div>
      </main>
```

- [ ] **步骤 10:运行测试与类型检查**

```bash
npm test
npm run typecheck
```

预期:全部 PASS,类型无错误。

- [ ] **步骤 11:手动验证终端交互**

```bash
npm run dev
```

预期逐项确认:
1. 点击某脚本行的「执行」按钮 → 下方出现终端面板,标题为脚本名,并自动执行脚本内容。
2. 在终端中键入 `echo hello` 回车 → 显示 `hello`,可继续输入(真正的交互式终端)。
3. 执行一个需要输入的命令(如 `read -p "name: " n; echo "hi $n"`)→ 终端能等待输入并正确回显。
4. 脚本执行中按 `Ctrl+C` → 当前命令被中断,终端仍可用。
5. 同一脚本再次执行 → 标题变为 `脚本名 (2)`,两个终端以标签并列。
6. 点击「最大化」→ 终端铺满窗口;点「还原」恢复。
7. 点击单个终端的关闭按钮 → 该终端消失,PTY 进程结束。
8. 点击「关闭全部」→ 所有终端消失。
9. 在终端内运行 `sleep 300`,关闭该终端后执行 `ps aux | grep sleep`(或在任务管理器查看)→ **无残留进程**。
10. 直接关闭应用窗口 → 再检查 `ps` 无 `easyops-*.sh` 残留进程与临时文件。

- [ ] **步骤 12:Commit**

```bash
git add src/renderer/src/ tests/renderer/terminalStore.test.ts
git commit -m "feat: 实现交互式终端界面与批量关闭"
```

---

## 计划 2 完成标志

完成后应用具备完整核心能力:检测/切换 shell,执行脚本得到真正的交互式终端,可最大化、单个关闭、批量关闭,且无进程与临时文件泄漏。

自检记录:本计划覆盖规格 §8(终端设计全部小节)、§9(Shell 检测)与 §15 中与原生模块相关的要求;规格中 §6、§12、§13、§14 由计划 3 覆盖;§2 中 xterm 相关版本约束已在全局约束中逐字锁定。
