import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { Splitter } from '../../src/renderer/src/components/Splitter'

afterEach(() => {
  cleanup()
})

/** 分割条本身不带几何知识:它只把指针位置报给父组件,由父组件换算成比例 */
function renderSplitter(props: Partial<Parameters<typeof Splitter>[0]> = {}) {
  const onDrag = vi.fn()
  const onNudge = vi.fn()
  const onReset = vi.fn()
  const utils = render(
    <Splitter orientation="vertical" onDrag={onDrag} onNudge={onNudge} onReset={onReset} {...props} />
  )
  return { onDrag, onNudge, onReset, ...utils }
}

describe('分割条', () => {
  it('按下并移动时把指针位置报给父组件', () => {
    const { onDrag, container } = renderSplitter()
    const handle = container.querySelector('[role="separator"]') as HTMLElement

    fireEvent.mouseDown(handle)
    fireEvent.mouseMove(window, { clientX: 300 })

    expect(onDrag).toHaveBeenCalledWith(300)
  })

  it('松手后不再上报,避免离开分割条还在改布局', () => {
    const { onDrag, container } = renderSplitter()
    const handle = container.querySelector('[role="separator"]') as HTMLElement

    fireEvent.mouseDown(handle)
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window)
    fireEvent.mouseMove(window, { clientX: 500 })

    expect(onDrag).toHaveBeenCalledTimes(1)
  })

  it('横向分割条上报的是纵向位置', () => {
    const { onDrag, container } = renderSplitter({ orientation: 'horizontal' })
    const handle = container.querySelector('[role="separator"]') as HTMLElement

    fireEvent.mouseDown(handle)
    fireEvent.mouseMove(window, { clientX: 300, clientY: 420 })

    expect(onDrag).toHaveBeenCalledWith(420)
  })

  it('双击复位', () => {
    const { onReset, container } = renderSplitter()
    const handle = container.querySelector('[role="separator"]') as HTMLElement

    fireEvent.doubleClick(handle)

    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('方向键可以微调:竖向认左右,横向认上下', () => {
    const vertical = renderSplitter()
    const vHandle = vertical.container.querySelector('[role="separator"]') as HTMLElement
    fireEvent.keyDown(vHandle, { key: 'ArrowLeft' })
    fireEvent.keyDown(vHandle, { key: 'ArrowRight' })
    expect(vertical.onNudge).toHaveBeenNthCalledWith(1, -2)
    expect(vertical.onNudge).toHaveBeenNthCalledWith(2, 2)
    cleanup()

    const horizontal = renderSplitter({ orientation: 'horizontal' })
    const hHandle = horizontal.container.querySelector('[role="separator"]') as HTMLElement
    fireEvent.keyDown(hHandle, { key: 'ArrowUp' })
    fireEvent.keyDown(hHandle, { key: 'ArrowDown' })
    expect(horizontal.onNudge).toHaveBeenNthCalledWith(1, -2)
    expect(horizontal.onNudge).toHaveBeenNthCalledWith(2, 2)
  })

  it('带正确的无障碍语义:可聚焦的 separator,方向随朝向', () => {
    const { container } = renderSplitter()
    const handle = container.querySelector('[role="separator"]') as HTMLElement
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle.getAttribute('tabindex')).toBe('0')

    cleanup()
    const horizontal = renderSplitter({ orientation: 'horizontal' })
    expect(
      horizontal.container.querySelector('[role="separator"]')?.getAttribute('aria-orientation')
    ).toBe('horizontal')
  })

  it('拖动结束后清掉 body 上临时加的样式,不留副作用', () => {
    const { container } = renderSplitter()
    const handle = container.querySelector('[role="separator"]') as HTMLElement

    fireEvent.mouseDown(handle)
    expect(document.body.style.userSelect).toBe('none')
    expect(document.body.style.cursor).toBe('col-resize')

    fireEvent.mouseUp(window)
    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
  })
})
