/**
 * Shift+点击的范围选择:取扁平视觉顺序里 anchor 与 target 之间(含两端)的 id 列表。
 * anchor 为 null / 等于 target / 不在列表里(已删或脏数据)时,回退为只含 target
 * (等价普通单击)。范围跨目录允许 —— 调用方保证 flatOrder 只含可选中的脚本行,
 * 目录行不进来(规格:目录不参与多选,见 docs/superpowers/specs/2026-09-23-script-multiselect-delete-design.md)。
 */
export function rangeBetween(
  flatOrder: readonly string[],
  anchorId: string | null,
  targetId: string
): string[] {
  if (anchorId === null || anchorId === targetId) return [targetId]
  const a = flatOrder.indexOf(anchorId)
  const t = flatOrder.indexOf(targetId)
  if (a === -1 || t === -1) return [targetId]
  const [lo, hi] = a < t ? [a, t] : [t, a]
  return flatOrder.slice(lo, hi + 1)
}
