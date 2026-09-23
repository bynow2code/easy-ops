/**
 * Shift+点击的范围选择:取扁平视觉顺序里 anchor 与 target 之间(含两端)的 id 列表。
 * anchor 为 null / 等于 target / 不在列表里(已删或脏数据)时,回退为只含 target
 * (等价普通单击)。范围跨目录允许 —— 调用方保证 flatOrder 只含可选中的脚本行,
 * 目录行不进来(规格:目录不参与多选,见 docs/superpowers/specs/2026-09-23-script-multiselect-delete-design.md)。
 *
 * 注意:本函数的 indexOf === -1 兜底**无法区分**「数据脏(脚本已删)」与
 * 「视觉不可见(所在目录被折叠)」两种情形,而这两种情形在调用点需要的处理并不相同 ——
 * 后者应视为「无锚点」以重新立锚,否则选区会被写成空集。故调用方需先过
 * resolveShiftAnchor 判锚点有效性(审查 I-A)。
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

/**
 * 判定 Shift 范围选择实际可用的锚点。
 * 锚点落在被折叠的目录里时,它不在 flatOrder(可见前序)中 —— 此时必须当作
 * 「无锚点」处理(等价普通单击 + 重新立锚)。若直接把失效锚点喂给 rangeBetween:
 * ① 选区被写成 [target] 但 anchorId 不重设(调用方的 `if (anchor === null)` 不触发),
 * ② 锚点持续指向一个屏幕上不存在的行,后续任何 Shift 都退化,且此时
 *    selectionClearedRef 已被清成 false,用户接着右键旧选区行仍会弹出
 *    「删除 N 个脚本」—— 对不可逆的批量删除是不可接受的(审查 I-A)。
 *
 * 抽成纯函数是为了把这条规则从 handleScriptClick 的 44 行分支里拎出来单测。
 *
 * @param flatOrder 可见脚本行的前序 id 列表
 * @param anchorId  候选锚点(可能已因折叠/删除而失效)
 * @param cleared   用户是否刚主动清空过选区(Esc/搜索);清空后锚点一律作废
 */
export function resolveShiftAnchor(
  flatOrder: readonly string[],
  anchorId: string | null,
  cleared: boolean
): string | null {
  if (cleared || anchorId === null) return null
  return flatOrder.includes(anchorId) ? anchorId : null
}

export interface BatchDeletePlan {
  /** 仍然存在于当前列表里的目标(执行期快照,非渲染期快照) */
  targets: Array<{ id: string; name: string }>
  /** 确认框正文:只报总数 + 不可撤销警示,不列脚本名 */
  content: string
}

/**
 * 构造批量删除方案:把「请求删除的 id」与「执行时刻的实际列表」求交。
 * 抽成纯函数是为了能直接单测空目标/部分失效/超长选区等分支
 * (组件里这些分支靠 UI 构造不出来,见计划任务 4 的说明)。
 * 返回 null 表示没有任何有效目标,调用方应提示而非弹确认框。
 *
 * 文案(2026-09-23 用户定稿):只报数量,不列名字。
 * 早期版本会逐个列出脚本名(前 5 个 + 「等 N 个脚本」),但用户反馈
 * 「名字对决策没帮助」—— 多选后用户已经知道自己选了什么,再列一遍是冗余,
 * 且长脚本名堆在一起会让确认框显得臃肿。现在与单条删除的句式对齐:
 * 「确定删除 x 个脚本?此操作不可撤销。」
 */
export function buildBatchDeletePlan(
  scripts: ReadonlyArray<{ id: string; name: string }>,
  requestedIds: readonly string[]
): BatchDeletePlan | null {
  const requested = new Set(requestedIds)
  const targets = scripts.filter((s) => requested.has(s.id)).map((s) => ({ id: s.id, name: s.name }))
  if (targets.length === 0) return null
  return { targets, content: `确定删除 ${targets.length} 个脚本?此操作不可撤销。` }
}
