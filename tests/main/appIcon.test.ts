import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAppIcon } from '../../src/main/appIcon'

/**
 * 这段判断依赖「平台 × 是否打包」两维,而打包后的行为**无法在开发机上回归**
 * (本机是 macOS,验证不了 Linux 包)。所以只能把判据固化在这里:
 * 一旦有人把 Linux 打包后的分支改回「不再设图标」,图标问题会静默复发。
 */
describe('窗口图标的解析', () => {
  const base = { resourcesPath: '/opt/EasyOps/resources', appPath: '/proj/easy-ops' }

  it('dev 下三个平台都要设,否则窗口与 Dock 会露出 Electron 默认图标', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(resolveAppIcon({ ...base, platform, packaged: false })).toEqual({
        apply: true,
        path: '/proj/easy-ops/build/icon.png'
      })
    }
  })

  it('打包后 mac / win 不再由代码设:系统分别用 .icns 与 exe 内嵌的 .ico', () => {
    expect(resolveAppIcon({ ...base, platform: 'darwin', packaged: true }).apply).toBe(false)
    expect(resolveAppIcon({ ...base, platform: 'win32', packaged: true }).apply).toBe(false)
  })

  it('打包后的 Linux 仍要设 —— AppImage 不装 .desktop,桌面环境只能靠窗口的 _NET_WM_ICON', () => {
    // 走 extraResources 打进来的那份,而不是开发目录
    expect(resolveAppIcon({ ...base, platform: 'linux', packaged: true })).toEqual({
      apply: true,
      path: '/opt/EasyOps/resources/icon.png'
    })
  })
})

/**
 * Linux 图标集契约。
 *
 * 背景(freedesktop 图标主题规范 + 实测):hicolor 的 index.theme 只声明到 512x512。
 * 只提供一张 1024 时,electron-builder 会把它放进 hicolor/1024x1024/apps/,
 * 这个尺寸目录不在 index.theme 里,图标主题查找时**不会扫描**它 ——
 * 任务栏、启动器全都回落成通用图标。AppImage 更绕:AppImageLauncher 把包内 .DirIcon
 * (即最大那张)原样抄进 ~/.local/share/icons/hicolor/1024x1024/apps/,同样解析不到。
 */
describe('Linux 图标集', () => {
  const iconDir = join(process.cwd(), 'build', 'icons')

  /** PNG 的宽高就在 IHDR 里:签名 8 字节 + 长度 4 + 类型 4,宽高各 4 字节大端 */
  function pngSize(file: string): { width: number; height: number } {
    const buf = readFileSync(file)
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }

  it('每个尺寸都与文件名一致,且全部落在 hicolor 声明过的尺寸里', () => {
    const files = readdirSync(iconDir).filter((f) => f.endsWith('.png'))
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      const match = name.match(/^(\d+)x(\d+)\.png$/)
      expect(match, `${name} 的命名必须形如 256x256.png(否则 electron-builder 认不出尺寸)`).toBeTruthy()
      const declared = Number(match![1])
      const actual = pngSize(join(iconDir, name))
      expect(actual).toEqual({ width: declared, height: declared })
      // 512 是 hicolor 的上限:超过它的目录不在 index.theme 里,图标解析不到
      expect(declared).toBeLessThanOrEqual(512)
    }
  })

  it('至少要有 256 与 512 —— 任务栏从这两个尺寸里挑,缺了就回落成通用图标', () => {
    const sizes = new Set(readdirSync(iconDir).map((f) => Number(f.split('x')[0])))
    expect(sizes.has(256)).toBe(true)
    expect(sizes.has(512)).toBe(true)
  })

  it('electron-builder 的 linux.icon 指向这个目录,而不是单张 png', () => {
    // 直接读配置文件:改用单张 png 会让上面的尺寸集白做(只有它那一张会被打进包)
    const yml = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')
    const linuxBlock = yml.slice(yml.indexOf('\nlinux:'))
    expect(linuxBlock).toMatch(/^\s+icon:\s*build\/icons\s*$/m)
  })
})
