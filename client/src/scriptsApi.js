// 前端访问"后端"的脚本仓库 API 客户端。
// 连接策略与 shellApi 完全一致：
//  - Electron 内：后端端口由主进程从 port.txt 读出（api.backend.getPort），
//    走绝对 URL http://127.0.0.1:<port>/api，带重试等待后端就绪。
//  - 纯 Vite 开发（无 Electron）：相对路径 /api，由 vite.config 代理到后端。
// 错误模型与 shellApi 对齐：网络层失败抛 { isNetwork:true } 由调用方决定本地兜底；
// 后端显式拒绝（4xx/5xx）返回 { ok:false, error } 而不抛——调用方据此提示用户，
// 绝不该再偷偷退化到前端 localStorage 落盘（避免"后端拒绝被当离线"）。
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
    // 网络层失败：后端未启动 / 不可达。标记为 isNetwork，便于调用方决定本地兜底，
    // 而非把它当成"后端拒绝"。
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

export const scriptsApi = {
  // 列出全部脚本与分组：GET /api/scripts -> { ok, scripts, groups }
  list: () => request('/scripts', { method: 'GET' }),
  // 新增 / 更新一条脚本：POST /api/scripts -> { ok, script }
  save: (script) => request('/scripts', { method: 'POST', body: JSON.stringify(script) }),
  // 删除一条脚本：DELETE /api/scripts -> { ok, id }
  remove: (id) => request('/scripts', { method: 'DELETE', body: JSON.stringify({ id }) }),
  // 新增分组：POST /api/groups -> { ok, groups }
  addGroup: (name) => request('/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  // 移除分组：DELETE /api/groups -> { ok, scripts, groups, defaultGroup }
  //   deleteScripts=false（默认）：其下脚本挪到默认分组；true：连同脚本一并删除。
  //   默认分组不可删（后端返回 400）。
  removeGroup: (name, deleteScripts = false) =>
    request('/groups', {
      method: 'DELETE',
      body: JSON.stringify({ name, deleteScripts }),
    }),
  // 重命名分组：PATCH /api/groups -> { ok, groups, defaultGroup }
  renameGroup: (oldName, newName) =>
    request('/groups', {
      method: 'PATCH',
      body: JSON.stringify({ oldName, newName }),
    }),
  // 批量导入脚本（只需 name + content）：POST /api/scripts/import
  //   -> { ok, scripts, groups, defaultGroup }
  importScripts: (scripts) =>
    request('/scripts/import', {
      method: 'POST',
      body: JSON.stringify({ scripts }),
    }),
};
