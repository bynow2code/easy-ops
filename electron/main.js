const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

let mainWindow = null;
let backendProcess = null;

const isDev = !app.isPackaged;

// 检查是否为「已构建前端 + Electron 开发」模式（electron-dev）
// 此时 client/dist 已构建好，应直接使用后端端口而非 Vite 开发服务器
const isBuiltMode = isDev && fs.existsSync(path.join(__dirname, '..', 'client', 'dist', 'index.html'));

// 日志函数 - 同时输出到控制台和文件
const logFile = path.join(app.getPath('userData'), 'easyops-debug.log');
function log(msg, ...args) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] ${msg}`;
  if (args.length > 0) {
    line += ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  }
  console.log(msg, ...args);
  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch (e) {}
}

function createWindow(port) {
  // 隐藏菜单栏（开发和生产模式都隐藏）
  Menu.setApplicationMenu(null);

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
    icon: path.join(__dirname, '..', 'client', 'public', 'logo.png')
  });

  // Vite 开发模式（热更新），已构建模式/生产模式使用后端端口
  const useViteDev = isDev && !isBuiltMode;
  const url = useViteDev ? 'http://localhost:5173' : `http://localhost:${port}`;
  log('[Main] Loading URL:', url);
  mainWindow.loadURL(url);

  // 开发模式：F12 呼出调试工具，并自动打开开发者工具
  if (isDev) {
    mainWindow.webContents.openDevTools();
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 打开外链使用系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function startBackend() {
  return new Promise((resolve, reject) => {
    try {
      // 传递用户数据目录，让后端将 scripts.json 写到该目录下
      process.env.SCRIPT_DATA_DIR = app.getPath('userData');
      process.env.ELECTRON_MODE = '1';

      // 调试日志
      log('[Main] isDev:', isDev);
      log('[Main] app.isPackaged:', app.isPackaged);
      log('[Main] process.resourcesPath:', process.resourcesPath);
      log('[Main] __dirname:', __dirname);

      // 告知后端前端静态资源目录
      if (!isDev) {
        // 生产模式：extraResources 中的路径
        const frontendPath = path.join(process.resourcesPath, 'client', 'dist');
        log('[Main] FRONTEND_DIST_DIR:', frontendPath);
        log('[Main] FRONTEND_DIST_DIR exists:', fs.existsSync(frontendPath));
        process.env.FRONTEND_DIST_DIR = frontendPath;
      } else if (isBuiltMode) {
        // 已构建模式：本地 client/dist
        process.env.FRONTEND_DIST_DIR = path.join(__dirname, '..', 'client', 'dist');
      }

      // 动态端口查找
      const net = require('net');
      const findPort = (startPort) => new Promise((res) => {
        const server = net.createServer();
        server.once('error', () => {
          server.close();
          res(findPort(startPort + 1));
        });
        server.once('listening', () => {
          const port = server.address().port;
          server.close();
          res(port);
        });
        server.listen(startPort, '127.0.0.1');
      });

      findPort(3001).then((port) => {
        process.env.PORT = String(port);

        // 加载后端 Express 服务 - 使用 fork 而不是 require
        const backendPath = isDev
          ? path.join(__dirname, '..', 'server', 'index.js')
          : path.join(process.resourcesPath, 'server', 'index.js');

        log('[Main] backendPath:', backendPath);
        log('[Main] backendPath exists:', fs.existsSync(backendPath));

        // 使用 child_process.fork 启动后端进程
        const execArgv = [];
        backendProcess = fork(backendPath, [], {
          env: process.env,
          execArgv,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });

        backendProcess.stdout.on('data', (data) => {
          log('[Backend]', data.toString().trim());
        });

        backendProcess.stderr.on('data', (data) => {
          log('[Backend ERROR]', data.toString().trim());
        });

        backendProcess.on('error', (err) => {
          log('[Backend] Process error:', err.message);
        });

        backendProcess.on('exit', (code, signal) => {
          log('[Backend] Exited with code:', code, 'signal:', signal);
        });

        // 等待后端启动完成
        setTimeout(() => {
          resolve(port);
        }, 500);
      });
    } catch (err) {
      reject(err);
    }
  });
}

app.whenReady().then(async () => {
  // 自动授权通知权限（无需弹窗，让 Web Notification API 静默可用）
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(true)
    } else {
      callback(false)
    }
  })

  try {
    const port = await startBackend();
    createWindow(port);
  } catch (err) {
    console.error('Failed to start backend:', err);
    process.exit(1);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

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

ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    name: app.getName(),
    userData: app.getPath('userData'),
    isDev
  };
});
