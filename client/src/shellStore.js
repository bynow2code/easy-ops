// 前端态（无 Electron 后端）自定义 shell 的本地持久化。
// 纯 Vite 开发模式下没有主进程来落盘 shell-config.json，
// 因此把用户手动添加的自定义 shell 存到 localStorage，
// 这样关闭 Settings 后、Add/Edit Script 的解释器下拉仍能读到。
const KEY = 'easy-ops.frontend-shells';

export function readFrontendShells() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function writeFrontendShells(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {
    // 忽略 localStorage 不可用 / 配额异常
  }
}

// 与上面同理：纯 Vite 开发（无 Electron 后端）时，No Shell Mode 开关也需本地落盘，
// 否则后端不可达时开关既存不住、App.reloadShells 也读不到 → 模式永远"未生效"。
const MODE_KEY = 'easy-ops.frontend-no-shell-mode';

export function readFrontendNoShellMode() {
  try {
    return localStorage.getItem(MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeFrontendNoShellMode(value) {
  try {
    if (value) localStorage.setItem(MODE_KEY, '1');
    else localStorage.removeItem(MODE_KEY);
  } catch {
    // 忽略 localStorage 不可用 / 配额异常
  }
}
