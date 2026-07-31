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
const LOG_DIR =
  process.env.EASYOPS_LOG_DIR || path.join(os.homedir(), '.easyops', 'logs');

module.exports = {
  // 脚本持久化文件（脚本列表 / 新增脚本写入此处）
  scriptsFile: path.join(__dirname, '..', 'scripts.json'),

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
