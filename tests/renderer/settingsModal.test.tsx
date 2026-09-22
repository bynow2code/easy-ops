import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installJsdomShims } from './jsdomShims'

import { SettingsModal } from '../../src/renderer/src/components/SettingsModal'
import { useAppStore } from '../../src/renderer/src/store/useAppStore'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'

beforeEach(() => {
  installJsdomShims()
  useAppStore.setState({ scripts: [], groups: [], selectedScriptId: null, form: { type: 'none' }, contentDrafts: {}, contentFocusRequest: null })
  ;(window as unknown as { api: unknown }).api = {
    app: { info: vi.fn(async () => ({ version: '0.8.0', repo: 'https://github.com/bynow2code/easy-ops', platform: 'darwin' })), openExternal: vi.fn(async () => undefined) },
    settings: { get: vi.fn(async () => ({ theme: 'light', shellId: null, customShells: [], checkUpdateOnLaunch: true, mainSplitRatio: 50, detailSplitRatio: 60 })), update: vi.fn(async () => ({ theme: 'light', shellId: null, customShells: [], checkUpdateOnLaunch: true, mainSplitRatio: 50, detailSplitRatio: 60 })) },
    shell: { detect: vi.fn(async () => []), browse: vi.fn(async () => null), validate: vi.fn(async () => ({ valid: true })) },
    config: { export: vi.fn(async () => ({ canceled: true })), import: vi.fn(async () => ({ canceled: true })) },
    update: { onEvent: vi.fn(() => () => undefined), lastEvent: vi.fn(async () => null), check: vi.fn(async () => undefined), download: vi.fn(async () => undefined), install: vi.fn() }
  }
})

afterEach(() => {
  cleanup()
})

describe('设置弹窗', () => {
  it('内容区限高且可纵向滚动,内容再多也不会超出窗口高度', () => {
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <SettingsModal open onClose={() => undefined} />
      </ThemeProvider>
    )

    const body = document.querySelector('.ant-modal-body') as HTMLElement | null
    expect(body).not.toBeNull()
    expect(body!.style.maxHeight).not.toBe('')
    expect(body!.style.overflowY).toBe('auto')
  })

  it('自定义 shell:浏览选择后直接添加并校验,没有单独的添加按钮', async () => {
    const api = (
      window as unknown as {
        api: {
          shell: { browse: ReturnType<typeof vi.fn>; validate: ReturnType<typeof vi.fn> }
          settings: { update: ReturnType<typeof vi.fn> }
        }
      }
    ).api
    api.shell.browse.mockResolvedValue('/opt/homebrew/bin/zsh')
    api.shell.validate.mockResolvedValue({ valid: true })

    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <SettingsModal open onClose={() => undefined} />
      </ThemeProvider>
    )

    // 「添加」按钮已移除,浏览是唯一入口
    expect(screen.queryByRole('button', { name: '添加' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /浏览/ }))

    await waitFor(() => expect(api.shell.validate).toHaveBeenCalledWith('/opt/homebrew/bin/zsh'))
    await waitFor(() =>
      expect(api.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          customShells: [expect.objectContaining({ path: '/opt/homebrew/bin/zsh' })]
        })
      )
    )
  })
})
