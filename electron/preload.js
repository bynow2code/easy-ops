'use strict';

/**
 * Preload：唯一被 renderer 看见的桥；通过 contextBridge 暴露安全的 IPC 接口。
 * 避免直接把 ipcRenderer / require / process 漏到 window 上。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyOps', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
    checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    copyToClipboard: (text) => ipcRenderer.invoke('app:copyToClipboard', text),
  },
  shell: {
    list: () => ipcRenderer.invoke('shell:list'),
    choose: () => ipcRenderer.invoke('shell:choose'),
    add: (p) => ipcRenderer.invoke('shell:add', p),
    remove: (p) => ipcRenderer.invoke('shell:remove', p),
    setActive: (p) => ipcRenderer.invoke('shell:setActive', p),
    getNoShellMode: () => ipcRenderer.invoke('shell:getNoShellMode'),
    setNoShellMode: (v) => ipcRenderer.invoke('shell:setNoShellMode', v),
  },
  backend: {
    getPort: () => ipcRenderer.invoke('backend:getPort'),
  },
  pty: {
    open: (opts) => ipcRenderer.invoke('pty:open', opts),
    write: (sessionId, data) => ipcRenderer.invoke('pty:write', { sessionId, data }),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke('pty:resize', { sessionId, cols, rows }),
    kill: (execId) => ipcRenderer.invoke('pty:kill', { execId }),
    // 渲染层订阅来自主进程的流式输出 / 退出事件
    onData: (cb) => ipcRenderer.on('pty:data', (_e, p) => cb(p)),
    onExit: (cb) => ipcRenderer.on('pty:exit', (_e, p) => cb(p)),
  },
});