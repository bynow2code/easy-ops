'use strict';

// 向所有渲染窗口广播 IPC 消息（单窗口应用下即当前窗口）。
// 事件名与渲染层约定一致。main.js 与 updater.js 共用，避免重复实现。
const { BrowserWindow } = require('electron');

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

module.exports = { broadcast };
