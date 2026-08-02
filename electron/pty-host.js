'use strict';

/**
 * PTY Host（骨架 / 设计接口）
 * 职责：使用 node-pty 为每个脚本创建独立的交互式终端会话，
 *       维护 scriptId -> pty 映射，支持创建 / 输入 / resize / kill。
 * 本文件仅定义接口骨架，具体双向流在"执行脚本"步骤落地。
 *
 * 设计要点：
 *  - 每个 pty 会话都应绑定一个带 context 的子日志器（logger.child({scriptId})），
 *    以便把"哪个脚本、哪次执行"的上下文随日志一并记录。
 *  - 输出通过 IPC 推送到渲染层的 xterm；用户输入通过 IPC 回写 pty。
 */

const pty = require('node-pty');
const { createLogger } = require('../shared/logger');
const config = require('../server/config');

const logger = createLogger({
  isDev: process.env.NODE_ENV !== 'production',
  level: config.log.level,
  dir: config.log.dir,
  filename: config.log.filename,
});

/** @type {Map<string, import('node-pty').IPty>} */
const sessions = new Map();

// 取用已存在的会话；不存在则跳过（不抛错），action 内对 term 操作
function withSession(id, action) {
  const term = sessions.get(id);
  if (!term) return;
  action(term);
}

/**
 * 为某个脚本打开一个交互式终端会话
 * @param {string} scriptId 脚本标识（作为日志上下文）
 * @param {object} opts { command, cwd, env }
 * @param {(data: string) => void} onData shell 输出回调（→ 渲染层 xterm）
 * @returns {string} sessionId
 */
function openSession(scriptId, opts, onData) {
  const ctxLogger = logger.child({ scriptId });

  // 执行失败 / 退出都要记录上下文，便于事后追溯
  let term;
  try {
    term = pty.spawn(opts.command || 'bash', opts.args || [], {
      cwd: opts.cwd || process.cwd(),
      env: Object.assign({}, process.env, opts.env || {}),
    });
  } catch (err) {
    ctxLogger.error('PTY 会话创建失败', { command: opts.command }, err);
    throw err;
  }

  const sessionId = `${scriptId}@${Date.now()}`;
  sessions.set(sessionId, term);

  term.onData((data) => onData && onData(data));
  term.onExit(({ exitCode }) => {
    ctxLogger.info('PTY 会话结束', { sessionId, exitCode });
    sessions.delete(sessionId);
  });

  ctxLogger.info('PTY 会话已创建', { sessionId, command: opts.command });
  return sessionId;
}

function write(sessionId, data) {
  withSession(sessionId, (term) => term.write(data));
}

function resize(sessionId, cols, rows) {
  withSession(sessionId, (term) => term.resize(cols, rows));
}

function kill(sessionId) {
  withSession(sessionId, (term) => {
    term.kill();
    sessions.delete(sessionId);
  });
}

module.exports = { openSession, write, resize, kill, sessions };
