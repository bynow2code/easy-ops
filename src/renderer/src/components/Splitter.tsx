import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface SplitterProps {
  /** 'vertical' = 竖条、左右拖(改左右宽度);'horizontal' = 横条、上下拖(改上下高度) */
  orientation: 'vertical' | 'horizontal'
  /**
   * 拖动中回调,参数是 clientX(竖向)或 clientY(横向)。
   * 组件刻意不碰几何:换算成百分比是父容器的事,这样两条方向的分割条能共用一个组件。
   */
  onDrag: (clientPos: number) => void
  /** 键盘微调,负数为朝起点方向 */
  onNudge?: (deltaPercent: number) => void
  /** 双击复位到默认比例 */
  onReset?: () => void
  label?: string
}

/** 每次方向键调整的幅度(百分比) */
const NUDGE_STEP = 2

export function Splitter({
  orientation,
  onDrag,
  onNudge,
  onReset,
  label
}: SplitterProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const isVertical = orientation === 'vertical'

  // 回调每次渲染都是新函数;放进 ref,下面的窗口监听才不用反复解绑重绑
  const onDragRef = useRef(onDrag)
  useEffect(() => {
    onDragRef.current = onDrag
  }, [onDrag])

  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: MouseEvent): void => {
      onDragRef.current(isVertical ? e.clientX : e.clientY)
    }
    const handleUp = (): void => setDragging(false)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    // 拖出分割条范围时别选中文字,光标也别跳回默认箭头
    document.body.style.userSelect = 'none'
    document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize'

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [dragging, isVertical])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!onNudge) return
    const backward = isVertical ? 'ArrowLeft' : 'ArrowUp'
    const forward = isVertical ? 'ArrowRight' : 'ArrowDown'
    if (e.key === backward) {
      e.preventDefault()
      onNudge(-NUDGE_STEP)
    } else if (e.key === forward) {
      e.preventDefault()
      onNudge(NUDGE_STEP)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      className={`app-splitter app-splitter-${orientation}${dragging ? ' app-splitter-active' : ''}`}
      onMouseDown={(e) => {
        // 阻止默认行为,否则拖动会选中周围文字
        e.preventDefault()
        setDragging(true)
      }}
      onDoubleClick={() => onReset?.()}
      onKeyDown={handleKeyDown}
    />
  )
}
