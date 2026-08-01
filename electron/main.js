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
const shellCfg = require('../server/shell-config');
const shellDetect = require('../server/shell-detect');

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
    shellConfig: shellCfg.getPath(userData),
    logDir,
  };
}

function loadShells() {
  const cfg = shellCfg.read(app.getPath('userData'));
  if (cfg.noShellMode) return { noShellMode: true, shells: [], activeShellPath: null };
  const detected = shellDetect.detect();
  const custom = cfg.shells.map((s) => ({ ...s, custom: true }));
  // 合并去重（按 path）
  const map = new Map();
  [...detected, ...custom].forEach((s) => {
    if (!map.has(s.path)) map.set(s.path, s);
  });
  return {
    noShellMode: false,
    shells: Array.from(map.values()),
    activeShellPath: cfg.activeShellPath,
  };
}

function findShell(p) {
  const list = loadShells().shells;
  return list.find((s) => s.path === p) || null;
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

// ---------- IPC: Shell ----------
ipcMain.handle('shell:list', () => loadShells());

ipcMain.handle('shell:getNoShellMode', () => {
  return shellCfg.read(app.getPath('userData')).noShellMode;
});

ipcMain.handle('shell:setNoShellMode', (_evt, value) => {
  const userData = app.getPath('userData');
  const cfg = shellCfg.read(userData);
  cfg.noShellMode = Boolean(value);
  if (cfg.noShellMode) cfg.activeShellPath = null; // 切到无 shell 时清掉当前
  shellCfg.write(userData, cfg);
  logger.info('设置 noShellMode', { value: cfg.noShellMode });
  return cfg.noShellMode;
});

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
  // 顺手探测版本
  let version = null;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(filePath, ['--version'], { encoding: 'utf8', timeout: 2000 });
    version = String(out).split(/\r?\n/)[0].trim();
  } catch {
    /* 探测失败也可保存，后续再补 */
  }
  return { path: filePath, name: path.basename(filePath), version, custom: true, probeFailed: !version };
});

ipcMain.handle('shell:add', (_evt, filePath) => {
  if (typeof filePath !== 'string' || !filePath) {
    return { ok: false, error: 'Empty path' };
  }
  if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found' };
  const userData = app.getPath('userData');
  const cfg = shellCfg.read(userData);
  if (cfg.shells.some((s) => s.path === filePath)) return { ok: false, error: 'Already added' };
  cfg.shells.push({ path: filePath, custom: true });
  shellCfg.write(userData, cfg);
  logger.info('新增自定义 shell', { path: filePath });
  return { ok: true, shells: loadShells().shells };
});

ipcMain.handle('shell:setActive', (_evt, filePath) => {
  const userData = app.getPath('userData');
  const cfg = shellCfg.read(userData);
  if (filePath) {
    const found = findShell(filePath);
    if (!found) return { ok: false, error: 'Shell not in list' };
    cfg.activeShellPath = found.path;
  } else {
    cfg.activeShellPath = null; // 跟随默认
  }
  cfg.noShellMode = false; // 显式选 shell 自动退出无 shell 模式
  shellCfg.write(userData, cfg);
  logger.info('设置当前 shell', { path: cfg.activeShellPath });
  return { ok: true, ...loadShells() };
});

ipcMain.handle('shell:remove', (_evt, filePath) => {
  if (typeof filePath !== 'string' || !filePath) {
    return { ok: false, error: 'Empty path' };
  }
  const userData = app.getPath('userData');
  const cfg = shellCfg.read(userData);
  if (!cfg.shells.some((s) => s.path === filePath)) {
    return { ok: false, error: 'Shell not found' };
  }
  if (cfg.activeShellPath === filePath) {
    return { ok: false, error: 'Cannot remove the active shell' };
  }
  shellCfg.removeShell(userData, filePath);
  logger.info('移除自定义 shell', { path: filePath });
  return { ok: true, ...loadShells() };
});

// ---------- helpers ----------
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