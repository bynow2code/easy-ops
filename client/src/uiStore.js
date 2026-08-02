// 轻量 UI 偏好持久化（localStorage）。与 shellStore / scriptsStore 同思路：
// 作为跨运行时（Electron 主进程 / 纯网页 dev）都能存活的前端回退存储。
//
// 这里仅存"纯界面偏好"，不涉及脚本/ shell 等业务数据——业务数据仍以
// 后端 scripts.json / shell-config.json 为权威。界面偏好无需上后端，
// localStorage 即可在重开程序后保持用户上次调整的结果。

const SPLIT_KEY = 'easy-ops.split';
const SPLIT_MIN = 20;
const SPLIT_MAX = 80;

// 读取已持久化的左右分栏比例（%），无效/缺失时返回 null（调用方回退默认 50）。
export function readSplit() {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n < SPLIT_MIN || n > SPLIT_MAX) return null;
    return n;
  } catch {
    return null;
  }
}

// 写入分栏比例（%）。失败静默忽略（无痕模式 / 隐私设置禁用 localStorage 时）。
export function writeSplit(pct) {
  try {
    localStorage.setItem(SPLIT_KEY, String(pct));
  } catch {
    // 持久化不可用时忽略，不阻断交互
  }
}
