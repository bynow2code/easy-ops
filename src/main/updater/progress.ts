/**
 * mac 自研下载链路的进度换算。
 *
 * 与 win/linux 不同:那条链路用 electron-updater,`download-progress` 事件由它内建
 * (含 content-length 解析与节流);mac 侧是裸 fetch + pipeline,进度得自己从字节流里算。
 * 抽成纯函数便于单测 —— 进度是最容易「看起来在动其实没动」的地方,必须有测试兜住。
 */

/** 解析 content-length 响应头;缺失或非法(如 chunked、0、负数)时返回 null */
export function parseContentLength(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 把「已下载字节 / 总字节」换算成 0-100 的整数百分比。
 *
 * 总长度未知时返回 null:宁可不显示进度,也不虚报一个永远不收敛的数字。
 * 超过总长度时夹紧在 100 —— 重定向后若长度口径不一致(如压缩传输),也不能越界。
 */
export function toDownloadPercent(received: number, total: number | null): number | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null
  if (!Number.isFinite(received) || received <= 0) return 0
  return Math.min(100, Math.floor((received / total) * 100))
}

/**
 * 造一个带节流的进度上报器:百分比没变化就不上报。
 *
 * 慢速下载会切出成千上万个 chunk,逐个过一次 IPC 是纯浪费;按百分比去重后,
 * 单次下载最多只有 101 次上报。上报器自己记住上次的值,调用方只管喂字节数。
 */
export function createPercentReporter(
  emit: (percent: number) => void
): (received: number, total: number | null) => void {
  let last = -1
  return (received, total) => {
    const percent = toDownloadPercent(received, total)
    if (percent === null || percent === last) return
    last = percent
    emit(percent)
  }
}
