import { describe, expect, it } from 'vitest'
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
