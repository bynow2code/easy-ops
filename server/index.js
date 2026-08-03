'use strict';

/**
 * 后端服务入口（骨架 / 集成示例）
 * 职责：内嵌 Express 服务，提供脚本仓库 CRUD（后续步骤补全），
 *       并演示日志模块在"后端侧"的接入方式（含后端可配置默认目录）。
 *
 * 启动方式：由主进程 fork，或通过 npm run electron:dev 时一并拉起。
 */

const express = require('express');
const fs = require('fs');

// 未注入 userData（独立 server / 纯前端 dev：npm run server:dev）时，回退到与 Electron
// 相同的 userData 约定（productName = EasyOps），确保读写的 scripts.json / shell-config.json
// 与打包应用 / electron:dev 是同一份；否则会回退到错误的 .easy-ops 目录而读不到真实配置。
// 注：server/config.js 现已改为惰性求值（getter），故 env 设置时机不再硬性卡在 require 之前；
// 此处仍在 require('./config') 之前设置，仅作清晰的习惯保留。
if (!process.env.EASY_OPS_USER_DATA) {
  const os = require('os');
  const path = require('path');
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : path.join(os.homedir(), '.config');
  process.env.EASY_OPS_USER_DATA = path.join(base, 'EasyOps');
}

const { createLogger } = require('../shared/logger');
const config = require('./config');

// 后端侧日志：复用同一套 logger，目录来自后端可配置项
const logger = createLogger({
  isDev: process.env.NODE_ENV !== 'production',
  level: config.log.level,
  dir: config.log.dir,
  filename: config.log.filename,
});

const app = express();
app.use(express.json());

// 本地工具跨域：渲染层（Electron 内为 file:// 或 dev server 源）以 fetch 调后端，
// 后端与渲染层不同源，需放行 CORS。仅放行本地 API，且为本地单机应用，允许任意源。
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Shell 检测 / 自定义：前端设置页与执行期的解释器来源
const { registerShellRoutes } = require('./shell-routes');
registerShellRoutes(app);

// 脚本仓库 CRUD（列表 / 新增 / 更新 / 删除 / 分组），是 scripts.json 唯一写方
const { registerScriptsRoutes } = require('./scripts-routes');
registerScriptsRoutes(app);

// 端口：默认 0 → 由操作系统分配空闲端口（避免与其他程序抢 4521）；
// 仍可用环境变量 PORT 强制指定（兼容测试 / 调试）。
const PORT = process.env.PORT ? Number(process.env.PORT) : 0;
const server = app.listen(PORT, () => {
  const actualPort = server.address().port;
  logger.info('后端服务已启动', { port: actualPort, scriptsFile: config.scriptsFile });
  // 将实际端口写入 port.txt，供主进程读取建立通道
  fs.writeFileSync(config.portFile, String(actualPort), 'utf8');
});
