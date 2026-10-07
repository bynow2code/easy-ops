export interface TerminalBox {
  width: number
  height: number
}

export interface TerminalGrid {
  cols: number
  rows: number
}

/** 终端容器尺寸是否「真的变了」——变化不足 1px 视为没变。
 *
 * FitAddon 会按容器尺寸重算行列并重建渲染层。浮层闪现、亚像素重排这类
 * 「同尺寸的重复 ResizeObserver 回调」不该引起终端重排：最大化终端 + 悬停浮层
 * 时，根滚动条闪现会让视口宽度反复变化，每次都全量 fit 就会表现为界面抖动。 */
export function isSignificantResize(prev: TerminalBox | null, next: TerminalBox): boolean {
  if (!prev) return true
  return Math.abs(prev.width - next.width) >= 1 || Math.abs(prev.height - next.height) >= 1
}

/** fit 之后行列是否变化——没变就别发 pty.resize。
 *
 * 主进程侧会把 resize 转成 SIGWINCH，终端里的程序（vim / top / 进度条之类）
 * 会因此白重绘一轮；尺寸没变时的重绘纯属浪费。 */
export function terminalSizeChanged(prev: TerminalGrid, next: TerminalGrid): boolean {
  return prev.cols !== next.cols || prev.rows !== next.rows
}
