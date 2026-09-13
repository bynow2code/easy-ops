import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd'
import type { ThemeMode } from '../../../shared/types'
import { resolveTheme, useSystemPrefersDark } from './useResolvedTheme'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}

/**
 * 把 antd 当前算法算出的 token 暴露为 CSS 变量,供自研样式消费(设计 §11)。
 * 必须渲染在 ConfigProvider 内部才能用 useToken() 读到当前主题的 token。
 * 注意 token 每次渲染都是新对象,依赖数组依赖具体的颜色字符串。
 */
function ThemeVariables(): null {
  const { token } = antdTheme.useToken()
  const bgContainer = token.colorBgContainer
  const text = token.colorText
  const borderSecondary = token.colorBorderSecondary
  const controlItemBgActive = token.controlItemBgActive

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--color-bg-container', bgContainer)
    root.style.setProperty('--color-text', text)
    root.style.setProperty('--color-border-secondary', borderSecondary)
    root.style.setProperty('--color-control-item-bg-active', controlItemBgActive)
  }, [bgContainer, text, borderSecondary, controlItemBgActive])

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

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
        }}
      >
        <AntdApp>{children}</AntdApp>
        <ThemeVariables />
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
