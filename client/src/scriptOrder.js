// 脚本排序的纯计算（便于单测；前端 UI 与 App.handleMoveScript 复用同一语义）。
// ------------------------------------------------------------------
// 场景：拖拽脚本落到某行"下面"（after）时，需要知道"插到哪条脚本之前"。
// App.handleMoveScript(id, group, beforeId) 的语义是"插入到 beforeId 之前"，
// 因此 after 模式不直接传 beforeId，而是先求出"目标之后、同组"的锚点脚本 id，
// 再把被拖脚本插到该锚点之前 —— 等价于"放在目标之后"。
//
// computeAfterAnchor(scripts, targetId, excludeId)：
//   返回 targetId 之后、同组、且不等于 excludeId（被拖脚本自身）的第一条脚本 id；
//   若目标已是组内最后一条（或组内其后无其他脚本）则返回 null，
//   上层据此把脚本追加到该组末尾。
// 任意非法入参（非数组 / 目标不存在）安全返回 null。
export function computeAfterAnchor(scripts, targetId, excludeId = null) {
  if (!Array.isArray(scripts) || !targetId) return null;
  const idx = scripts.findIndex((s) => s.id === targetId);
  if (idx < 0) return null;
  const target = scripts[idx];
  for (let i = idx + 1; i < scripts.length; i++) {
    const s = scripts[i];
    if (s.group === target.group && s.id !== excludeId) return s.id;
  }
  return null;
}
