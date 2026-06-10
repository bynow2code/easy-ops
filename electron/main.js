const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let backendServer = null;

const isDev = !app.isPackaged;

// 检查是否为「已构建前端 + Electron 开发」模式（electron-dev）
// 此时 client/dist 已构建好，应直接使用后端端口而非 Vite 开发服务器
const isBuiltMode = isDev && fs.existsSync(path.join(__dirname, '..', 'client', 'dist', 'index.html'));

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
    icon: path.join(__dirname, '..', 'client', 'public', 'logo.svg')
  });

  // Vite 开发模式（热更新），已构建模式/生产模式使用后端端口
  const useViteDev = isDev && !isBuiltMode;
  const url = useViteDev ? 'http://localhost:5173' : `http://localhost:${port}`;
  mainWindow.loadURL(url);

  // 开发模式：F12 呼出调试工具
  if (isDev) {
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

      // 告知后端前端静态资源目录
      if (!isDev) {
        // 生产模式：extraResources 中的路径
        process.env.FRONTEND_DIST_DIR = path.join(process.resourcesPath, 'client', 'dist');
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

        // 加载后端 Express 服务
        const backendPath = isDev
          ? path.join(__dirname, '..', 'server', 'index.js')
          : path.join(process.resourcesPath, 'server', 'index.js');

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
