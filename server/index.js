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

// TODO(下一步): 脚本列表 / 新增 接口
// GET  /api/scripts  -> 读取 scripts.json
// POST /api/scripts  -> 写入 scripts.json

// 端口：默认 0 → 由操作系统分配空闲端口（避免与其他程序抢 4521）；
// 仍可用环境变量 PORT 强制指定（兼容测试 / 调试）。
const PORT = process.env.PORT ? Number(process.env.PORT) : 0;
const server = app.listen(PORT, () => {
  const actualPort = server.address().port;
  logger.info('后端服务已启动', { port: actualPort, scriptsFile: config.scriptsFile });
  // 将实际端口写入 port.txt，供主进程读取建立通道
  fs.writeFileSync(config.portFile, String(actualPort), 'utf8');
});
