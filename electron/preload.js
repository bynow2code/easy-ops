const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // 通过 IPC 调用主进程的原生通知
  showNotification: (title, body, icon) => {
    ipcRenderer.send('show-notification', { title, body, icon });
  }
});
