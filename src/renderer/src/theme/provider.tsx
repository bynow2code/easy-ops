import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme } from 'antd'
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
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
