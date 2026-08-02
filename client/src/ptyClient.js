// 渲染层与 PTY Host 之间的薄封装：把 preload 暴露的 pty IPC 收口成统一接口，
// 并对外暴露 available 标记，使非 Electron 环境（浏览器 dev / 单测）能优雅回退。
const api = typeof window !== 'undefined' ? window.easyOps : null;

export const ptyClient = {
  // 仅当运行在 Electron 内、且 preload 暴露了 pty 接口时才为 true
  available: !!(api && api.pty && api.pty.open),

  open(opts) {
    return api.pty.open(opts);
  },
  write(sessionId, data) {
    return api.pty.write(sessionId, data);
  },
  resize(sessionId, cols, rows) {
    return api.pty.resize(sessionId, cols, rows);
  },
  kill(execId) {
    return api.pty.kill(execId);
  },
  onData(cb) {
    return api.pty.onData(cb);
  },
  onExit(cb) {
    return api.pty.onExit(cb);
  },
};
