import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildAppTokens, toCssVariables } from '../../src/renderer/src/theme/tokens'

/**
 * --app-* 变量注入契约:扫描源码里全部 var(--app-*) 引用,断言每个名字都被
 * toCssVariables 注入。历史坑:var() 引用写成驼峰(--app-hairlineStrong)时,
 * 变量不存在 → 整条 border 声明 invalid at computed-value time → border-style
 * 静默变 none,边框直接消失 —— TypeScript 与运行时都不会报错,只有肉眼能发现。
 * 扫描正则刻意放行大写字母,让驼峰误写在这里被拦下。
 */

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full)
  }
  return out
}

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/src')

function referencedAppVars(): Map<string, string[]> {
  const refs = new Map<string, string[]>()
  for (const file of walk(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/var\(\s*(--app-[a-zA-Z0-9-]+)/g)) {
      const list = refs.get(match[1]) ?? []
      // 报错信息里给出相对路径,方便直接定位
      list.push(file.replace(`${SRC_ROOT}/`, ''))
      refs.set(match[1], list)
    }
  }
  return refs
}

describe('--app-* 变量注入契约', () => {
  it('源码里 var() 引用的 --app-* 变量全部被 toCssVariables 注入', () => {
    const injected = new Set(Object.keys(toCssVariables(buildAppTokens('light'))))

    const refs = referencedAppVars()
    expect(refs.size, '源码里应存在 --app-* 引用(扫描失效时此断言兜底)').toBeGreaterThan(0)

    for (const [name, files] of refs) {
      expect(
        injected.has(name),
        `${name} 未注入(引用于 ${files.join(', ')})—— 检查是否把 camelCase 键误写进 var(),如 hairlineStrong 应为 --app-hairline-strong`
      ).toBe(true)
    }
  })

  it('注入集合与 AppTokenSet 键一一对应(kebab-case)', () => {
    const tokens = buildAppTokens('light')
    const keys = Object.keys(tokens)
    const injected = Object.keys(toCssVariables(tokens))

    expect(injected).toHaveLength(keys.length)
    for (const key of keys) {
      const kebab = `--app-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
      expect(injected).toContain(kebab)
    }
  })
})
