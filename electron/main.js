'use strict';

/**
 * 主进程入口（骨架 / 集成示例）
 * 职责：创建窗口、注入 preload、初始化日志、启动内嵌后端与 PTY Host。
 * 本文件展示日志模块在"主进程侧"的接入方式；PTY Host 与窗口逻辑在后续步骤补全。
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createLogger, installProcessHandlers } = require('../shared/logger');
const config = require('../server/config');

// 初始化日志：生产模式写文件，目录由后端配置提供；开发模式打印终端
const logger = createLogger({
  isDev: !app.isPackaged, // 打包后 app.isPackaged=true → 走文件模式
  level: config.log.level,
  dir: config.log.dir,
  filename: config.log.filename,
});
installProcessHandlers(logger);

logger.info('主进程启动', { isPackaged: app.isPackaged, logDir: config.log.dir });

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发加载 Vite dev server；生产加载打包产物
  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  logger.info('所有窗口关闭，准备退出');
  logger.close();
  if (process.platform !== 'darwin') app.quit();
});
