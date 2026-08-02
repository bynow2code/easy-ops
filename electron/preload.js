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
    // 仅保留需要主进程原生能力的文件选择对话框；其余 shell 数据走 HTTP 后端
    choose: () => ipcRenderer.invoke('shell:choose'),
  },
  backend: {
    getPort: () => ipcRenderer.invoke('backend:getPort'),
  },
  updater: {
    // 若已下载更新，立即重启安装（由 Settings 的「Restart to update」触发）
    install: () => ipcRenderer.invoke('updater:install'),
  },
  pty: {
    open: (opts) => ipcRenderer.invoke('pty:open', opts),
    write: (sessionId, data) => ipcRenderer.invoke('pty:write', { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke('pty:resize', { sessionId, cols, rows }),
    kill: (execId) => ipcRenderer.invoke('pty:kill', { execId }),
    // 渲染层订阅来自主进程的流式输出 / 退出事件
    // 注意：必须返回「只移除本 handler」的取消函数，否则 cleanup 时
    // ipcRenderer.off() 无参会误删其他卡的监听器。
    onData: (cb) => {
      const handler = (_e, p) => cb(p);
      ipcRenderer.on('pty:data', handler);
      return () => ipcRenderer.removeListener('pty:data', handler);
    },
    onExit: (cb) => {
      const handler = (_e, p) => cb(p);
      ipcRenderer.on('pty:exit', handler);
      return () => ipcRenderer.removeListener('pty:exit', handler);
    },
  },
});
