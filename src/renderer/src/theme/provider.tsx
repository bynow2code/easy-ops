import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd'
import type { ThemeMode } from '../../../shared/types'
import { resolveTheme, useSystemPrefersDark } from './useResolvedTheme'
import { buildAntdTheme, buildAppTokens, toCssVariables, type ResolvedTheme } from './tokens'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}

/**
 * 把主题色注入为 CSS 变量供自研样式消费(设计 §11)。
 *
 * 分两类:
 * - 与 antd 对齐的四个(容器底/文字/次级边框/选中底)从 useToken() 读,保证与 antd 组件严格同源;
 * - 应用自有语义色(顶栏、主色软底、发丝线…)来自 tokens.ts,antd token 里没有对应概念。
 *
 * 必须渲染在 ConfigProvider 内部才能用 useToken() 读到当前主题的 token。
 * 注意 token 每次渲染都是新对象,依赖数组依赖具体的颜色字符串。
 */
function ThemeVariables({ resolved }: { resolved: ResolvedTheme }): null {
  const { token } = antdTheme.useToken()
  const bgBase = token.colorBgBase
  const bgContainer = token.colorBgContainer
  const text = token.colorText
  const borderSecondary = token.colorBorderSecondary
  const controlItemBgActive = token.controlItemBgActive

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--color-bg-base', bgBase)
    root.style.setProperty('--color-bg-container', bgContainer)
    root.style.setProperty('--color-text', text)
    root.style.setProperty('--color-border-secondary', borderSecondary)
    root.style.setProperty('--color-control-item-bg-active', controlItemBgActive)
  }, [bgBase, bgContainer, text, borderSecondary, controlItemBgActive])

  useEffect(() => {
    const root = document.documentElement
    for (const [name, value] of Object.entries(toCssVariables(buildAppTokens(resolved)))) {
      root.style.setProperty(name, value)
    }
  }, [resolved])

  return null
}

export function ThemeProvider({
  mode,
  onModeChange,
  children
}: {
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
  children: ReactNode
}): JSX.Element {
  const systemPrefersDark = useSystemPrefersDark()
  const resolved = resolveTheme(mode, systemPrefersDark)

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode: onModeChange }),
    [mode, resolved, onModeChange]
  )

  const themeConfig = useMemo(() => buildAntdTheme(resolved), [resolved])

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider theme={themeConfig}>
        <AntdApp>{children}</AntdApp>
        <ThemeVariables resolved={resolved} />
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
