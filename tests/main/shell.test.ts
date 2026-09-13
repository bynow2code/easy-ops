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
