const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // 打开原生文件选择对话框，让用户挑一个 bash 可执行文件。
  // 返回 { canceled:true } 或 { canceled:false, path:'绝对路径' }。
  // 渲染进程据此把路径填入「添加自定义 bash 路径」输入框，再走后端校验流程。
  openExecutableDialog: () => ipcRenderer.invoke('dialog:open-executable'),

  // 通过 IPC 调用主进程的原生通知
  showNotification: (title, body, single) => {
    ipcRenderer.send('show-notification', { title, body, single });
  },

  // 手动检查更新（主进程调用 electron-updater.checkForUpdates）
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),

  // 用户确认更新后，开始下载新版本
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),

  // 下载完成后，退出并安装更新
  startUpdate: () => ipcRenderer.invoke('app:start-update'),

  // 订阅主进程转发的更新事件；返回一个取消订阅函数，便于在 React effect 中清理
  onUpdateEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update-event', listener);
    return () => ipcRenderer.removeListener('update-event', listener);
  }
});
