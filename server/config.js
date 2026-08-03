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

// Shell 配置持久化目录（shell-config.json 落盘位置）。
// 打包后由主进程通过 EASY_OPS_USER_DATA 注入（= app.getPath('userData')），
// 保证 Electron 与内嵌后端读写同一份配置；开发 / 独立运行时回退到用户主目录。
function getUserDataDir() {
  return process.env.EASY_OPS_USER_DATA || path.join(os.homedir(), '.easy-ops');
}

// ⚠️ 关键：以下路径必须"惰性"求值（用 getter），不能在此处直接 path.join(...)。
// 原因：main.js 会在文件顶部提前 require 本模块（它自身还要用 config.log），
// 而 EASY_OPS_USER_DATA / EASYOPS_LOG_DIR 是随后在 app.whenReady() 回调里才注入的。
// 若在此 eager 求值，模块加载的那一刻 env 尚未注入，getUserDataDir() 会锁死成错误的
// 回退目录（C:\Users\bynow\.easy-ops），且被 require 缓存——于是 dev / 打包后
// 后端都读不到真实配置（真实在 %APPDATA%\EasyOps）。改为 getter 后，每次访问按
// 当前 env 求值，彻底消除时序耦合；server/index.js 里"先设 env 再 require"的注释
// 仅作为良好习惯保留，不再是硬性约束。

module.exports = {
  // Shell 配置持久化目录解析（供 shell-routes 复用）
  getUserDataDir,

  // 系统内置默认分组名（UI 用英文，遵循工程约定）。脚本无分组时归入此处；
  // 默认分组不可删除，但可重命名（重命名后此常量仅作首次落盘的兜底值）。
  DEFAULT_GROUP: 'Default',

  // 脚本持久化文件（脚本列表 / 新增脚本写入此处）。惰性求值：见上方说明。
  // 与 shell-config 一致落到 userData（Electron 内 = app.getPath('userData')），
  // 这样 Settings 面板显示的 "Scripts Config" 路径与实际落盘位置相同，避免两处不一致。
  get scriptsFile() {
    return path.join(getUserDataDir(), 'scripts.json');
  },

  // 日志配置（注入到 shared/logger 的 createLogger）
  log: {
    // 惰性求值：打包后由主进程注入 userData/logs；开发 / 独立运行时回退到 .easyops/logs
    get dir() {
      return process.env.EASYOPS_LOG_DIR || path.join(os.homedir(), '.easyops', 'logs');
    },
    filename: 'easyops.log',
    // 生产环境默认 info，开发环境默认 debug，便于排查
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },

  // 内嵌服务端口文件（主进程读取以建立 IPC/HTTP 通道）
  portFile: path.join(__dirname, '..', 'port.txt'),
};
