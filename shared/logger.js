'use strict';

/**
 * 统一日志模块（shared/logger.js）
 * ==================================================================
 * 设计目标
 *  - 开发模式：日志直接打印到终端（console）
 *  - 生产模式：日志写入文件（默认目录由后端配置注入，见 server/config.js）
 *  - 支持日志级别：debug / info / warn / error
 *  - 支持错误信息：传入 Error 实例时记录 message 与 stack
 *  - 支持上下文：每次调用可附带 context 对象，随日志一并输出
 *  - 进程级兜底：installProcessHandlers() 捕获未处理异常与 Promise 拒绝
 *
 * 设计风格：以纯函数（buildEntry / consoleLine / fileLine）作为业务血肉，
 *          以 createLogger 工厂 + 配置对象作为依赖注入骨架，便于测试与复用。
 * ==================================================================
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

// 日志级别（数值越大越严重，用于阈值过滤）
const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

// 默认配置：后端可通过 createLogger(config) 覆盖 dir / level / isDev 等字段
const DEFAULT_CONFIG = Object.freeze({
  isDev: process.env.NODE_ENV !== 'production', // 默认跟随 NODE_ENV
  level: 'info', // 全局级别阈值
  dir: null, // 日志目录；null 时由后端 config 推导后注入
  filename: 'easyops.log', // 日志文件名
  enableConsole: null, // null => 跟随 isDev（dev 打印，prod 不打印）
  enableFile: null, // null => 跟随 !isDev（prod 写文件）
  maxFileSize: 5 * 1024 * 1024, // 单文件滚动阈值（字节）
  maxBackup: 3, // 保留的历史备份文件数
});

// 终端颜色（仅开发模式使用）
const COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
};

// ------------------------------------------------------------------
// 纯函数区：不依赖实例状态，便于单元测试
// ------------------------------------------------------------------

/**
 * 构造一条结构化日志条目
 * @param {string} level 日志级别
 * @param {*} message 主消息（字符串或任意可序列化值）
 * @param {object} [context] 业务上下文，随日志一并记录
 * @param {Error} [error] 错误实例，自动展开 message / stack
 * @returns {object}
 */
function buildEntry(level, message, context, error) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: typeof message === 'string' ? message : safeInspect(message),
  };
  if (error instanceof Error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (context !== undefined && context !== null) {
    entry.context = context;
  }
  return entry;
}

// 安全的对象序列化，避免循环引用导致崩溃
function safeInspect(value) {
  try {
    return util.inspect(value, { depth: 4, breakLength: Infinity });
  } catch (_) {
    return String(value);
  }
}

// 终端单行格式（带颜色，便于人眼阅读）
function consoleLine(entry) {
  const c = COLORS[entry.level] || '';
  const reset = COLORS.reset;
  let line = `${entry.ts} ${c}[${entry.level.toUpperCase()}]${reset} ${entry.msg}`;
  if (entry.context) {
    line += ` ${c}ctx=${safeInspect(entry.context)}${reset}`;
  }
  if (entry.error) {
    line += `\n${entry.error.stack || entry.error.message}`;
  }
  return line;
}

// 文件单行格式（JSON Lines，便于机器解析与集中收集）
function fileLine(entry) {
  return JSON.stringify(entry);
}

// ------------------------------------------------------------------
// 日志器工厂：依赖注入配置，返回带级别方法的实例
// ------------------------------------------------------------------
function createLogger(userConfig = {}) {
  const config = Object.assign({}, DEFAULT_CONFIG, userConfig);

  // 终端 / 文件开关：未显式指定时跟随运行模式
  const enableConsole = config.enableConsole == null ? config.isDev : config.enableConsole;
  const enableFile = config.enableFile == null ? !config.isDev : config.enableFile;

  let fileStream = null;
  let currentSize = 0;
  let fileDisabled = false; // 目录不可用时降级标记

  // 确保日志目录存在（创建失败则降级为仅终端输出，不致命）
  function ensureDir() {
    if (!config.dir) return null;
    try {
      fs.mkdirSync(config.dir, { recursive: true });
      return config.dir;
    } catch (e) {
      if (enableConsole) {
        console.error(`[logger] 无法创建日志目录 ${config.dir}: ${e.message}`);
      }
      fileDisabled = true;
      return null;
    }
  }

  // 打开日志文件（必要时先做滚动）
  function openFile() {
    const dir = ensureDir();
    if (!dir) return;
    const filePath = path.join(dir, config.filename);
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size >= config.maxFileSize) {
        rotate(filePath);
        currentSize = 0;
      } else if (fs.existsSync(filePath)) {
        currentSize = fs.statSync(filePath).size;
      }
      fileStream = fs.createWriteStream(filePath, { flags: 'a' });
      fileStream.on('error', (e) => {
        if (enableConsole) console.error(`[logger] 写入日志失败: ${e.message}`);
      });
    } catch (e) {
      if (enableConsole) console.error(`[logger] 打开日志文件失败: ${e.message}`);
    }
  }

  // 文件滚动：app.log -> app.log.1 -> app.log.2 ...，超出 maxBackup 丢弃最旧
  function rotate(filePath) {
    try {
      for (let i = config.maxBackup - 1; i >= 1; i--) {
        const src = `${filePath}.${i}`;
        const dst = `${filePath}.${i + 1}`;
        if (fs.existsSync(src)) fs.renameSync(src, dst);
      }
      if (fs.existsSync(filePath)) fs.renameSync(filePath, `${filePath}.1`);
    } catch (_) {
      /* 滚动失败不影响主流程 */
    }
  }

  // 写入文件（含大小统计与自动滚动）
  function writeFile(line) {
    if (fileDisabled) return;
    if (!fileStream) openFile();
    if (!fileStream) return;
    currentSize += Buffer.byteLength(line + '\n', 'utf8');
    fileStream.write(line + '\n');
    if (currentSize >= config.maxFileSize) {
      try {
        fileStream.end();
      } catch (_) {
        /* noop */
      }
      fileStream = null;
      currentSize = 0;
    }
  }

  // 核心分发：先按级别阈值过滤，再分流到终端 / 文件
  function log(level, message, context, error) {
    const threshold = LEVELS[config.level] != null ? LEVELS[config.level] : LEVELS.info;
    const cur = LEVELS[level] != null ? LEVELS[level] : LEVELS.info;
    if (cur < threshold) return; // 低于级别阈值直接丢弃

    const entry = buildEntry(level, message, context, error);

    if (enableConsole) {
      const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      out(consoleLine(entry));
    }
    if (enableFile) writeFile(fileLine(entry));
  }

  const api = {
    debug: (msg, ctx) => log('debug', msg, ctx),
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    // error(message, context, error)：显式传入 Error
    error: (msg, ctx, err) => log('error', msg, ctx, err),
    // 返回预置默认上下文的子日志器（上下文记录常用手段）
    child: (defaultContext) => wrapWithContext(api, defaultContext),
    // 优雅关闭文件流；返回 Promise，待底层流真正 finish（数据落盘）后 resolve
    close: () =>
      new Promise((resolve) => {
        if (fileStream) {
          fileStream.once('finish', () => {
            fileStream = null;
            resolve();
          });
          fileStream.end();
        } else {
          resolve();
        }
      }),
    config,
  };
  return api;
}

// 返回一个预置默认上下文的子日志器（上下文透传）
function wrapWithContext(parent, defaultContext) {
  return {
    debug: (m, c) => parent.debug(m, Object.assign({}, defaultContext, c)),
    info: (m, c) => parent.info(m, Object.assign({}, defaultContext, c)),
    warn: (m, c) => parent.warn(m, Object.assign({}, defaultContext, c)),
    error: (m, c, e) => parent.error(m, Object.assign({}, defaultContext, c), e),
  };
}

// 进程级兜底：捕获未处理异常 / Promise 拒绝，避免静默丢失
function installProcessHandlers(logger) {
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { phase: 'process' }, err);
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(safeInspect(reason));
    logger.error('unhandledRejection', { phase: 'process' }, err);
  });
}

module.exports = {
  LEVELS,
  createLogger,
  installProcessHandlers,
  buildEntry,
  consoleLine,
  fileLine,
};
