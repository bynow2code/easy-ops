import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
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

describe('Shell 重新检测', () => {
  // 两个用例共同覆盖的判定:重新检测完成后,「结果无变化」必须有一条可见的提示,
  // 否则(实测检测只要 ~96ms、列表连 DOM diff 都不会动)按钮点起来就像坏的
  function renderModal(): void {
    render(
      <ThemeProvider mode="light" onModeChange={() => undefined}>
        <App>
          <SettingsModal open onClose={() => undefined} />
        </App>
      </ThemeProvider>
    )
  }

  const zshEntry = { id: 'zsh', name: 'zsh', path: '/bin/zsh', args: ['-i'], source: 'detected' }

  it('检测结果与当前列表一致时补一条「未发现新的 shell」', async () => {
    const api = (window as unknown as { api: { shell: { detect: ReturnType<typeof vi.fn> } } }).api
    api.shell.detect.mockResolvedValue([zshEntry])

    renderModal()

    // 初始加载用的就是同一份 detect 结果,等列表出现再点
    await screen.findByText('zsh')
    fireEvent.click(screen.getByRole('button', { name: /重新检测/ }))

    expect(await screen.findByText('未发现新的 shell')).toBeTruthy()
  })

  it('检测到新 shell 时列表直接更新,不弹「未发现新的 shell」', async () => {
    const api = (window as unknown as { api: { shell: { detect: ReturnType<typeof vi.fn> } } }).api
    api.shell.detect.mockResolvedValueOnce([])

    renderModal()

    // 初始加载(空列表)完成
    await waitFor(() => expect(api.shell.detect).toHaveBeenCalledTimes(1))

    api.shell.detect.mockResolvedValue([zshEntry])
    fireEvent.click(screen.getByRole('button', { name: /重新检测/ }))

    expect(await screen.findByText('zsh')).toBeTruthy()
    expect(screen.queryByText('未发现新的 shell')).toBeNull()
  })

  it('检测失败时给错误提示,而不是无声失败', async () => {
    const api = (window as unknown as { api: { shell: { detect: ReturnType<typeof vi.fn> } } }).api
    api.shell.detect.mockRejectedValue(new Error('探测超时'))

    renderModal()

    fireEvent.click(screen.getByRole('button', { name: /重新检测/ }))

    // toUserMessage 会剥掉 Error: 前缀,用户看到的应是干净的中文原因;
    // 初始 loadAll 的失败与点击后的失败各弹一条,文案相同,断言「出现过」即可
    const errors = await screen.findAllByText('探测超时')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('未发现新的 shell')).toBeNull()
  })
})
