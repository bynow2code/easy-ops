import type { ThemeConfig } from 'antd'
import { theme as antdTheme } from 'antd'

export type ResolvedTheme = 'light' | 'dark'

/**
 * 强调色 = Apple 系统蓝(浅色 #007AFF / 深色 #0A84FF),与 macOS 系统设置的开关、
 * 单选、链接同源;海军蓝只保留给品牌标识(应用图标 / 顶栏 BrandMark 的 mark
 * 图标资产,豁免于界面强调色体系),不参与界面强调。
 * 语义状态色(终端运行绿 #34C759)单独使用,不参与强调体系。
 */
export const BRAND = {
  navy: '#0E2439',
  navyDeep: '#0A1A2B',
  blue: '#007AFF',
  blueBright: '#0A84FF'
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
  /** 选中行/激活页签的中性灰胶囊底色(参考 API 工具的树形列表选中态) */
  rowSelectedBg: string
  radius: number
  radiusLg: number
  shadowPanel: string
}

const LIGHT: AppTokenSet = {
  primary: BRAND.blue,
  // 方案 B:顶栏与画布同材质(macOS 统一浅色工具栏),靠底部发丝线分层
  topbarBg: '#F5F5F7',
  topbarText: 'rgba(0, 0, 0, 0.85)',
  topbarMuted: 'rgba(0, 0, 0, 0.45)',
  topbarControlBg: 'rgba(0, 0, 0, 0.05)',
  topbarControlBorder: 'rgba(0, 0, 0, 0.07)',
  topbarControlText: 'rgba(0, 0, 0, 0.72)',
  topbarSelectedBg: 'rgba(0, 0, 0, 0.08)',
  accentSoft: '#EAF3FF',
  accentText: '#0A5DC2',
  layoutBg: '#F5F5F7',
  subtleBg: '#FAFAFC',
  hairline: 'rgba(0, 0, 0, 0.06)',
  hairlineStrong: 'rgba(0, 0, 0, 0.10)',
  // 行底两档关系保持(悬停永远比选中浅一档),整体比 Postman 标定轻一档,更接近苹果的克制
  rowHover: 'rgba(0, 0, 0, 0.045)',
  rowSelectedBg: 'rgba(0, 0, 0, 0.07)',
  radius: 10,
  radiusLg: 14,
  shadowPanel: '0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.05)'
}

const DARK: AppTokenSet = {
  // 深色强调色提亮一档(Apple 深色系统蓝),否则发闷、对比不足
  primary: BRAND.blueBright,
  // 方案 B 深色:中性深灰工具栏(不再用海军蓝,品牌色退到点缀)
  topbarBg: '#1C1C1E',
  topbarText: 'rgba(255, 255, 255, 0.92)',
  topbarMuted: 'rgba(255, 255, 255, 0.5)',
  topbarControlBg: 'rgba(255, 255, 255, 0.08)',
  topbarControlBorder: 'rgba(255, 255, 255, 0.14)',
  topbarControlText: 'rgba(255, 255, 255, 0.85)',
  topbarSelectedBg: 'rgba(255, 255, 255, 0.14)',
  accentSoft: 'rgba(10, 132, 255, 0.18)',
  accentText: '#6EB8FF',
  layoutBg: '#101012',
  subtleBg: '#232326',
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairlineStrong: 'rgba(255, 255, 255, 0.14)',
  // 与浅色同一套两档关系;选中档 0.10 对齐深色实测
  rowHover: 'rgba(255, 255, 255, 0.06)',
  rowSelectedBg: 'rgba(255, 255, 255, 0.10)',
  radius: 10,
  radiusLg: 14,
  shadowPanel: '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.45)'
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
      colorLinkHover: resolved === 'dark' ? '#4CA5FF' : '#0066D6',
      colorBgLayout: app.layoutBg,
      // 深色卡片对齐 Apple systemGray6(#1C1C1E),弹层用上一档 #232326,
      // 比深色算法默认的纯灰更接近 macOS 材质
      ...(resolved === 'dark' ? { colorBgContainer: '#1C1C1E', colorBgElevated: '#232326' } : {}),
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
      // 苹果语义:开关「打开」是绿色(iOS/macOS 系统设置同款),不跟随蓝色强调色;
      // hover 不加深 —— antd 默认会给 colorPrimaryHover 一档变化,绿色上会发脏
      Switch: {
        colorPrimary: '#34C759',
        colorPrimaryHover: '#34C759'
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
      cursor: BRAND.blueBright,
      cursorAccent: '#121316',
      selectionBackground: 'rgba(10, 132, 255, 0.35)'
    }
  }
  return {
    background: '#FFFFFF',
    foreground: '#24292F',
    cursor: BRAND.blue,
    cursorAccent: '#FFFFFF',
    selectionBackground: 'rgba(0, 122, 255, 0.22)'
  }
}
