// 分组拖拽排序的纯计算（便于单测，且前端 UI / 后端 / 前端回退复用同一语义）。
// ------------------------------------------------------------------
// 给定当前分组顺序 groups、被拖分组 dragName、投放目标分组 targetName，
// 返回新顺序：把 dragName 从原位置抽出、插入到 targetName 之前或之后。
//   position = 'before'（默认）：插入到 targetName 之前（= 放到目标"上面"）
//   position = 'after'           ：插入到 targetName 之后（= 放到目标"下面"）
// 允许任意分组（含默认分组）移动到任意位置；拖到自身则原样返回（no-op）；
// 目标不在列表（异常）也安全返回原顺序，不丢分组、不引入多余项。
// ESM 导出：本文件被 ScriptList.jsx 以 `import { computeGroupReorder }` 引入，
// 必须用 ES module export（不能用 CommonJS module.exports —— 浏览器原生 ESM 解析会
// 报"does not provide an export named 'computeGroupReorder'"，导致整棵应用白屏）。
export function computeGroupReorder(groups, dragName, targetName, position = 'before') {
  if (!Array.isArray(groups) || !dragName || dragName === targetName) return groups;
  const without = groups.filter((g) => g !== dragName);
  const targetIdx = without.indexOf(targetName);
  if (targetIdx < 0) return groups; // 目标不在列表 → 不做变更
  const insertAt = position === 'after' ? targetIdx + 1 : targetIdx;
  without.splice(insertAt, 0, dragName);
  return without;
}
