/**
 * jsdom 缺失/不完整的浏览器 API 补齐,供渲染层组件用例在渲染前调用。
 * 只补 antd 与本项目组件实际依赖到的部分,不追求完整的浏览器模拟。
 */
export function installJsdomShims(): void {
  if (typeof window === 'undefined') return

  const target = window as unknown as { matchMedia?: (query: string) => MediaQueryList }
  if (typeof target.matchMedia !== 'function') {
    // antd 的 Modal / Grid(useBreakpoint) 与主题 hook 都会直接调用 matchMedia
    target.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false
      }) as unknown as MediaQueryList
  }

  const original = window.getComputedStyle.bind(window)
  // jsdom 未实现带伪元素的 getComputedStyle,而 antd 量滚动条宽度时会传第二个参数并抛 Not implemented
  window.getComputedStyle = ((element: Element) => original(element)) as typeof window.getComputedStyle
}
