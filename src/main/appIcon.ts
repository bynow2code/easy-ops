import { join } from 'node:path'

/**
 * apply=false 时不存在有意义的图标路径 —— 判别联合让「apply=false 却去读 path」
 * 在类型层就写不出来,而不是留一个指向不存在文件的字符串。
 */
export type AppIconPlan = { apply: true; path: string } | { apply: false }

/**
 * 决定「窗口/Dock 图标要不要由代码设、从哪里读」。
 *
 * - **dev**:三个平台都要设,否则露出 Electron 默认图标。
 * - **打包后 macOS**:系统用包内的 `.icns`(由 Dock 读取),`BrowserWindow.icon` 在 macOS 本就无效。
 * - **打包后 Windows**:exe 已内嵌 `.ico`。
 * - **打包后 Linux**:**仍然要设**。AppImage 是便携格式 —— 它的 AppRun 脚本只做
 *   `PATH`/`LD_LIBRARY_PATH`/sandbox 处理然后 `exec`,**不会**把 `.desktop` 与图标
 *   安装进系统;桌面环境因此读不到 `.desktop` 里的 `Icon=`,只能回落到窗口自身的
 *   `_NET_WM_ICON`。不设的话任务栏就只剩 Electron 的默认图标。
 */
export function resolveAppIcon(input: {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string
  appPath: string
}): AppIconPlan {
  const { platform, packaged, resourcesPath, appPath } = input
  return {
    apply: !packaged || platform === 'linux',
    // 打包后走 extraResources 打进来的那份(electron-builder.yml 的 linux.extraResources)
    path: packaged ? join(resourcesPath, 'icon.png') : join(appPath, 'build', 'icon.png')
  }
}
