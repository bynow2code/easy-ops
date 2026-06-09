const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let backendServer = null;

const isDev = !app.isPackaged;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '..', 'frontend', 'public', 'vite.svg')
  });

  const url = `http://localhost:${port}`;

  if (isDev) {
    mainWindow.loadURL(url);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(url);
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

      // 生产模式下，告知后端前端静态资源目录（在 extraResources 中）
      if (!isDev) {
        process.env.FRONTEND_DIST_DIR = path.join(process.resourcesPath, 'frontend', 'dist');
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

        // 加载后端 Express 服务
        const backendPath = isDev
          ? path.join(__dirname, '..', 'backend', 'server.js')
          : path.join(process.resourcesPath, 'backend', 'server.js');

        // require 后会启动 server.js 中的 startServer()
        delete require.cache[require.resolve(backendPath)];
        const backend = require(backendPath);

        // 等一下确保服务启动完成
        setTimeout(() => {
          backendServer = backend;
          resolve(port);
        }, 200);
      });
    } catch (err) {
      reject(err);
    }
  });
}

app.whenReady().then(async () => {
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
  // 停止后端
  if (backendServer && typeof backendServer.close === 'function') {
    try { backendServer.close(); } catch (e) {}
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
