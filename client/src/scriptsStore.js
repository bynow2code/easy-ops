// 前端态（无 Electron 后端 / 后端不可达）脚本仓库的本地持久化。
// 纯 Vite 开发模式下没有主进程来落盘 scripts.json，
// 因此把脚本与分组存到 localStorage，保证 UI 仍能在重启后恢复。
// 与 shellStore 同一套路；一旦后端可达，应优先用后端（scriptsApi）。
const KEY = 'easy-ops.frontend-scripts';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { scripts: [], groups: [] };
    const obj = JSON.parse(raw);
    return {
      scripts: Array.isArray(obj.scripts) ? obj.scripts : [],
      groups: Array.isArray(obj.groups) ? obj.groups : [],
    };
  } catch {
    return { scripts: [], groups: [] };
  }
}

function write(repo) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        scripts: Array.isArray(repo.scripts) ? repo.scripts : [],
        groups: Array.isArray(repo.groups) ? repo.groups : [],
      }),
    );
  } catch {
    // 忽略 localStorage 不可用 / 配额异常
  }
}

export function readFrontendScripts() {
  return read();
}

export function writeFrontendScripts(repo) {
  write(repo);
}
