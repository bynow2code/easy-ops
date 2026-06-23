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
  const duration = single ? 4000 : 1500;
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

// ==================== 启动应用 ====================

app.whenReady().then(async () => {
  try {
    const port = await startBackend();
    createWindow(port);
  } catch (err) {
    log(`Failed to start: ${err.message}`);
    app.quit();
  }
});
