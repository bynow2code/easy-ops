import { useEffect, useState } from 'react'
import type { ThemeMode } from '../../../shared/types'

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): 'light' | 'dark' {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return systemPrefersDark ? 'dark' : 'light'
}

const QUERY = '(prefers-color-scheme: dark)'

export function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState<boolean>(() =>
    typeof window === 'undefined' || !window.matchMedia ? false : window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(QUERY)
    const onChange = (event: MediaQueryListEvent): void => setPrefersDark(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return prefersDark
}
