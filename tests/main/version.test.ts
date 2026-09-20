import { describe, expect, it } from 'vitest'
import {
  buildReplaceScript,
  compareVersions,
  decideMacUpdateAction,
  deriveAppPath,
  isNewer,
  normalizeVersion,
  parseLatestMacChecksums
} from '../../src/main/updater/version'

describe('normalizeVersion', () => {
  it('去掉前缀 v', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
  })

  it('保留纯数字版本号', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
  })
})

describe('compareVersions', () => {
  it('主版本更大时返回 1', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })

  it('相等返回 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('补丁版本更小时返回 -1', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
  })

  it('忽略 v 前缀', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('段数不同时按缺失段为 0 比较', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })
})

describe('isNewer', () => {
  it('远端更大时为 true', () => {
    expect(isNewer('0.7.15', 'v0.8.0')).toBe(true)
  })

  it('远端更小时为 false', () => {
    expect(isNewer('0.8.0', 'v0.7.15')).toBe(false)
  })
})

describe('decideMacUpdateAction', () => {
  it('应用位于 /Applications 且有写权限时可自动替换', () => {
    expect(
      decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: true })
    ).toBe('auto-replace')
  })

  it('应用不在 /Applications 时回退为引导手动下载', () => {
    expect(decideMacUpdateAction({ appPath: '/Users/x/Downloads/EasyOps.app', canWriteTarget: true })).toBe(
      'manual-download'
    )
  })

  it('无写权限时回退为引导手动下载', () => {
    expect(
      decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: false })
    ).toBe('manual-download')
  })

  it('路径同时满足但权限不足时不得自动替换', () => {
    expect(decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: false })).not.toBe(
      'auto-replace'
    )
  })

  it('四种输入组合均落到预期动作', () => {
    const apps = ['/Applications/EasyOps.app', '/Users/x/Downloads/EasyOps.app']
    const cases = [
      { input: { appPath: apps[0], canWriteTarget: true }, expected: 'auto-replace' },
      { input: { appPath: apps[0], canWriteTarget: false }, expected: 'manual-download' },
      { input: { appPath: apps[1], canWriteTarget: true }, expected: 'manual-download' },
      { input: { appPath: apps[1], canWriteTarget: false }, expected: 'manual-download' }
    ] as const

    for (const item of cases) {
      expect(decideMacUpdateAction(item.input)).toBe(item.expected)
    }
  })
})

describe('deriveAppPath', () => {
  it('打包运行(app.asar)时剥到 .app 层级', () => {
    expect(deriveAppPath('/Applications/EasyOps.app/Contents/Resources/app.asar')).toBe('/Applications/EasyOps.app')
  })

  it('非 /Applications 的包同样能剥到 .app 层级', () => {
    expect(deriveAppPath('/Users/x/Downloads/EasyOps.app/Contents/Resources/app.asar')).toBe(
      '/Users/x/Downloads/EasyOps.app'
    )
  })

  it('正则失配时原样返回,不吞掉路径', () => {
    expect(deriveAppPath('/Users/arthur/www/easy-ops/out/main')).toBe('/Users/arthur/www/easy-ops/out/main')
    expect(deriveAppPath('/Applications/EasyOps.app/Contents/Resources/app.asar.unpacked')).toBe(
      '/Applications/EasyOps.app/Contents/Resources/app.asar.unpacked'
    )
  })

  it('剥解结果决定 auto-replace 能否成立', () => {
    const appPath = deriveAppPath('/Applications/EasyOps.app/Contents/Resources/app.asar')
    expect(decideMacUpdateAction({ appPath, canWriteTarget: true })).toBe('auto-replace')
  })
})

describe('buildReplaceScript', () => {
  const ERROR_FILE = '/tmp/easyops-update-error.log'
  const build = (): { script: string; appPath: string; extractedAppPath: string; workDir: string } => {
    const appPath = '/Applications/EasyOps.app'
    const extractedAppPath = '/tmp/easyops-update-abc/extract/EasyOps.app'
    const workDir = '/tmp/easyops-update-abc'
    return {
      script: buildReplaceScript({ appPath, extractedAppPath, workDir, errorFile: ERROR_FILE }),
      appPath,
      extractedAppPath,
      workDir
    }
  }

  it('先把新版本拷到 .new,成功后再移除旧包并改名', () => {
    const { script, appPath, extractedAppPath } = build()
    const copyLine = `ditto '${extractedAppPath}' '${appPath}.new'`
    const removeLine = `rm -rf '${appPath}'`
    const moveLine = `mv '${appPath}.new' '${appPath}'`

    expect(script).toContain(copyLine)
    expect(script).toContain(removeLine)
    expect(script).toContain(moveLine)
    expect(script.indexOf(copyLine)).toBeLessThan(script.indexOf(removeLine))
    expect(script.indexOf(removeLine)).toBeLessThan(script.indexOf(moveLine))
  })

  it('拷贝失败即退出,不再删除旧包', () => {
    const { script, extractedAppPath, appPath } = build()
    expect(script).toContain(`ditto '${extractedAppPath}' '${appPath}.new' || fail '拷贝新版本失败'`)
  })

  it('每条失败路径都写入固定错误文件,供下次启动提示', () => {
    const { script } = build()
    expect(script).toContain(`fail() { printf '%s\\n' "$1" >> '${ERROR_FILE}' 2>/dev/null || true; exit 1; }`)
    expect(script).toContain("fail '等待应用退出超时(60 秒)'")
    expect(script).toContain("fail '拷贝新版本失败'")
    expect(script).toContain("fail '替换新版本失败'")
  })

  it('包含去隔离与重启,且顺序为 ditto → xattr → open', () => {
    const { script, appPath } = build()
    const ditto = script.indexOf('ditto ')
    const xattr = script.indexOf(`xattr -dr com.apple.quarantine '${appPath}'`)
    const open = script.indexOf(`open '${appPath}'`)

    expect(ditto).toBeGreaterThan(-1)
    expect(xattr).toBeGreaterThan(ditto)
    expect(open).toBeGreaterThan(xattr)
  })

  it('等待主进程退出有上限,不会无限循环', () => {
    const { script } = build()
    expect(script).toContain('pgrep')
    expect(script).toMatch(/\$WAITED" -ge 60/)
    expect(script).toContain('sleep 1')
  })

  it('末尾回收临时目录,且在改名之后', () => {
    const { script, appPath, workDir } = build()
    const cleanup = script.indexOf(`rm -rf '${workDir}'`)
    expect(cleanup).toBeGreaterThan(-1)
    expect(cleanup).toBeGreaterThan(script.indexOf(`mv '${appPath}.new' '${appPath}'`))
  })

  it('路径含命令替换/反引号/反斜杠时原样落在单引号内,不被 shell 展开', () => {
    const extractedAppPath = '/tmp/easyops-update-abc/extract/EasyOps $(touch /tmp/pwned)`id`\\x.app'
    const script = buildReplaceScript({
      appPath: '/Applications/EasyOps.app',
      extractedAppPath,
      workDir: '/tmp/easyops-update-abc',
      errorFile: ERROR_FILE
    })

    // 整条路径原样落在单引号内,ditto 行不再出现会被 shell 展开的双引号
    const dittoLine = script.split('\n').find((line) => line.startsWith('ditto '))!
    expect(dittoLine).toBe(`ditto '${extractedAppPath}' '/Applications/EasyOps.app.new' || fail '拷贝新版本失败'`)
    expect(dittoLine).not.toContain('"')
  })

  it("路径含单引号时按 '\\'' 转义,引号不会提前闭合", () => {
    const extractedAppPath = "/tmp/easyops-update-abc/extract/EasyOps'; rm -rf ~; '.app"
    const script = buildReplaceScript({
      appPath: '/Applications/EasyOps.app',
      extractedAppPath,
      workDir: '/tmp/easyops-update-abc',
      errorFile: ERROR_FILE
    })

    const escaped = `'${extractedAppPath.replace(/'/g, "'\\''")}'`
    expect(escaped).toContain(`'\\''`)
    expect(script).toContain(`ditto ${escaped} '/Applications/EasyOps.app.new' || fail '拷贝新版本失败'`)
  })
})

describe('parseLatestMacChecksums', () => {
  const yml = [
    'version: 0.8.0',
    'files:',
    '  - url: EasyOps-0.8.0-arm64.zip',
    '    sha512: AAAA==',
    '    size: 123',
    '  - url: EasyOps-0.8.0-x64.zip',
    '    sha512: BBBB==',
    '    size: 456',
    'path: EasyOps-0.8.0-arm64.zip',
    'sha512: CCCC==',
    "releaseDate: '2026-09-20T00:00:00.000Z'"
  ].join('\n')

  it('提取 files 列表里每个 url 的 sha512', () => {
    expect(parseLatestMacChecksums(yml)).toEqual({
      'EasyOps-0.8.0-arm64.zip': 'AAAA==',
      'EasyOps-0.8.0-x64.zip': 'BBBB=='
    })
  })

  it('files 列表结束后的顶层 path/sha512 不再计入(不会用 CCCC== 覆盖)', () => {
    expect(parseLatestMacChecksums(yml)['EasyOps-0.8.0-arm64.zip']).toBe('AAAA==')
  })

  it('空内容与缺 files 列表时返回空映射', () => {
    expect(parseLatestMacChecksums('')).toEqual({})
    expect(parseLatestMacChecksums('version: 0.8.0\npath: x.zip\nsha512: AAAA==')).toEqual({})
  })

  it('条目缺 sha512 时不产生键', () => {
    const partial = 'files:\n  - url: a.zip\n    size: 1\n'
    expect(parseLatestMacChecksums(partial)).toEqual({})
  })
})
