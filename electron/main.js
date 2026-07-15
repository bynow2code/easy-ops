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
//       此处过滤掉，避免重复弹窗干扰用户。
// 关键约束：正则只能匹配「更新器特有的、具体」的错误特征，绝不能匹配 update / release
// 这类泛词——否则 "failed to update cache"、"release the port" 等普通崩溃也会被误吞，
// 真实闪退被静默掩盖，用户只看到程序莫名退出，反而更难排查。
const isUpdateRelatedError = (reason) => {
  const msg = (reason && reason.message) || String(reason);
  // 仅保留更新器专属签名：electron-updater 的 ERR_UPDATER 前缀、net:: 网络错误、
  // "Cannot download" / "Update check failed" 这类更新器固定措辞、以及网络层错误码。
  return /Cannot download|net::|ERR_UPDATER|Update check failed|electron-updater|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|status\s*\d{3}/i.test(msg);
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

// 日志函数 - 同时输出到控制台和文件
// 使用 function 声明（而非 const 箭头函数）以获得提升（hoisting），
// 确保 uncaughtException 回调在任何阶段触发时都能安全调用 log，
// 避免 TDZ（Temporal Dead Zone）导致「Cannot access 'log' before initialization」崩溃
function log(message) {
  console.log(`[Main] ${message}`);
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'main.log');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
  } catch (e) {}
}

// 启动后端服务，并拿回它实际监听的端口。
// 关键修复（解决「同时开两个 Electron 应用 → 界面串台」）：
//   不再从固定区间 3001-3100 探测端口。两个应用同时起时，会各自探测到同一个「空闲」端口、
//   又各自 fork 后端去抢，失败方回退到错误端口 → 渲染进程加载到另一个应用的界面。
//   改法：让操作系统分配一个【唯一】的空闲端口（PORT='0'），后端 listen 后把真实端口回传，
//   主进程严格使用该端口，从根本上杜绝与任何其它应用争抢端口。
const startBackend = () => {
  return new Promise((resolve, reject) => {
    let backendResolved = false;
    const serverDir = resPath('server');
    const env = {
      ...process.env,
      PORT: '0',                       // 0 = 由操作系统分配空闲端口，保证全局唯一、绝不与其它应用冲突
      ELECTRON_MODE: '1',
      FRONTEND_DIST_DIR: resPath('client/dist'),
      SCRIPT_DATA_DIR: app.getPath('userData')
    };

    // 后端入口：优先用 esbuild 打包后的单文件 server/dist/index.cjs（已把 express/cors 全部内联，
    // 运行时零 node_modules 依赖）。这样打包后 resources/server 下不再有 node_modules，
    // 彻底规避 electron-builder 把后端依赖误裁掉导致「Cannot find module 'express'」崩溃。
    // 开发环境下若未先跑 build:server，则回退到源码 server/index.js（开发时根 node_modules 可用）。
    const serverEntry = fs.existsSync(path.join(serverDir, 'index.cjs'))
      ? path.join(serverDir, 'index.cjs')
      : path.join(serverDir, 'index.js');
    backendProcess = fork(serverEntry, [], {
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

    // 等待后端启动完成信号（后端 listen 成功后回传 { type:'ready', port }）
    // 这里的 port 是操作系统实际分配的端口，严格用作渲染进程加载地址，绝不猜测。
    backendProcess.on('message', (msg) => {
      if (msg && msg.type === 'ready') {
        backendResolved = true;
        resolve(msg.port);
      }
    });

    // 超时回退（兜底）：仅当后端彻底没回 ready 时才触发。
    // 注意：以前这里会「回退到探测端口」——而那个端口可能已被另一个应用占用，
    // 加载它就会串台显示别的 App 界面。现改为读取【本应用自己的端口文件】
    // （后端 bind 成功后写入，内容为【本后端】真实端口，且启动时已清空旧值），
    // 拿不到就视为启动失败弹窗，绝不拿一个可能属于别人的端口去加载。
    setTimeout(() => {
      if (backendResolved) return;
      try {
        const pf = path.join(require('os').tmpdir(), 'easyops-port.txt');
        if (fs.existsSync(pf)) {
          const p = parseInt(fs.readFileSync(pf, 'utf8').toString().trim(), 10);
          if (p) {
            backendResolved = true;
            resolve(p);
            return;
          }
        }
      } catch (e) {}
      backendResolved = true;
      reject(new Error('后端启动超时（20s 内未收到就绪信号）。请查看 main.log 与后端日志。'));
    }, 20000);
  });
};

const createWindow = (port) => {
  const iconPath = resPath('client/dist/logo.png');

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
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
  // 停止后端进程（含其正在运行的脚本子进程）
  if (backendProcess) {
    try {
      if (process.platform === 'win32') {
        // Windows 上 Node 的 child.kill() 底层是 TerminateProcess，只杀后端自身、
        // 不杀进程树，脚本会残留为孤立进程继续后台运行。
        // 故用 taskkill /T /F 连根拔起：后端 + 它 spawn 的 shell 脚本 + 脚本的子命令，
        // 全部一并结束（/T 只向下遍历子进程，不会误伤 Electron 主进程）。
        const { execSync } = require('child_process');
        try { execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: 'ignore' }); }
        catch (e) { try { backendProcess.kill(); } catch (_) {} }
      } else {
        // POSIX：发 SIGTERM，交由后端的 SIGTERM 处理器去杀死其 detached 的脚本进程组后自行退出。
        // 不直接 kill(-pid)，否则会误杀整个 Electron 进程树。
        backendProcess.kill('SIGTERM');
      }
    } catch (e) {}
  }
});

// ==================== IPC 处理 ====================

ipcMain.handle('get-app-info', () => {
  const userData = app.getPath('userData');
  return {
    version: app.getVersion(),
    name: app.getName(),
    userData,
    isDev,
    scriptsConfigPath: path.join(userData, 'scripts.json'),
    logFilePath: path.join(userData, 'logs', 'main.log')
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
  // 单脚本显示 4 秒，批量每条显示 2 秒
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

// ==================== 自动更新 ====================
// 平台分流：
//   - Windows: 沿用 electron-updater（NSIS 安装包，签名非必需，Squirrel 流程正常工作）
//   - macOS : 使用自研更新器（见 initMacUpdater）。因为个人开发者无 Apple 签名，
//             electron-updater 依赖的 Squirrel.Mac 会拒绝替换未签名的 .app（表现为
//             quitAndInstall 静默无反应），故完全绕开 Squirrel，自己下载 + 解压 + 替换。
// 仅在打包后的生产环境启用：开发模式下不检查更新，避免无谓的网络请求与报错
const GH_OWNER = 'bynow2code';
const GH_REPO = 'easy-ops';

const initAutoUpdater = () => {
  if (!app.isPackaged) {
    log('Auto updater disabled in dev mode');
    // 开发模式下仍需注册 IPC 处理，否则渲染进程调用 checkForUpdates 会报
    // "No handler registered" 并打到控制台。这里直接向前端下发「dev 模式不可用」提示。
    ipcMain.handle('app:check-updates', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-event', {
          type: 'error',
          message: 'Running in dev mode. Auto-update only works in packaged builds.'
        });
      }
    });
    ipcMain.handle('app:download-update', () => {});
    ipcMain.handle('app:start-update', () => {});
    return;
  }
  if (process.platform === 'darwin') {
    initMacUpdater();
  } else {
    initWinUpdater();
  }
};

// -------------------- Windows：electron-updater --------------------
const initWinUpdater = () => {
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
    owner: GH_OWNER,
    repo: GH_REPO
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

  // 下载完成后，由前端「重启并更新」按钮调用，安装并重启
  ipcMain.handle('app:start-update', () => {
    log('[UPDATE] quitAndInstall called');
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      log(`[UPDATE] quitAndInstall failed: ${e.message}`);
      try { app.quit(); } catch (e2) {}
      throw e;
    }
  });

  // 注意：不在这里做启动后自动检查。更新检查完全由用户点击「Check for Updates」触发，
  // 避免启动即用缓存状态把弹窗预设成「已是最新」，造成「点了没反应 / 没真正检查」的错觉。
};

// -------------------- macOS：自研更新器（绕开签名/Squirrel） --------------------
// 原理：
//   1. 通过 GitHub API 读取最新 Release，比对版本号；
//   2. 用 HTTPS 直接下载与本机架构匹配的 -${arch}.zip（electron-builder 产物）；
//   3. 用 ditto 解压得到新的 EasyOps.app；
//   4. 生成一个后台 shell 脚本：等待当前进程退出后，替换 /Applications 中的旧 .app 并重启。
// 说明：HTTPS 下载解压出来的 .app 不带 com.apple.quarantine 标记，Gatekeeper 通常不拦，
//       因此无需 Apple 签名即可完成替换与启动。
const initMacUpdater = () => {
  const https = require('https');
  const os = require('os');
  const { spawn } = require('child_process');

  const send = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-event', payload);
    }
  };

  let isChecking = false;
  let isDownloading = false;
  let pendingAppPath = null;   // 解压后新 .app 的路径
  let pendingVersion = null;   // 待安装版本号

  // 语义化版本比较：a>b => 1, a<b => -1, 相等 => 0
  const cmpVersion = (a, b) => {
    const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
  };

  // 发起 HTTPS GET 并解析 JSON（自动跟随重定向）
  const httpsGetJson = (url, redirects = 0) => new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = https.get(url, {
      headers: { 'User-Agent': 'EasyOps-Updater', 'Accept': 'application/vnd.github+json' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpsGetJson(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GitHub API responded ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('GitHub API request timed out')));
  });

  // 下载文件到本地，回调下载进度（自动跟随重定向：GitHub → objects.githubusercontent.com）
  const downloadFile = (url, dest, onProgress, redirects = 0) => new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'EasyOps-Updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadFile(res.headers.location, dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let transferred = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        transferred += chunk.length;
        if (onProgress) onProgress(transferred, total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (e) => { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Download request timed out')));
  });

  // 用 ditto 解压 zip（能正确保留 .app 的权限与符号链接）
  const unzip = (zipPath, destDir) => new Promise((resolve, reject) => {
    const p = spawn('ditto', ['-x', '-k', zipPath, destDir]);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Unzip failed (code ${code}): ${stderr}`)));
  });

  // 拉取最新 Release，返回 { version, releaseNotes, asset }（asset 为匹配本机架构的 zip）
  const fetchLatestRelease = async () => {
    const json = await httpsGetJson(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`);
    const version = String(json.tag_name || '').replace(/^v/, '');
    const arch = process.arch; // 'arm64' | 'x64'
    const assets = Array.isArray(json.assets) ? json.assets : [];
    // electron-builder 产物命名：${productName}-${version}-${arch}.zip（见 package.json build.mac.artifactName）
    const asset = assets.find(a => typeof a.name === 'string' && a.name.endsWith(`-${arch}.zip`));
    return { version, releaseNotes: json.body || '', asset };
  };

  // 手动检查更新
  ipcMain.handle('app:check-updates', async () => {
    if (isChecking) {
      log('[UPDATE][mac] check ignored - already checking');
      return;
    }
    if (isDownloading) return;
    isChecking = true;
    send({ type: 'checking' });
    try {
      const { version, releaseNotes, asset } = await fetchLatestRelease();
      const current = app.getVersion();
      log(`[UPDATE][mac] current=${current} latest=${version} arch=${process.arch} asset=${asset ? asset.name : 'none'}`);
      isChecking = false;
      if (version && cmpVersion(version, current) > 0) {
        if (!asset) {
          send({ type: 'error', message: `未找到适配 ${process.arch} 架构的更新包（${version}）。` });
          return;
        }
        pendingVersion = version;
        pendingAppPath = null; // 新版本可用，清除旧的已下载状态
        send({ type: 'available', version, releaseNotes });
      } else {
        send({ type: 'not-available', version: current });
      }
    } catch (e) {
      isChecking = false;
      log(`[UPDATE][mac] check failed: ${e.message}`);
      send({ type: 'error', message: e.message || String(e) });
    }
  });

  // 下载并解压新版本
  ipcMain.handle('app:download-update', async () => {
    if (isDownloading) {
      log('[UPDATE][mac] download ignored - already downloading');
      return;
    }
    isDownloading = true;
    log('[UPDATE][mac] download started');
    try {
      // 若尚未拿到 asset（例如直接点下载），重新拉取一次；version 以本次拉取结果为准
      let asset, version;
      const latest = await fetchLatestRelease();
      asset = latest.asset;
      version = latest.version;
      if (!asset) throw new Error(`未找到适配 ${process.arch} 架构的更新包。`);

      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyops-update-'));
      const zipPath = path.join(workDir, asset.name);

      let lastPercent = -1;
      await downloadFile(asset.browser_download_url, zipPath, (transferred, total) => {
        const percent = total ? Math.round((transferred / total) * 100) : 0;
        if (percent !== lastPercent) {
          lastPercent = percent;
          send({ type: 'downloading', percent, transferred, total });
        }
      });
      log('[UPDATE][mac] download completed, unzipping...');

      const extractDir = path.join(workDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      await unzip(zipPath, extractDir);

      // 找到解压出的 .app
      const appName = fs.readdirSync(extractDir).find(n => n.endsWith('.app'));
      if (!appName) throw new Error('更新包中未找到 .app');
      pendingAppPath = path.join(extractDir, appName);
      pendingVersion = version;

      isDownloading = false;
      log(`[UPDATE][mac] ready to install: ${pendingAppPath}`);
      send({ type: 'downloaded', version });
    } catch (e) {
      isDownloading = false;
      log(`[UPDATE][mac] download/unzip failed: ${e.message}`);
      send({ type: 'error', message: e.message || String(e) });
    }
  });

  // 安装并重启：生成后台脚本，等本进程退出后替换 /Applications 中的 .app 并重启
  ipcMain.handle('app:start-update', () => {
    log('[UPDATE][mac] start-update called');
    if (!pendingAppPath || !fs.existsSync(pendingAppPath)) {
      const msg = '未找到已下载的更新包，请重新下载。';
      log(`[UPDATE][mac] ${msg}`);
      send({ type: 'error', message: msg });
      throw new Error(msg);
    }
    try {
      // 目标 .app 路径：从可执行文件路径反推（.../EasyOps.app/Contents/MacOS/EasyOps）
      const targetApp = process.execPath.split('.app')[0] + '.app';
      const scriptPath = path.join(os.tmpdir(), `easyops-install-${Date.now()}.sh`);

      // 后台安装脚本：
      //   1) 等待当前 PID 退出
      //   2) 删除旧 .app 并用 ditto 拷入新 .app（失败则用 osascript 提权重试）
      //   3) 移除隔离属性并重启
      const script = `#!/bin/bash
set -e
PID="${process.pid}"
NEW_APP="${pendingAppPath}"
TARGET_APP="${targetApp}"

# 等待旧进程退出
for i in $(seq 1 60); do
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  sleep 0.5
done
sleep 0.5

# 替换（无权限则尝试提权）
if rm -rf "$TARGET_APP" 2>/dev/null && ditto "$NEW_APP" "$TARGET_APP" 2>/dev/null; then
  :
else
  osascript -e "do shell script \\"rm -rf '$TARGET_APP' && ditto '$NEW_APP' '$TARGET_APP'\\" with administrator privileges"
fi

# 去除隔离属性，确保能直接启动
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true

# 重启新版本
open "$TARGET_APP"
`;
      fs.writeFileSync(scriptPath, script, { mode: 0o755 });
      log(`[UPDATE][mac] launching installer script: ${scriptPath} -> ${targetApp}`);

      const child = spawn('/bin/bash', [scriptPath], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      // 让脚本先跑起来，再退出主进程
      setTimeout(() => app.quit(), 300);
    } catch (e) {
      log(`[UPDATE][mac] start-update failed: ${e.message}`);
      send({ type: 'error', message: e.message || String(e) });
      throw e;
    }
  });

  // 注意：不在这里做启动后自动检查。更新检查完全由用户点击「Check for Updates」触发，
  // 避免启动即用缓存状态把弹窗预设成「已是最新」，造成「点了没反应 / 没真正检查」的错觉。
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