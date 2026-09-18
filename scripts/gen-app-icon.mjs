#!/usr/bin/env node
/**
 * 生成应用图标 PNG（可复现的图标源）。
 *
 * 图标几何就写在本文件里 —— 改图标改这里，然后重新生成三个平台的产物：
 *   node scripts/gen-app-icon.mjs <尺寸> <输出路径>
 *   node scripts/gen-app-icon.mjs 1024 build/icon.png
 *
 * 不依赖任何图形库：直接按形状算覆盖率（4×4 超采样做抗锯齿），
 * 再用内置 zlib 手写 PNG。这样在只有 node 的环境里也能重新生成图标。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 设计基准是 1024×1024 的「画板」,所有几何量按画板写,再按目标尺寸等比缩放。
 *
 * 注意画板 ≠ 画布:画板是**图案本身**,画布是最终输出的 1024×1024 方框。
 * 两者之间有一圈留白,来自 Apple 的生产模板网格 —— 1024 画布里主体 824,
 * 四周各留 100px(约 9.8%)。系统按画布对齐所有应用图标,若主体铺满画布,
 * 在 Dock / Finder / 启动台里会比系统应用明显大一圈。
 * 数字出处:Apple Design Resources 的 macOS App Icon 生产模板(HIG 正文只写
 * 1024×1024,留白数值在模板网格里,HIG 让人去用那份模板)。
 */
const BASE = 1024
/** 画布四周各留的透明边(画板单位) */
const 画布留白 = 100
/** 画板铺进画布时的缩放:824 / 1024 */
const 主体比例 = (BASE - 画布留白 * 2) / BASE

const 底色 = { r: 0x23, g: 0x28, b: 0x38 } // 深海军蓝
const 提示符色 = { r: 0x5d, g: 0xca, b: 0xa5 } // 青
const 光标色 = { r: 0xff, g: 0xff, b: 0xff }

/**
 * 圆角方块底:铺满**整张画板**,圆角 230/1024。
 * 缩到画布上的 824 后圆角约 185,即主体宽的 22.5%(Apple 模板的连续曲率值;
 * 我们是普通圆角矩形,不追 squircle,视觉差异在这个尺寸下极小)。
 */
const 底 = { x: 0, y: 0, w: BASE, h: BASE, r: 230 }
/** 提示符 > 的折线，圆头圆角描边 */
const 提示符 = {
  points: [
    [275, 322],
    [475, 512],
    [275, 702]
  ],
  width: 104
}
/** 光标块 */
const 光标 = { x: 569, y: 596, w: 232, h: 104, r: 36 }

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0 // filter: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** 点 (px,py) 是否落在圆角矩形内 */
function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

/** 点到线段的距离 */
function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / len2))
  const dx = px - (ax + t * vx)
  const dy = py - (ay + t * vy)
  return Math.hypot(dx, dy)
}

function distToPolyline(px, py, points) {
  let min = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const d = distToSegment(px, py, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1])
    if (d < min) min = d
  }
  return min
}

function render(size) {
  const scale = size / BASE
  const rgba = Buffer.alloc(size * size * 4)
  const SS = 4 // 每轴 4 个子采样 → 16 个/像素
  const step = 1 / SS

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCov = 0
      let markCov = 0
      let cursorCov = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // 画布坐标(0~1024)→ 画板坐标:先减掉留白,再按主体比例还原。
          // 落在留白区内的点会算出画板之外的坐标,三个覆盖率函数都返回 false → 透明。
          // 这样底、提示符、光标是**整体**一起缩放的,不会只缩底色而让图案相对变大。
          const px = ((x + (sx + 0.5) * step) / scale - 画布留白) / 主体比例
          const py = ((y + (sy + 0.5) * step) / scale - 画布留白) / 主体比例
          if (insideRoundRect(px, py, 底.x, 底.y, 底.w, 底.h, 底.r)) bgCov++
          if (distToPolyline(px, py, 提示符.points) <= 提示符.width / 2) markCov++
          if (insideRoundRect(px, py, 光标.x, 光标.y, 光标.w, 光标.h, 光标.r)) cursorCov++
        }
      }
      const total = SS * SS
      // 依次叠加：底 → 提示符 → 光标
      let r = 0
      let g = 0
      let b = 0
      let a = bgCov / total
      r = 底色.r
      g = 底色.g
      b = 底色.b
      const markA = markCov / total
      if (markA > 0) {
        r = r * (1 - markA) + 提示符色.r * markA
        g = g * (1 - markA) + 提示符色.g * markA
        b = b * (1 - markA) + 提示符色.b * markA
        a = a * (1 - markA) + markA
      }
      const cursorA = cursorCov / total
      if (cursorA > 0) {
        r = r * (1 - cursorA) + 光标色.r * cursorA
        g = g * (1 - cursorA) + 光标色.g * cursorA
        b = b * (1 - cursorA) + 光标色.b * cursorA
        a = a * (1 - cursorA) + cursorA
      }
      const o = (y * size + x) * 4
      rgba[o] = Math.round(r)
      rgba[o + 1] = Math.round(g)
      rgba[o + 2] = Math.round(b)
      rgba[o + 3] = Math.round(a * 255)
    }
  }
  return encodePng(size, rgba)
}

// 供 scripts/build-icons.mjs 复用同一套渲染(每个尺寸原生渲染,不从 1024 降采样)
export { render }

/** 直接 `node scripts/gen-app-icon.mjs <尺寸> <输出>` 时才走 CLI;被 import 时不执行 */
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const size = Number(process.argv[2] ?? 1024)
  const out = process.argv[3] ?? `build/icon-${size}.png`
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, render(size))
  console.log(`已生成 ${out}（${size}×${size}）`)
}
