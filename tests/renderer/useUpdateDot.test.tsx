import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

import { useUpdateDot } from '../../src/renderer/src/hooks/useUpdateDot'

type Listener = (event: unknown) => void

/** 捕获主进程推送的实时事件监听器,测试里手动派发 */
let liveListener: Listener | null = null
/** 手动控制 lastEvent 快照的 resolve 时机,用来验证「先订阅、后快照」的防覆盖关系 */
let resolveLastEvent: ((value: unknown) => void) | null = null

beforeEach(() => {
  liveListener = null
  resolveLastEvent = null
  ;(window as unknown as { api: unknown }).api = {
    update: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      lastEvent: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveLastEvent = resolve
          })
      ),
      onEvent: vi.fn((listener: Listener) => {
        liveListener = listener
        return () => undefined
      })
    }
  }
})

afterEach(() => {
  cleanup()
})

describe('useUpdateDot', () => {
  it('收到 available 实时事件点亮圆点', async () => {
    const { result } = renderHook(() => useUpdateDot())
    expect(result.current[0]).toBe(false)

    await waitFor(() => expect(liveListener).not.toBeNull())
    act(() => liveListener!({ status: 'available', version: '0.9.0' }))
    expect(result.current[0]).toBe(true)
  })

  it('downloaded(已下载待安装)同样点亮圆点', async () => {
    const { result } = renderHook(() => useUpdateDot())

    await waitFor(() => expect(liveListener).not.toBeNull())
    act(() => liveListener!({ status: 'downloaded', version: '0.9.0' }))
    expect(result.current[0]).toBe(true)
  })

  it('checking / downloading / not-available / error 不点亮圆点', async () => {
    const { result } = renderHook(() => useUpdateDot())

    await waitFor(() => expect(liveListener).not.toBeNull())
    act(() => liveListener!({ status: 'checking' }))
    act(() => liveListener!({ status: 'downloading', percent: 40 }))
    act(() => liveListener!({ status: 'not-available' }))
    act(() => liveListener!({ status: 'error', message: 'boom' }))
    expect(result.current[0]).toBe(false)
  })

  it('订阅前已缓存的 available 事件(lastEvent 快照)也能点亮', async () => {
    const { result } = renderHook(() => useUpdateDot())
    expect(result.current[0]).toBe(false)

    await act(async () => {
      resolveLastEvent!({ status: 'available', version: '0.9.0' })
    })
    expect(result.current[0]).toBe(true)
  })

  it('先收到过实时事件时,迟到的旧快照不覆盖结果(错误事件在前,快照 available 在后也不点亮)', async () => {
    const { result } = renderHook(() => useUpdateDot())

    await waitFor(() => expect(liveListener).not.toBeNull())
    act(() => liveListener!({ status: 'error', message: '网络错误' }))
    await act(async () => {
      resolveLastEvent!({ status: 'available', version: '0.9.0' })
    })
    expect(result.current[0]).toBe(false)
  })

  it('dismiss 熄灭圆点;之后新的 available 事件会再次点亮', async () => {
    const { result } = renderHook(() => useUpdateDot())

    await waitFor(() => expect(liveListener).not.toBeNull())
    act(() => liveListener!({ status: 'available', version: '0.9.0' }))
    expect(result.current[0]).toBe(true)

    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)

    act(() => liveListener!({ status: 'available', version: '1.0.0' }))
    expect(result.current[0]).toBe(true)
  })
})
