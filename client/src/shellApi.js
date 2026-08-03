// 前端访问"后端"的 shell API 客户端。
// 连接策略（前后端真正打通的关键）与错误模型见 ./apiClient.js（与 scriptsApi 共享同一份 request 封装）：
//  - Electron 内：后端端口由主进程从 port.txt 读出，走绝对 URL http://127.0.0.1:<port>/api，并带重试等待后端就绪。
//  - 纯 Vite 开发（无 Electron）：相对路径 /api，由 vite.config 代理到后端。
import { request } from './apiClient.js';

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
