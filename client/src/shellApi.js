// 前端访问"后端"的 shell API 客户端。
// 连接策略（前后端真正打通的关键）：
//  - Electron 内：后端端口由主进程从 port.txt 读出（api.backend.getPort），
//    走绝对 URL http://127.0.0.1:<port>/api，并带重试等待后端就绪。
//  - 纯 Vite 开发（无 Electron）：相对路径 /api，由 vite.config 代理到后端，
//    因此同一份代码在两种环境都能连上后端。
// 任何请求失败都会抛出，由调用方决定是否退化到前端 localStorage 态。
import { resolveBaseUrl } from './backend.js';

async function request(path, options = {}) {
  const base = await resolveBaseUrl();
  let res;
  try {
    res = await fetch(`${base}/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    // 网络层失败：后端未启动 / 不可达（纯 Vite dev 没起 server 时）。
    // 标记为 isNetwork，便于调用方决定是否本地兜底，而不是把它当成"后端拒绝"。
    const e = new Error('Backend unreachable');
    e.isNetwork = true;
    throw e;
  }
  if (res.ok) {
    if (res.status === 204) return null;
    return res.json();
  }
  // 后端显式拒绝（4xx/5xx）：解析错误体返回，不抛——调用方据此提示用户，
  // 绝不该再偷偷本地添加。
  let err = null;
  try {
    err = await res.json();
  } catch {
    /* ignore */
  }
  return { ok: false, error: (err && err.error) || `HTTP ${res.status}` };
}

export const shellApi = {
  list: () => request('/shells', { method: 'GET' }),
  add: (path) => request('/shells', { method: 'POST', body: JSON.stringify({ path }) }),
  remove: (path) => request('/shells', { method: 'DELETE', body: JSON.stringify({ path }) }),
  setActive: (path) =>
    request('/shells/active', {
      method: 'POST',
      body: JSON.stringify({ path: path || null }),
    }),
  setNoShellMode: (value) =>
    request('/shells/no-shell-mode', {
      method: 'POST',
      body: JSON.stringify({ value: Boolean(value) }),
    }),
};

export default shellApi;
