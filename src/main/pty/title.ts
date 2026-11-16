/** 标题里的序号后缀:`名称 (3)` 的 `(3)`。名称本身可能含括号,所以只认末尾那一组纯数字 */
const SEQ_RE = /^(.*) \((\d+)\)$/

/**
 * 终端标题的序号分配。
 *
 * 语义:**序号单调递增、不复用空缺**。
 * 若改成「取最小可用槽位」,连开 4 个再关掉第 2 个,新开的那张会叫 `构建 (2)` ——
 * 卡片顺序是「最新的在最上」,于是序号会呈现 4 / 3 / 2 / 1 的错乱读数,
 * 用户看到的就是「标题后面的序号未连续」。取 max+1 则任何时刻序号列都只增不减,
 * 视觉上永远是连续递减的一段。
 *
 * 因此「基础名是否空闲」也要按序号判断:列表里只剩 `构建 (2)`/`(3)` 时,
 * 新卡片不能叫 `构建`,否则它会被当成「第一个」,与 (2)(3) 一起构成更奇怪的读数。
 */
export function nextTitle(baseName: string, existingTitles: string[]): string {
  // 同族 = 基础名本身 + `基础名 (n)`。用严格正则而非 startsWith,避免
  // `构建 (旧)` 这类人工/历史残留标题被误算进同族而抬高序号
  const family = new Set<number>([0])
  for (const title of existingTitles) {
    if (title === baseName) {
      family.add(1)
      continue
    }
    const m = SEQ_RE.exec(title)
    if (m && m[1] === baseName) family.add(Number(m[2]))
  }

  // 基础名可用 = 没有同名裸标题,也没有任何序号(否则新增会插到中间)
  if (family.size === 1) return baseName

  const next = Math.max(...family) + 1
  return `${baseName} (${next})`
}
