import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * 页签条的横向滚动态:
 * - 滚轮默认是纵向的,这里把滚动增量接管成横向 scrollLeft(滚动条已隐藏,滚轮是唯一滚动方式)
 * - canScrollLeft / canScrollRight 驱动两端渐隐,提示对应方向还有页签
 *
 * contentKey(如页签数量)变化时校正一次渐隐状态;分割线拖动改变容器宽度由
 * ResizeObserver 兜住 —— 它是所有尺寸来源(拖分割线/窗口缩放)的统一入口。
 */
export function useTabStripScroll(contentKey: unknown): {
  stripRef: RefObject<HTMLDivElement>
  canScrollLeft: boolean
  canScrollRight: boolean
} {
  const stripRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const update = useCallback((): void => {
    const el = stripRef.current
    if (!el) return
    // 1px 容差:取整误差不该让渐隐常亮
    const max = el.scrollWidth - el.clientWidth
    setCanScrollLeft(el.scrollLeft > 1)
    setCanScrollRight(el.scrollLeft < max - 1)
  }, [])

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [update, contentKey])

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      // 没有横向可滚内容时不接管,滚轮行为保持原生
      if (el.scrollWidth <= el.clientWidth) return
      // 普通滚轮给 deltaY,Shift+滚轮原生就是 deltaX —— 谁是主导轴用谁
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (delta === 0) return
      // React 的 onWheel 是 passive 的,preventDefault 无效,必须原生监听
      e.preventDefault()
      const max = el.scrollWidth - el.clientWidth
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + delta))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // 依赖 contentKey:App 启动时通常还没有页签,页签条元素不存在(stripRef 为 null),
    // 挂载时跑一遍只会空手而归 —— 必须在页签数 0→N(条首次出现)时重跑才能挂上监听
  }, [contentKey])

  return { stripRef, canScrollLeft, canScrollRight }
}
