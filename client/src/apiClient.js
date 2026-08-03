// 共享的 HTTP 请求封装：scriptsApi 与 shellApi 复用同一份实现，避免重复。
// 连接策略：
//  - Electron 内：后端端口由主进程从 port.txt 读出（api.backend.getPort），
//    走绝对 URL http://127.0.0.1:<port>/api，带重试等待后端就绪。
//  - 纯 Vite 开发（无 Electron）：相对路径 /api，由 vite.config 代理到后端。
// 错误模型：
//  - 网络层失败（后端未启动/不可达）抛出 { isNetwork:true }，供调用方决定本地兜底，
//    而非当成"后端拒绝"。
//  - 后端显式拒绝（4xx/5xx）返回 { ok:false, error } 而不抛——调用方据此提示用户，
//    绝不该再偷偷退化到本地落盘（避免"后端拒绝被当离线"）。
import { resolveBaseUrl } from './backend.js';

export async function request(path, options = {}) {
  const base = await resolveBaseUrl();
  let res;
  try {
    res = await fetch(`${base}/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    // 网络层失败：标记为 isNetwork，便于调用方决定本地兜底，而不是当成"后端拒绝"。
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
