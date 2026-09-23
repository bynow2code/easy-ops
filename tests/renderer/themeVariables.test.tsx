import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'

/**
 * --color-* 变量注入契约:源码里 var() 引用的变量必须真的被 ThemeVariables 注入,
 * 否则 color: var(--xxx) 会静默回退到继承色 —— 历史坑:--color-text-secondary
 * 曾被 App.tsx / SettingsModal / theme.css 引用却从未注入,次级文字一直没变灰。
 */
const referencedVars = [
  '--color-bg-base',
  '--color-bg-container',
  '--color-text',
  '--color-text-secondary',
  '--color-border-secondary',
  '--color-control-item-bg-active'
] as const

function injectedVars(): Record<string, string> {
  const style = document.documentElement.style
  const out: Record<string, string> = {}
  for (const name of referencedVars) out[name] = style.getPropertyValue(name)
  return out
}

describe('ThemeVariables 注入契约', () => {
  afterEach(() => {
    cleanup()
  })

  it('渲染层 var() 引用的 --color-* 变量在 light 下全部注入且非空', () => {
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <div />
      </ThemeProvider>
    )

    const vars = injectedVars()
    for (const [name, value] of Object.entries(vars)) {
      expect(value, `${name} 未注入,引用处会静默回退继承色`).not.toBe('')
    }
  })

  it('主/次文字色随主题切换取值不同(深色下沿用浅色值会看不清)', () => {
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <div />
      </ThemeProvider>
    )
    const light = injectedVars()
    cleanup()

    render(
      <ThemeProvider mode="dark" onModeChange={() => undefined}>
        <div />
      </ThemeProvider>
    )
    const dark = injectedVars()

    expect(dark['--color-text']).not.toBe(light['--color-text'])
    expect(dark['--color-text-secondary']).not.toBe(light['--color-text-secondary'])
    expect(dark['--color-bg-container']).not.toBe(light['--color-bg-container'])
  })
})
