const { app, BrowserWindow, ipcMain, shell, Menu, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

let mainWindow = null;
let backendProcess = null;
let backendPort = null;

// 致命错误统一处理：写日志 + 弹窗，避免「打开即静默闪退」看不到原因
const showFatal = (title, detail) => {
  log(`[FATAL] ${title}: ${detail}`);
  let logPathHint = '';
  try {
    logPathHint = `\n\n日志已保存，可在以下路径查看详情：\n${path.join(app.getPath('userData'), 'logs', 'main.log')}`;
  } catch (e) {
    logPathHint = '\n\n（无法定位日志目录，请检查应用数据目录下的 logs/main.log）';
  }
  try {
    dialog.showErrorBox(`EasyOps 启动失败 - ${title}`, `${detail}${logPathHint}`);
  } catch (e) {}
};

// 捕获主进程未处理的异常 / Promise 拒绝，转成可见弹窗（否则进程直接退出 = 闪退）
// 注意：更新相关的网络/下载错误（404、ECONNREFUSED 等）已在 update modal 中展示，
//       此处过滤掉，避免重复弹窗干扰用户
const isUpdateRelatedError = (reason) => {
  const msg = (reason && reason.message) || String(reason);
  return /Cannot download|update|release|status\s*\d{3}|net::|ECONNREFUSED|ETIMEDOUT/i.test(msg);
};
process.on('uncaughtException', (err) => {
  showFatal('未捕获异常', err && err.stack ? err.stack : String(err));
});
process.on('unhandledRejection', (reason) => {
  if (isUpdateRelatedError(reason)) {
    log(`[UPDATE-REJECTION] ${String(reason)}`);
    return;
  }
  showFatal('未处理的 Promise 拒绝', reason && reason.stack ? reason.stack : String(reason));
});

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
    let backendResolved = false;
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

      // 累积后端输出，便于后端崩溃时把真实错误暴露给用户（打包后 stderr 不可见）
      let backendStderr = '';
      let backendStdout = '';

      backendProcess.stdout.on('data', (data) => {
        process.stdout.write(data);
        backendStdout += data.toString();
        log(`[Backend] ${data.toString().trim()}`);
      });

      backendProcess.stderr.on('data', (data) => {
        process.stderr.write(data);
        backendStderr += data.toString();
        log(`[Backend-ERR] ${data.toString().trim()}`);
      });

      backendProcess.on('exit', (code) => {
        log(`Backend process exited with code ${code}`);
        // 后端非正常退出：把累积的错误输出抛给上层，直接弹窗显示，而不是加载一个死链接
        if (code !== 0 && !backendResolved) {
          const detail = (backendStderr || backendStdout || '(后端无任何输出，退出码 ' + code + ')').trim();
          reject(new Error(`后端进程退出码 ${code}。后端报错：\n${detail}`));
        }
        backendProcess = null;
      });

      // 等待后端启动完成信号
      backendProcess.on('message', (msg) => {
        if (msg === 'ready') {
          backendResolved = true;
          resolve(port);
        }
      });

      // 超时回退：如果 5 秒内没收到 ready 消息，直接使用端口
      setTimeout(() => {
        backendResolved = true;
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

  // 加载失败（如后端没起来、端口不通）时记录，便于排查白屏/闪退
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log(`[did-fail-load] code=${errorCode} desc=${errorDescription} url=${url}`);
    showFatal('页面加载失败', `无法加载 ${url}\n错误码: ${errorCode}\n${errorDescription}\n\n请确认后端服务是否正常启动（查看 main.log）。`);
  });

  // 渲染进程意外崩溃 / 假死时给出提示，而不是默默消失
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log(`[render-process-gone] reason=${details.reason}`);
    showFatal('渲染进程崩溃', `原因: ${details.reason}`);
  });

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
  // 不是静默退出，而是提示用户已有实例在运行，避免「双击一下就没了」
  try {
    dialog.showErrorBox('EasyOps 已在运行', '检测到另一个 EasyOps 实例正在运行，请先关闭后再启动。');
  } catch (e) {}
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

  // 防御性加载：若 electron-updater 未正确打包，仅记录日志并退出本函数，
  // 绝不让 require 抛错导致整个应用闪退
  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    log(`Auto updater unavailable: ${e.message}`);
    return;
  }

  // 发现新版本后【不】自动下载：先把版本与更新内容展示给用户，用户确认后再下载
  autoUpdater.autoDownload = false;
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

  // 防重入：避免同时多次下载或下载过程中重复检查更新
  let isDownloading = false;
  let isChecking = false;

  autoUpdater.on('checking-for-update', () => {
    isChecking = true;
    send({ type: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    isChecking = false;
    send({ type: 'available', version: info.version, releaseNotes: info.releaseNotes || '' });
  });
  autoUpdater.on('update-not-available', (info) => {
    isChecking = false;
    send({ type: 'not-available', version: info.version });
  });
  autoUpdater.on('download-progress', (p) => {
    // 下载进度：由于 GitHub Releases 可能经过 HTTP 重定向（→ S3），
    // total 可能在中途变化导致进度"倒退"，前端会自行处理，这里只透传原始数据
    send({ type: 'downloading', percent: Math.round(p.percent || 0), transferred: p.transferred, total: p.total });
  });
  autoUpdater.on('update-downloaded', (info) => {
    isDownloading = false;
    send({ type: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    isChecking = false;
    isDownloading = false;
    send({ type: 'error', message: err && err.message ? err.message : String(err) });
  });

  // 手动检查更新（前端「检查更新」按钮触发）
  ipcMain.handle('app:check-updates', async () => {
    if (isChecking) {
      log('[UPDATE] checkForUpdates ignored - already checking');
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      log(`checkForUpdates failed: ${e.message}`);
      isChecking = false;
    }
  });

  // 用户在弹窗里确认更新后，由前端调用，开始下载新版本
  ipcMain.handle('app:download-update', async () => {
    if (isDownloading) {
      log('[UPDATE] downloadUpdate ignored - already downloading');
      return;
    }
    isDownloading = true;
    log('[UPDATE] downloadUpdate started');
    try {
      await autoUpdater.downloadUpdate();
      log('[UPDATE] downloadUpdate completed');
    } catch (e) {
      log(`downloadUpdate failed: ${e.message}`);
      isDownloading = false;
      send({ type: 'error', message: e && e.message ? e.message : String(e) });
    }
  });

  // 下载完成后，由前端「重启并更新」按钮调用，退出并安装
  ipcMain.handle('app:start-update', () => {
    log('[UPDATE] quitAndInstall called');
    // 先关闭窗口，确保 IPC 响应能正常返回给渲染进程，
    // 然后用 setTimeout 延迟执行 quitAndInstall，避免 app.quit() 阻断 IPC 通道
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.close(); } catch (e) { log(`[UPDATE] close window failed: ${e.message}`); }
    }
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall();
      } catch (e) {
        log(`[UPDATE] quitAndInstall failed: ${e.message}`);
      }
    }, 200);
  });

  // 启动后静默检查一次（延迟 5 秒，避免与用户手动操作冲突）
  setTimeout(() => {
    if (isChecking || isDownloading) {
      log('[UPDATE] initial check skipped - update already in progress');
      return;
    }
    autoUpdater.checkForUpdates().catch((e) => log(`initial check failed: ${e.message}`));
  }, 5000);
};

// ==================== 启动应用 ====================

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null) // 隐藏默认菜单栏
  try {
    const port = await startBackend();
    backendPort = port;
    createWindow(port);
    initAutoUpdater(); // 窗口建好后再启动更新检查

    // macOS：关闭窗口默认不退出进程，点击程序坞图标时若无窗口则重建窗口。
    // 注册在 whenReady 内部、首窗口创建之后，避免启动时的初始 activate 再开一个窗口。
    // 加 darwin 守卫，确保 Windows 行为完全不受影响。
    app.on('activate', () => {
      if (process.platform !== 'darwin') return;
      if (BrowserWindow.getAllWindows().length === 0) {
        if (backendProcess && backendPort) {
          // 后端仍在运行，直接复用端口重建窗口
          createWindow(backendPort);
        } else {
          // 后端已退出，重新拉起后再建窗口
          startBackend()
            .then((p) => {
              backendPort = p;
              createWindow(p);
            })
            .catch((err) => {
              showFatal('启动失败', err && err.stack ? err.stack : err.message);
            });
        }
      }
    });
  } catch (err) {
    showFatal('启动失败', err && err.stack ? err.stack : err.message);
    setTimeout(() => app.quit(), 500); // 留时间让弹窗显示
  }
});