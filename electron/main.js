'use strict';

/**
 * 主进程入口
 * 职责：创建窗口、注入 preload、初始化日志、注册 Settings/Shell 相关 IPC。
 * PTY Host 与窗口逻辑在后续步骤补全。
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createLogger, installProcessHandlers } = require('../shared/logger');
const config = require('../server/config');
const shellDetect = require('../server/shell-detect');
const ptyHost = require('./pty-host');

// 把 PTY Host 的输出 / 退出事件转发到所有渲染窗口（单窗口应用下即当前窗口）。
// 事件名与渲染层约定一致：pty:data / pty:exit。
ptyHost.on('data', ({ execId, data }) => {
  broadcast('pty:data', { execId, data });
});
ptyHost.on('exit', ({ execId, scriptId, exitCode, signal, sessionId }) => {
  broadcast('pty:exit', { execId, scriptId, exitCode, signal, sessionId });
});

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

const GITHUB_REPO_URL = 'https://github.com/bynow2code/easy-ops';
const GITHUB_API_LATEST = 'https://api.github.com/repos/bynow2code/easy-ops/releases/latest';

// 初始化日志：生产模式写文件，目录由后端配置提供；开发模式打印终端
const logger = createLogger({
  isDev: !app.isPackaged, // 打包后 app.isPackaged=true → 走文件模式
  level: config.log.level,
  dir: config.log.dir,
  filename: config.log.filename,
});
installProcessHandlers(logger);

logger.info('主进程启动', { isPackaged: app.isPackaged, logDir: config.log.dir });

function getPaths() {
  const userData = app.getPath('userData');
  const logDir = path.join(userData, 'logs');
  return {
    scriptsConfig: path.join(userData, 'scripts.json'),
    logFile: path.join(logDir, config.log.filename),
    shellConfig: path.join(userData, 'shell-config.json'),
    logDir,
  };
}

// ---------- IPC: App ----------
ipcMain.handle('app:getInfo', () => {
  const p = getPaths();
  return {
    version: app.getVersion(),
    githubUrl: GITHUB_REPO_URL,
    paths: p,
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  };
});

ipcMain.handle('app:checkUpdates', async () => {
  // 优先走 GitHub releases API；不可达时返回 { hasUpdate: null, error }
  try {
    const res = await fetch(GITHUB_API_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { hasUpdate: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    const latest = (data.tag_name || '').replace(/^v/, '');
    const current = app.getVersion();
    const hasUpdate = compareSemver(latest, current) > 0;
    return {
      hasUpdate,
      latest,
      current,
      releaseUrl: data.html_url || GITHUB_REPO_URL + '/releases',
    };
  } catch (err) {
    return { hasUpdate: null, error: String(err && err.message || err) };
  }
});

ipcMain.handle('app:openExternal', async (_evt, url) => {
  if (typeof url !== 'string') return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('app:copyToClipboard', async (_evt, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(String(text ?? ''));
  return true;
});

// 读取后端实际监听端口（由 server/index.js 写入 port.txt，OS 分配时为随机端口）
ipcMain.handle('backend:getPort', () => readBackendPort());

// ---------- IPC: PTY ----------
// 渲染层通过以下接口驱动真实终端会话；会话生命周期与平台差异全部封装在 pty-host。
ipcMain.handle('pty:open', (_evt, opts) => ptyHost.openSession(opts));
ipcMain.handle('pty:write', (_evt, { sessionId, data }) => {
  ptyHost.write(sessionId, data);
  return true;
});
ipcMain.handle('pty:resize', (_evt, { sessionId, cols, rows }) => {
  ptyHost.resize(sessionId, cols, rows);
  return true;
});
ipcMain.handle('pty:kill', (_evt, { execId }) => ptyHost.killByExec(execId));

// ---------- IPC: Shell ----------
// 注意：shell 的"数据"接口（list/add/remove/setActive/noShellMode）已迁移到
// 内嵌 Express 后端（见 server/shell-routes.js），前端通过 HTTP /api/shells 访问，
// 单一数据源、避免与 Electron 主进程双重写 shell-config.json。
// 主进程仅保留需要原生能力的文件选择对话框。
ipcMain.handle('shell:choose', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const opts = {
    title: 'Select shell interpreter',
    properties: ['openFile'],
  };
  if (process.platform !== 'win32') {
    opts.properties.push('treatPackageAsDirectory');
  }
  const res = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  const filePath = res.filePaths[0];
  // 顺手探测版本（复用探测模块，失败也可保存）
  const version = shellDetect.probeVersion(filePath);
  return { path: filePath, name: path.basename(filePath), version, custom: true, probeFailed: !version };
});

// ---------- helpers ----------
// 读取后端实际端口：server 启动后写入 port.txt；读不到 / 非法返回 null
function readBackendPort() {
  try {
    const raw = fs.readFileSync(config.portFile, 'utf8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function compareSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

// 开发模式下加载 Vite dev server（http://localhost:5173）。
// 若 Vite 尚未就绪（连接被拒），做有限次重试，避免直接报 ERR_CONNECTION_REFUSED；
// 超过上限后明确报错，不静默吞掉。生产模式直接加载打包产物。
const DEV_URL = 'http://localhost:5173';
const DEV_LOAD_MAX_RETRY = 20; // 20 * 500ms ≈ 10s（dev:all 已先等 Vite 就绪，此为兜底）
function loadDevWithRetry(win, attempt = 1) {
  win
    .loadURL(DEV_URL)
    .catch((err) => {
      if (attempt >= DEV_LOAD_MAX_RETRY) {
        logger.error('Vite dev server 未就绪，已停止重试', {
          err: String(err),
          attempts: DEV_LOAD_MAX_RETRY,
        });
        return;
      }
      logger.warn('Vite 尚未就绪，稍后重试加载', {
        attempt,
        err: String(err),
      });
      setTimeout(() => loadDevWithRetry(win, attempt + 1), 500);
    });
}

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
    loadDevWithRetry(win);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  // 启动内嵌后端（Express）：先注入 userData / 日志目录，使其与主进程共享同一份
  // shell-config.json，随后装入 server/index.js 即在主进程内监听，前端即可通过
  // HTTP(端口来自 port.txt) 连接后端。这是"前端连接后端"的落地点。
  process.env.EASY_OPS_USER_DATA = app.getPath('userData');
  process.env.EASYOPS_LOG_DIR = path.join(app.getPath('userData'), 'logs');
  require('../server/index.js');

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