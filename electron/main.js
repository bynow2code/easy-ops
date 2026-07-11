const { app, BrowserWindow, ipcMain, shell, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

let mainWindow = null;
let backendProcess = null;

// 设置应用名称，确保系统通知显示 "EasyOps" 而非 "electron.app"
app.setName('EasyOps')

const isDev = !app.isPackaged;

// 资源路径辅助：开发时相对项目根，打包后使用 extraResources 目录
const resPath = (relativePath) => {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', relativePath);
  }
  return path.join(process.resourcesPath, relativePath);
};

// 检查是否为「已构建前端 + Electron 开发」模式（electron-dev）
const isBuiltMode = isDev && fs.existsSync(resPath('client/dist/index.html'));

// 日志函数 - 同时输出到控制台和文件
const log = (message) => {
  console.log(`[Main] ${message}`);
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'main.log');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
  } catch (e) {}
};

// 找到未占用的端口并启动后端服务
const startBackend = () => {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const findPort = (start, end) => {
      return new Promise((resolvePort) => {
        const tryPort = (port) => {
          if (port > end) {
            resolvePort(null);
            return;
          }
          const server = net.createServer();
          server.once('error', () => tryPort(port + 1));
          server.once('listening', () => {
            server.close(() => resolvePort(port));
          });
          server.listen(port);
        };
        tryPort(start);
      });
    };

    findPort(3001, 3100).then(port => {
      if (!port) {
        reject(new Error('No available port found in range 3001-3100'));
        return;
      }

      const serverDir = resPath('server');
      const env = {
        ...process.env,
        PORT: port.toString(),
        ELECTRON_MODE: '1',
        FRONTEND_DIST_DIR: resPath('client/dist'),
        SCRIPT_DATA_DIR: app.getPath('userData')
      };

      backendProcess = fork(path.join(serverDir, 'index.js'), [], {
        cwd: serverDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      });

      backendProcess.stdout.on('data', (data) => {
        process.stdout.write(data);
      });

      backendProcess.stderr.on('data', (data) => {
        process.stderr.write(data);
      });

      backendProcess.on('exit', (code) => {
        log(`Backend process exited with code ${code}`);
        backendProcess = null;
      });

      // 等待后端启动完成信号
      backendProcess.on('message', (msg) => {
        if (msg === 'ready') {
          resolve(port);
        }
      });

      // 超时回退：如果 5 秒内没收到 ready 消息，直接使用端口
      setTimeout(() => {
        resolve(port);
      }, 5000);
    }).catch(reject);
  });
};

const createWindow = (port) => {
  const iconPath = resPath('client/dist/logo.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: iconPath
  });

  const url = `http://localhost:${port}`;
  mainWindow.loadURL(url);
  log(`Window loaded with URL: ${url}`);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// ==================== 应用生命周期 ====================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  // 停止后端进程
  if (backendProcess) {
    try { backendProcess.kill(); } catch (e) {}
  }
});

// ==================== IPC 处理 ====================

ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    name: app.getName(),
    userData: app.getPath('userData'),
    isDev
  };
});

// ==================== 原生系统通知（队列） ====================
const notifIconPath = resPath('client/dist/logo.png');
const notifQueue = [];
let notifRunning = false;

const processNotifQueue = () => {
  if (notifRunning || notifQueue.length === 0) return;
  notifRunning = true;
  const { title, body, single } = notifQueue.shift();
  const n = new Notification({
    title,
    body,
    icon: fs.existsSync(notifIconPath) ? notifIconPath : undefined
  });
  n.show();
  // 单脚本显示 4 秒，批量每条显示 1.5 秒
  const duration = single ? 4000 : 2000;
  setTimeout(() => {
    try { n.close(); } catch (e) {}
    notifRunning = false;
    processNotifQueue();
  }, duration);
};

ipcMain.on('show-notification', (event, { title, body, single }) => {
  notifQueue.push({ title, body, single });
  processNotifQueue();
});

// ==================== 自动更新（electron-updater，读取 GitHub Releases） ====================
// 仅在打包后的生产环境启用：开发模式下不检查更新，避免无谓的网络请求与报错
const initAutoUpdater = () => {
  if (!app.isPackaged) {
    log('Auto updater disabled in dev mode');
    return;
  }

  const { autoUpdater } = require('electron-updater');

  // 发现新版本后自动下载（自动升级的第一步）
  autoUpdater.autoDownload = true;
  // 用户关闭应用时自动完成安装
  autoUpdater.autoInstallOnAppQuit = true;
  // 从 GitHub Releases 拉取更新（仓库为公开仓库，无需 token）
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'bynow2code',
    repo: 'easy-ops'
  });

  // 把更新事件统一转发给渲染进程
  const send = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-event', payload);
    }
  };

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    send({ type: 'available', version: info.version, releaseNotes: info.releaseNotes || '' })
  );
  autoUpdater.on('update-not-available', (info) =>
    send({ type: 'not-available', version: info.version })
  );
  autoUpdater.on('download-progress', (p) =>
    send({ type: 'downloading', percent: Math.round(p.percent || 0), transferred: p.transferred, total: p.total })
  );
  autoUpdater.on('update-downloaded', (info) =>
    send({ type: 'downloaded', version: info.version })
  );
  autoUpdater.on('error', (err) =>
    send({ type: 'error', message: err && err.message ? err.message : String(err) })
  );

  // 手动检查更新（前端「检查更新」按钮触发）
  ipcMain.handle('app:check-updates', async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      log(`checkForUpdates failed: ${e.message}`);
    }
  });

  // 下载完成后，由前端「重启并更新」按钮调用，退出并安装
  ipcMain.handle('app:start-update', () => {
    autoUpdater.quitAndInstall();
  });

  // 启动后静默检查一次（延迟 3 秒，避免拖慢首屏）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => log(`initial check failed: ${e.message}`));
  }, 3000);
};

// ==================== 启动应用 ====================

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null) // 隐藏默认菜单栏
  try {
    const port = await startBackend();
    createWindow(port);
    initAutoUpdater(); // 窗口建好后再启动更新检查
  } catch (err) {
    log(`Failed to start: ${err.message}`);
    app.quit();
  }
});
