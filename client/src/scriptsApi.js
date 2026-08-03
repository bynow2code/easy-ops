// 前端访问"后端"的脚本仓库 API 客户端。
// 连接策略与错误模型见 ./apiClient.js（与 shellApi 共享同一份 request 封装）。
import { request } from './apiClient.js';

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
