import type { ThemeConfig } from 'antd'
import { theme as antdTheme } from 'antd'

export type ResolvedTheme = 'light' | 'dark'

/**
 * 品牌色,与 build/icon.png 同源:深海军蓝底 + 青。
 * 界面里所有「强调」都只从这两个色相里取,不引入第三种彩色。
 */
export const BRAND = {
  navy: '#0E2439',
  navyDeep: '#0A1A2B',
  cyan: '#0E7490',
  cyanBright: '#22B8CF'
} as const

/**
 * 界面自有令牌(与 antd token 互补)。
 * antd token 管不到「顶栏底色」「主色软底」「分割细线」这些自研样式要用的语义色,
 * 所以在这里集中定义,再由 provider 挂成 CSS 变量。
 */
export interface AppTokenSet {
  /** 主色(即 antd colorPrimary) */
  primary: string
  /** 顶栏底色 —— 浅色/深色两种模式下都保持深色,作为整个界面的视觉锚点 */
  topbarBg: string
  topbarText: string
  topbarMuted: string
  topbarControlBg: string
  topbarControlBorder: string
  topbarControlText: string
  topbarSelectedBg: string
  /** 主色软底 + 其上的文字色,用于选中行、chip 等 */
  accentSoft: string
  accentText: string
  /** 页面底色(面板之间的缝隙露出的那一层) */
  layoutBg: string
  /** 分节/标题栏那种比容器略深一点的底 */
  subtleBg: string
  hairline: string
  hairlineStrong: string
  /** 行悬停底色 */
  rowHover: string
  radius: number
  radiusLg: number
  shadowPanel: string
}

const LIGHT: AppTokenSet = {
  primary: BRAND.cyan,
  topbarBg: BRAND.navy,
  topbarText: 'rgba(255, 255, 255, 0.94)',
  topbarMuted: 'rgba(255, 255, 255, 0.55)',
  topbarControlBg: 'rgba(255, 255, 255, 0.08)',
  topbarControlBorder: 'rgba(255, 255, 255, 0.18)',
  topbarControlText: 'rgba(255, 255, 255, 0.86)',
  topbarSelectedBg: 'rgba(255, 255, 255, 0.18)',
  accentSoft: '#E8F6F8',
  accentText: '#0B3B4A',
  layoutBg: '#F4F6F7',
  subtleBg: '#F7F8FA',
  hairline: 'rgba(16, 24, 40, 0.08)',
  hairlineStrong: 'rgba(16, 24, 40, 0.14)',
  rowHover: 'rgba(16, 24, 40, 0.04)',
  radius: 8,
  radiusLg: 10,
  shadowPanel: '0 1px 2px rgba(16, 24, 40, 0.05)'
}

const DARK: AppTokenSet = {
  // 青色在深底上要提亮一档,否则发闷、对比不足
  primary: BRAND.cyanBright,
  topbarBg: BRAND.navyDeep,
  topbarText: 'rgba(255, 255, 255, 0.94)',
  topbarMuted: 'rgba(255, 255, 255, 0.5)',
  topbarControlBg: 'rgba(255, 255, 255, 0.08)',
  topbarControlBorder: 'rgba(255, 255, 255, 0.16)',
  topbarControlText: 'rgba(255, 255, 255, 0.86)',
  topbarSelectedBg: 'rgba(255, 255, 255, 0.18)',
  accentSoft: 'rgba(34, 184, 207, 0.16)',
  accentText: '#8FE6F2',
  layoutBg: '#0B0B0C',
  subtleBg: '#151517',
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairlineStrong: 'rgba(255, 255, 255, 0.16)',
  rowHover: 'rgba(255, 255, 255, 0.05)',
  radius: 8,
  radiusLg: 10,
  shadowPanel: '0 1px 2px rgba(0, 0, 0, 0.4)'
}

export function buildAppTokens(resolved: ResolvedTheme): AppTokenSet {
  return resolved === 'dark' ? DARK : LIGHT
}

/** 令牌 → CSS 变量。键统一加 --app- 前缀,供 theme.css 与自研样式消费。 */
export function toCssVariables(tokens: AppTokenSet): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tokens)) {
    // camelCase → kebab-case:radiusLg → --app-radius-lg
    const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    out[`--app-${name}`] = typeof value === 'number' ? `${value}px` : value
  }
  return out
}

/**
 * antd 主题配置。
 * 除了主色/圆角,这里最有观感收益的两项是:
 * - 去掉 Button 的默认投影(antd 默认给按钮加了 box-shadow,是「塑料感」的主要来源)
 * - 把 colorSplit 压到接近细线,让默认的 #d9d9d9 硬边框让位给发丝级分割
 */
export function buildAntdTheme(resolved: ResolvedTheme): ThemeConfig {
  const app = buildAppTokens(resolved)
  return {
    algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: app.primary,
      colorInfo: app.primary,
      colorLink: app.primary,
      colorLinkHover: resolved === 'dark' ? '#7FE3F0' : '#0B5F75',
      colorBgLayout: app.layoutBg,
      colorSplit: app.hairline,
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
      borderRadius: app.radius,
      borderRadiusLG: app.radiusLg,
      borderRadiusSM: 6,
      // antd 默认 600,对中文界面偏重;500 更干净
      fontWeightStrong: 500
    },
    components: {
      Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        fontWeight: 500
      },
      Segmented: {
        itemSelectedBg: app.topbarSelectedBg
      },
      Layout: {
        bodyBg: app.layoutBg
      }
    }
  }
}

/** xterm 配色,与上面的令牌保持一致 */
export function terminalPalette(resolved: ResolvedTheme): {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
} {
  if (resolved === 'dark') {
    return {
      background: '#121316',
      foreground: '#D7DBE0',
      cursor: BRAND.cyanBright,
      cursorAccent: '#121316',
      selectionBackground: 'rgba(34, 184, 207, 0.3)'
    }
  }
  return {
    background: '#FFFFFF',
    foreground: '#24292F',
    cursor: BRAND.cyan,
    cursorAccent: '#FFFFFF',
    selectionBackground: 'rgba(14, 116, 144, 0.22)'
  }
}
