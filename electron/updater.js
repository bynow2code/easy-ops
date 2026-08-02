'use strict';

/**
 * 自动更新模块（基于 electron-updater）
 * ------------------------------------------------------------------
 * 设计要点
 *  - 仅在生产打包后生效（app.isPackaged === true）；开发模式完全跳过，
 *    避免更新「正在开发中的 app」这种灾难。
 *  - 启动后静默检查 + 后台下载（autoDownload）；下载完成弹原生对话框，
 *    用户确认后 quitAndInstall 重启生效。
 *  - 通过 webContents 向渲染层广播 updater:status，便于 UI 展示进度（可选）。
 *  - 复用 shared/logger 输出日志，不引入 electron-log 等额外依赖。
 */

const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { broadcast } = require('./ipcBroadcast');

const GITHUB_RELEASES = 'https://github.com/bynow2code/easy-ops/releases';

let log = console;
let isChecking = false;
let downloadedVersion = null;

function compareSemver(a, b) {
  const pa = String(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

// electron-updater 直接调用 logger.info/warn/error/debug，这里包一层对齐 shared/logger 的入参风格
function attachLogger(logger) {
  autoUpdater.logger = {
    info: (m) => logger.info('[updater] ' + String(m)),
    warn: (m) => logger.warn('[updater] ' + String(m)),
    error: (m) => logger.error('[updater] ' + String(m && m.message ? m.message : m)),
    debug: (m) => logger.debug('[updater] ' + String(m)),
  };
}

function initUpdater({ logger } = {}) {
  if (!app.isPackaged) {
    if (logger) logger.info('updater: 开发模式，跳过自动更新');
    return;
  }
  log = logger || console;
  attachLogger(log);

  autoUpdater.autoDownload = true; // 发现更新后后台静默下载
  autoUpdater.autoInstallOnAppQuit = true; // 退出时若有下载好的更新则自动安装

  autoUpdater.on('update-available', (info) => {
    log.info('updater: 检测到可用更新', { version: info && info.version });
    broadcast('updater:status', { state: 'available', version: info && info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('updater: 已是最新', { version: info && info.version });
    broadcast('updater:status', { state: 'idle' });
  });

  autoUpdater.on('download-progress', (p) => {
    broadcast('updater:status', {
      state: 'downloading',
      percent: p && typeof p.percent === 'number' ? Math.round(p.percent) : 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info && info.version;
    log.info('updater: 更新已下载，等待重启', { version: downloadedVersion });
    broadcast('updater:status', { state: 'downloaded', version: downloadedVersion });
    promptRestart(downloadedVersion);
  });

  autoUpdater.on('error', (err) => {
    log.error('updater: 出错', { err: String((err && err.message) || err) });
    broadcast('updater:status', {
      state: 'error',
      message: String((err && err.message) || err),
    });
  });

  // 启动后静默检查一次；失败不致命（网络不可达等）
  checkNow().catch(() => {});
}

// 下载完成后提示重启；用户点 Restart 则退出并安装
function promptRestart(version) {
  const res = dialog.showMessageBoxSync({
    type: 'info',
    title: 'Update available',
    message: `A new version (v${version}) has been downloaded.`,
    detail: 'Restart the app to apply the update.',
    buttons: ['Restart', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (res === 0) {
    autoUpdater.quitAndInstall(true, true); // isSilent + 更新后自动重启
  }
}

// 供 app:checkUpdates IPC 使用：触发一次检查并返回与前端约定一致的结构
async function checkNow() {
  if (!app.isPackaged) {
    return { hasUpdate: false, current: app.getVersion(), latest: app.getVersion() };
  }
  if (isChecking) return { hasUpdate: null, error: 'already checking' };
  isChecking = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = (result && result.updateInfo && result.updateInfo.version) || app.getVersion();
    const hasUpdate = compareSemver(latest, app.getVersion()) > 0;
    return {
      hasUpdate,
      latest,
      current: app.getVersion(),
      releaseUrl: GITHUB_RELEASES,
      downloaded: downloadedVersion === latest,
    };
  } catch (err) {
    return { hasUpdate: null, error: String((err && err.message) || err) };
  } finally {
    isChecking = false;
  }
}

// 供 updater:install IPC 使用：若已下载则立即重启安装
function quitInstall() {
  if (downloadedVersion) autoUpdater.quitAndInstall(true, true);
}

module.exports = { initUpdater, checkNow, quitInstall };
