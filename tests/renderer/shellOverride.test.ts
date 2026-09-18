import { describe, expect, it } from 'vitest'
import type { ShellInfo } from '../../src/shared/types'
import {
  FOLLOW_GLOBAL,
  buildCustomShell,
  buildOverrideOptions,
  buildShellOptions,
  globalShellLabel,
  resolveScriptOverride,
  toSelectValue,
  toShellIdPatch
} from '../../src/renderer/src/settings/shellOverride'

const shell = (over: Partial<ShellInfo> & Pick<ShellInfo, 'id'>): ShellInfo => ({
  name: over.id,
  path: `/bin/${over.id}`,
  args: ['-i'],
  source: 'detected',
  ...over
})

describe('shell 选项映射', () => {
  it('首项是「跟随全局」,其后按检测顺序给出每个 shell', () => {
    const options = buildShellOptions([shell({ id: 'zsh' }), shell({ id: 'bash' })])
    expect(options[0]).toEqual({ label: '跟随全局', value: FOLLOW_GLOBAL })
    expect(options.slice(1).map((o) => o.value)).toEqual(['zsh', 'bash'])
  })

  it('label 带路径以区分同名不同路径的 shell', () => {
    const options = buildShellOptions([
      shell({ id: 'zsh', path: '/bin/zsh' }),
      shell({ id: 'zsh-a1b2c3', name: 'zsh', path: '/usr/bin/zsh' })
    ])
    expect(options[1].label).toBe('zsh · /bin/zsh')
    expect(options[2].label).toBe('zsh · /usr/bin/zsh')
  })

  it('自定义 shell 标「自定义」', () => {
    const options = buildShellOptions([
      shell({ id: 'custom:/opt/zsh', name: 'zsh', source: 'custom', path: '/opt/zsh' })
    ])
    expect(options[1].label).toBe('zsh · 自定义')
  })

  it('没有 shell 时只剩「跟随全局」一项', () => {
    expect(buildShellOptions([])).toEqual([{ label: '跟随全局', value: FOLLOW_GLOBAL }])
  })
})

describe('「跟随全局」哨兵值与 shellId 互转', () => {
  it('null 映射到哨兵值', () => {
    expect(toSelectValue(null)).toBe(FOLLOW_GLOBAL)
    expect(toSelectValue('zsh')).toBe('zsh')
  })

  it('哨兵值写回 null,其余原样', () => {
    expect(toShellIdPatch(FOLLOW_GLOBAL)).toBeNull()
    expect(toShellIdPatch('bash')).toBe('bash')
  })
})

describe('脚本覆盖的默认值判定', () => {
  it('未覆盖时选中「跟随全局」且不算失效', () => {
    expect(resolveScriptOverride(null, ['zsh'])).toEqual({ value: FOLLOW_GLOBAL, stale: false })
  })

  it('覆盖到已知 shell 时选中该项', () => {
    expect(resolveScriptOverride('bash', ['zsh', 'bash'])).toEqual({ value: 'bash', stale: false })
  })

  it('覆盖的 shell 已不存在时原样选中并标记失效', () => {
    expect(resolveScriptOverride('custom:/opt/gone', ['zsh'])).toEqual({
      value: 'custom:/opt/gone',
      stale: true
    })
  })
})

describe('单个脚本的下拉选项', () => {
  const shells = [shell({ id: 'zsh' })]

  it('未覆盖时选项为「跟随全局」加全部可用 shell', () => {
    expect(buildOverrideOptions(shells, null).map((o) => o.value)).toEqual([FOLLOW_GLOBAL, 'zsh'])
  })

  it('覆盖失效时补一项标注「已不可用」的选项,使当前值仍可读', () => {
    const options = buildOverrideOptions(shells, 'custom:/opt/gone')
    expect(options).toHaveLength(3)
    expect(options[2]).toEqual({ label: 'custom:/opt/gone(已不可用)', value: 'custom:/opt/gone' })
  })

  it('一个可用 shell 都没有时,失效值仍作为占位项可读', () => {
    expect(buildOverrideOptions([], 'custom:/opt/gone')).toEqual([
      { label: '跟随全局', value: FOLLOW_GLOBAL },
      { label: 'custom:/opt/gone(已不可用)', value: 'custom:/opt/gone' }
    ])
  })
})

describe('全局默认 shell 的名称', () => {
  const shells = [shell({ id: 'zsh' }), shell({ id: 'bash' })]

  it('没有 shell 时为 null', () => {
    expect(globalShellLabel([], null)).toBeNull()
  })

  it('未显式选择时取第一项', () => {
    expect(globalShellLabel(shells, null)).toBe('zsh')
  })

  it('已显式选择时取选择项', () => {
    expect(globalShellLabel(shells, 'bash')).toBe('bash')
  })

  it('选择项不存在时回落到第一项', () => {
    expect(globalShellLabel(shells, 'gone')).toBe('zsh')
  })
})

describe('自定义 shell 条目', () => {
  it('posix 路径取末段作为名称', () => {
    expect(buildCustomShell('/opt/homebrew/bin/zsh')).toEqual({
      id: 'custom:/opt/homebrew/bin/zsh',
      name: 'zsh',
      path: '/opt/homebrew/bin/zsh'
    })
  })

  it('windows 路径按反斜杠取末段并去掉扩展名后缀', () => {
    expect(buildCustomShell('C:\\Program Files\\Git\\bin\\bash.exe')).toEqual({
      id: 'custom:C:\\Program Files\\Git\\bin\\bash.exe',
      name: 'bash.exe',
      path: 'C:\\Program Files\\Git\\bin\\bash.exe'
    })
  })

  it('没有分隔符时名称与路径相同', () => {
    expect(buildCustomShell('zsh')).toEqual({ id: 'custom:zsh', name: 'zsh', path: 'zsh' })
  })
})
