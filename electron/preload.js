const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // 通过 IPC 调用主进程的原生通知
  showNotification: (title, body, single) => {
    ipcRenderer.send('show-notification', { title, body, single });
  },

  // 手动检查更新（主进程调用 electron-updater.checkForUpdates）
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),

  // 下载完成后，退出并安装更新
  startUpdate: () => ipcRenderer.invoke('app:start-update'),

  // 订阅主进程转发的更新事件；返回一个取消订阅函数，便于在 React effect 中清理
  onUpdateEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update-event', listener);
    return () => ipcRenderer.removeListener('update-event', listener);
  }
});
