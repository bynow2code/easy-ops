import { useEffect, useState } from 'react'

/**
 * 判断一条更新事件是否值得点亮设置按钮的小圆点:
 * - available:检测到新版本,用户还没决定下不下载
 * - downloaded:已下载待安装,还差「重启安装」一步
 * 其余状态(checking / downloading / not-available / error)都是过程或答复,不值得提醒。
 */
function isDotWorthy(raw: unknown): boolean {
  const status = (raw as { status?: string } | null)?.status
  return status === 'available' || status === 'downloaded'
}

/**
 * 设置按钮小圆点的状态源。
 * 「启动时检查更新」的结果目前只在设置弹窗里回放,用户不开设置就完全感知不到;
 * 这个 hook 把 available/downloaded 事件接出来,作为主界面上唯一的更新提醒。
 *
 * 订阅顺序与 UpdatePanel 相同(先订阅、后取快照):App 挂载远早于启动检查(3s 后),
 * 实时事件大概率能直接收到;快照兜底覆盖「事件早于订阅」的窗口,且只在没收到过
 * 实时事件时才应用,避免旧缓存覆盖新结果。
 *
 * 返回 [是否点亮, 熄灭动作]:熄灭是 UI 决策(打开设置即视为已知晓),不在这层自动做。
 */
export function useUpdateDot(): [boolean, () => void] {
  const [hasUpdate, setHasUpdate] = useState(false)

  useEffect(() => {
    let gotLiveEvent = false
    const off = window.api.update.onEvent((raw) => {
      gotLiveEvent = true
      if (isDotWorthy(raw)) setHasUpdate(true)
    })

    void window.api.update.lastEvent().then((raw) => {
      if (gotLiveEvent || raw == null) return
      if (isDotWorthy(raw)) setHasUpdate(true)
    })

    return off
  }, [])

  return [hasUpdate, () => setHasUpdate(false)]
}
