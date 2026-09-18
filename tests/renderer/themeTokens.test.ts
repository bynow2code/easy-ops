import { describe, expect, it } from 'vitest'
import {
  BRAND,
  buildAntdTheme,
  buildAppTokens,
  terminalPalette,
  toCssVariables
} from '../../src/renderer/src/theme/tokens'

/** '#RRGGBB' → 相对亮度(0~1),只用于断言「深色的确比浅色深」 */
function luminance(hex: string): number {
  const v = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
  return [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce(
    (sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i],
    0
  )
}

describe('界面令牌', () => {
  it('明暗两套的主色不同:青色在深底上要提亮一档', () => {
    expect(buildAppTokens('light').primary).not.toBe(buildAppTokens('dark').primary)
    expect(buildAppTokens('dark').primary).toBe(BRAND.cyanBright)
  })

  it('两种模式下顶栏都保持深色,作为界面的视觉锚点', () => {
    expect(luminance(buildAppTokens('light').topbarBg)).toBeLessThan(0.1)
    expect(luminance(buildAppTokens('dark').topbarBg)).toBeLessThan(0.1)
  })

  it('深色模式的页面底色确实比浅色模式深', () => {
    expect(luminance(buildAppTokens('dark').layoutBg)).toBeLessThan(
      luminance(buildAppTokens('light').layoutBg)
    )
  })
})

describe('令牌转 CSS 变量', () => {
  const varsOf = (resolved: 'light' | 'dark'): Record<string, string> =>
    toCssVariables(buildAppTokens(resolved))

  it('键统一带 --app- 前缀,且驼峰转成短横线、数字补 px', () => {
    const vars = varsOf('light')
    expect(vars['--app-radius']).toBe('8px')
    expect(vars['--app-radius-lg']).toBe('10px')
    expect(vars['--app-topbar-bg']).toBe(BRAND.navy)
  })

  it('每个令牌都真的产出变量,没有漏项', () => {
    // 以 light 的键集合为准:日后新增令牌却忘了走 toCssVariables 会在这里暴露
    const expected = Object.keys(buildAppTokens('light')).map((k) =>
      `--app-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
    )
    expect(Object.keys(varsOf('dark')).sort()).toEqual(expected.sort())
  })

  it('没有空值或 undefined(否则 CSS 会静默失效)', () => {
    for (const resolved of ['light', 'dark'] as const) {
      for (const [name, value] of Object.entries(varsOf(resolved))) {
        expect(value, `${resolved} 的 ${name} 为空`).toBeTruthy()
        expect(value).not.toContain('undefined')
      }
    }
  })
})

describe('antd 主题配置', () => {
  it('主色与圆角取自同一套令牌', () => {
    const theme = buildAntdTheme('light')
    expect(theme.token?.colorPrimary).toBe(BRAND.cyan)
    expect(theme.token?.borderRadius).toBe(8)
  })

  it('关掉按钮默认投影 —— antd 自带的 box-shadow 是「塑料感」的主因', () => {
    const button = buildAntdTheme('light').components?.Button as Record<string, string>
    expect(button.primaryShadow).toBe('none')
    expect(button.defaultShadow).toBe('none')
  })

  it('明暗两套走不同的 antd 算法', () => {
    expect(buildAntdTheme('light').algorithm).not.toEqual(buildAntdTheme('dark').algorithm)
  })
})

describe('终端配色', () => {
  it('光标用主色,且与终端底色有对比', () => {
    expect(terminalPalette('light').cursor).toBe(BRAND.cyan)
    expect(terminalPalette('dark').cursor).toBe(BRAND.cyanBright)
    expect(terminalPalette('dark').background).not.toBe(terminalPalette('light').background)
  })
})
