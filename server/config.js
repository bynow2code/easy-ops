'use strict';

/**
 * 后端运行时配置（server/config.js）
 * ------------------------------------------------------------------
 * 集中管理可在后端代码中调整的参数。本次重点是"日志默认路径后端可配置"：
 *   - 默认日志目录在此定义，满足需求中"默认路径要后端代码可配置"的要求
 *   - 优先级：环境变量 EASYOPS_LOG_DIR > 本文件默认值
 *   - 打包后通常由主进程通过环境变量注入 userData/logs 路径，保持零额外配置
 * ------------------------------------------------------------------
 */

const path = require('path');
const os = require('os');

// 默认日志目录：打包后由主进程注入 userData/logs；
// 开发 / 独立运行时回退到用户主目录下的 .easyops/logs。
const LOG_DIR = process.env.EASYOPS_LOG_DIR || path.join(os.homedir(), '.easyops', 'logs');

// Shell 配置持久化目录（shell-config.json 落盘位置）。
// 打包后由主进程通过 EASY_OPS_USER_DATA 注入（= app.getPath('userData')），
// 保证 Electron 与内嵌后端读写同一份配置；开发 / 独立运行时回退到用户主目录。
function getUserDataDir() {
  return process.env.EASY_OPS_USER_DATA || path.join(os.homedir(), '.easy-ops');
}

module.exports = {
  // Shell 配置持久化目录解析（供 shell-routes 复用）
  getUserDataDir,

  // 脚本持久化文件（脚本列表 / 新增脚本写入此处）。
  // 与 shell-config 一致落到 userData（Electron 内 = app.getPath('userData')），
  // 这样 Settings 面板显示的 "Scripts Config" 路径与实际落盘位置相同，避免两处不一致。
  scriptsFile: path.join(getUserDataDir(), 'scripts.json'),

  // 日志配置（注入到 shared/logger 的 createLogger）
  log: {
    dir: LOG_DIR, // 后端可在此（或环境变量）集中修改默认路径
    filename: 'easyops.log',
    // 生产环境默认 info，开发环境默认 debug，便于排查
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },

  // 内嵌服务端口文件（主进程读取以建立 IPC/HTTP 通道）
  portFile: path.join(__dirname, '..', 'port.txt'),
};
