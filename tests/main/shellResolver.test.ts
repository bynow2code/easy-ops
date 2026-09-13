import { describe, expect, it } from 'vitest'
import { createShellResolver } from '../../src/main/pty/shellResolver'
import type { CustomShell, ShellInfo } from '../../src/shared/types'

const detectedShell = (id: string, shellPath: string): ShellInfo => ({
  id,
  name: id,
  path: shellPath,
  args: ['-i'],
  source: 'detected'
})

const customShell = (id: string, name: string, shellPath: string): CustomShell => ({
  id,
  name,
  path: shellPath
})

function makeDeps(overrides: {
  detected?: ShellInfo[]
  customShells?: CustomShell[]
  preferredShellId?: string | null
} = {}) {
  return {
    detect: async () => overrides.detected ?? [detectedShell('zsh', '/bin/zsh')],
    getCustomShells: () => overrides.customShells ?? [],
    getPreferredShellId: () => overrides.preferredShellId ?? null
  }
}

describe('createShellResolver', () => {
  it('检测到的 shell id 命中时直接返回', async () => {
    const resolve = createShellResolver(makeDeps())
    const shell = await resolve('zsh')
    expect(shell.path).toBe('/bin/zsh')
    expect(shell.source).toBe('detected')
  })

  it('custom shell id 从设置中显式解析,不静默 fallback', async () => {
    const resolve = createShellResolver(
      makeDeps({ customShells: [customShell('custom:/opt/bin/mysh', 'mysh', '/opt/bin/mysh')] })
    )
    const shell = await resolve('custom:/opt/bin/mysh')
    expect(shell.path).toBe('/opt/bin/mysh')
    expect(shell.source).toBe('custom')
    expect(shell.args).toEqual(['-i'])
  })

  it('未知 id 显式报错,不再静默 fallback 到第一个 shell', async () => {
    const resolve = createShellResolver(makeDeps())
    await expect(resolve('no-such-shell')).rejects.toThrow(/找不到.*no-such-shell/)
  })

  it('脚本未指定 id 时使用设置中的首选 shell', async () => {
    const resolve = createShellResolver(
      makeDeps({ detected: [detectedShell('zsh', '/bin/zsh'), detectedShell('bash', '/bin/bash')], preferredShellId: 'bash' })
    )
    expect((await resolve(null)).path).toBe('/bin/bash')
  })

  it('脚本与设置都未指定 id 时使用第一个检测到的 shell', async () => {
    const resolve = createShellResolver(
      makeDeps({ detected: [detectedShell('zsh', '/bin/zsh'), detectedShell('bash', '/bin/bash')] })
    )
    expect((await resolve(null)).path).toBe('/bin/zsh')
  })

  it('无指定 id 且没有检测到 shell 时报错', async () => {
    const resolve = createShellResolver(makeDeps({ detected: [] }))
    await expect(resolve(null)).rejects.toThrow(/未检测到可用的 shell/)
  })
})
