#!/usr/bin/env node
/**
 * 生成三平台的应用图标产物。
 *
 *   node scripts/build-icons.mjs
 *
 * 步骤:
 *  1. build/icon.png   1024×1024(给 Linux),由 gen-app-icon.mjs 渲染 —— 几何单一来源在那里
 *  2. build/icon.icns  macOS:iconset 各档尺寸 → iconutil 编译(仅 macOS 有 iconutil)
 *  3. build/icon.ico   Windows:electron-builder 自带的图标转换器,
 *     保证与打包时实际使用的解析逻辑一致
 *
 * 本文件只负责派生,不承载任何视觉决定 —— 改图标的样子去 gen-app-icon.mjs。
 */
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from './gen-app-icon.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const buildDir = join(root, 'build')
mkdirSync(buildDir, { recursive: true })

// 1. 主图(Linux 用,也是下面 icns/ico 的源)
writeFileSync(join(buildDir, 'icon.png'), render(1024))
console.log('✓ build/icon.png (1024)')

// 2. macOS .icns
// 每一档都用原生渲染而不是从 1024 降采样 —— 16px 下光标块才不糊
const SLOTS = [
  ['icon_16x16', 16],
  ['icon_16x16@2x', 32],
  ['icon_32x32', 32],
  ['icon_32x32@2x', 64],
  ['icon_128x128', 128],
  ['icon_128x128@2x', 256],
  ['icon_256x256', 256],
  ['icon_256x256@2x', 512],
  ['icon_512x512', 512],
  ['icon_512x512@2x', 1024]
]

if (process.platform === 'darwin') {
  // iconutil 要求输入目录以 .iconset 结尾,临时目录名要先建好再改名补上后缀
  const tmp = mkdtempSync(join(tmpdir(), 'easyops-icon-'))
  const iconset = `${tmp}.iconset`
  rmSync(iconset, { recursive: true, force: true })
  renameSync(tmp, iconset)
  try {
    for (const [name, size] of SLOTS) {
      writeFileSync(join(iconset, `${name}.png`), render(size))
    }
    const out = join(buildDir, 'icon.icns')
    const r = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', out], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`iconutil 退出码 ${r.status}`)
    console.log('✓ build/icon.icns')
  } finally {
    rmSync(iconset, { recursive: true, force: true })
  }
} else {
  console.log('· 非 macOS,跳过 .icns(打包 mac 产物请在 macOS 上跑)')
}

// 3. Windows .ico
// 用 electron-builder 自己的转换器,不自造 ICO 容器 —— 它就是打包时实际用的那个
const require = createRequire(import.meta.url)
const { convertIcon } = require(join(root, 'node_modules/app-builder-lib/out/util/iconConverter.js'))

const result = await convertIcon({
  sources: ['build/icon.png'],
  fallbackSources: [],
  roots: [root],
  format: 'ico',
  outDir: buildDir
})

const ico = Array.isArray(result) ? result[0] : result
const file = ico?.file ?? ico?.icons?.[0]?.file ?? 'build/icon.ico'
console.log(`✓ ${file.replace(root + '/', '')} (format=${ico?.format ?? 'ico'}, fallback=${ico?.fallback ?? false})`)
