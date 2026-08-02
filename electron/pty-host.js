'use strict';

/**
 * PTY Host（主进程内，运行在 Electron main 进程）
 * ==================================================================
 * 职责：用 node-pty 为每个脚本执行开一个独立终端会话，维护 execId → session
 *       映射，支持 打开 / 输入 / resize / kill（停止）。通过 EventEmitter 把
 *       输出与退出事件抛给上层（main.js 再经 IPC 转发到渲染层），自身不直接
 *       依赖 electron，便于单测。
 *
 * 执行模型（对齐 VS Code 的终端/进程管理最佳实践）：
 *  - 脚本以"内容"直接喂给解释器：pty.spawn(interpreter, [])（交互式常驻 shell），脚本内容作为首条输入喂入，
 *    不写任何临时文件。这样天然跨平台（Windows 上无需 /mnt/c 路径翻译）。
 *  - 平台差异只在“默认 shell 选哪个”（getDefaultShell），feature / UI 代码零平台分支。
 *  - 停止跨平台一致：统一 killByExec(execId)。Windows 的 ConPTY 下
 *    term.kill() 已杀整棵进程树；Unix 下对整个进程组先发 SIGTERM，
 *    宽限 ~2s 仍存活再 SIGKILL（与 VS Code 的 TERMINATE_TIMEOUT 思路一致），
 *    避免脚本拉起的子进程残留。平台差异全部封死在本文件内。
 */

const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');
const pty = require('node-pty');
const { createLogger } = require('../shared/logger');
const config = require('../server/config');

const logger = createLogger({
  isDev: process.env.NODE_ENV !== 'production',
  level: config.log.level,
  dir: config.log.dir,
  filename: config.log.filename,
});

/** sessionId -> { term, execId, scriptId } */
const sessions = new Map();
/** execId -> sessionId，便于 Stop / Re-run 精准定位"当前这一次"执行 */
const execToSession = new Map();

// 事件总线：data / exit 两类，上层（main.js）订阅后转发到渲染层
const bus = new EventEmitter();
bus.setMaxListeners(0);

function on(evt, cb) {
  bus.on(evt, cb);
  return () => bus.off(evt, cb);
}

// --------- 系统默认 shell 解析 ---------
// Windows 默认：优先 Git Bash（直接吃 Windows 路径、跑 .sh 最省事），
// 其次 wsl.exe（真·Linux），最后回退 PowerShell
function windowsDefaultShell() {
  const gitBashPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of gitBashPaths) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // 继续尝试下一个候选
    }
  }
  try {
    fs.accessSync('C:\\Windows\\System32\\wsl.exe', fs.constants.X_OK);
    return 'C:\\Windows\\System32\\wsl.exe';
  } catch {
    // 回退 PowerShell
  }
  return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
}

// 系统默认登录 shell：macOS / Linux 走 $SHELL → os.userInfo().shell → bash；
// Windows 走 windowsDefaultShell()
function getDefaultShell() {
  if (process.platform === 'win32') return windowsDefaultShell();
  const fromEnv = process.env.SHELL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  try {
    const info = os.userInfo();
    if (info && typeof info.shell === 'string' && info.shell) return info.shell;
  } catch {
    // 个别环境（无 passwd 条目）os.userInfo 会抛错，忽略走回退
  }
  // 无默认 shell：macOS Catalina+ 默认 zsh；其余平台回退 bash
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

// --------- 打开会话（交互式常驻 shell）---------
// 脚本内容不作为 -c 参数，而是作为"首条输入"喂给一个常驻的交互式 shell：
// 脚本跑完停在提示符，用户可继续手敲命令（read / REPL / ssh / vim 等皆可用）。
// 不写任何临时文件，天然跨平台（Windows 上无需 /mnt/c 路径翻译）。
function openSession({ execId, scriptId, content, shell, cwd, env }) {
  const interpreter = shell || getDefaultShell();
  const ctxLogger = logger.child({ scriptId, execId });

  let term;
  try {
    // 交互式：不传 -c 等参数，直接起一个读 pty 的活 shell
    term = pty.spawn(interpreter, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: cwd || os.homedir(),
      env: Object.assign({}, process.env, env || {}),
    });
  } catch (err) {
    ctxLogger.error('PTY 会话创建失败', { interpreter }, err);
    throw err;
  }

  const sessionId = `${scriptId}@${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  sessions.set(sessionId, { term, execId, scriptId });
  execToSession.set(execId, sessionId);

  term.onData((data) => bus.emit('data', { execId, data }));
  term.onExit(({ exitCode, signal }) => {
    ctxLogger.info('PTY 会话结束', { sessionId, exitCode, signal });
    sessions.delete(sessionId);
    if (execToSession.get(execId) === sessionId) execToSession.delete(execId);
    bus.emit('exit', {
      execId,
      scriptId,
      exitCode: exitCode ?? null,
      signal: signal ?? null,
      sessionId,
    });
  });

  // 把脚本内容作为首条输入（像在终端里粘贴/敲下这段）；空内容则直接给干净交互 shell
  if (content) {
    try {
      term.write(content + '\n');
    } catch {
      /* 会话异常时写入可能抛错，忽略 */
    }
  }

  ctxLogger.info('PTY 会话已创建（交互式）', { sessionId, interpreter });
  return { sessionId, interpreter, args: [] };
}

function write(sessionId, data) {
  const s = sessions.get(sessionId);
  if (s) {
    try {
      s.term.write(data);
    } catch {
      // 会话已退出时写入可能抛错，忽略
    }
  }
}

function resize(sessionId, cols, rows) {
  const s = sessions.get(sessionId);
  if (s) {
    try {
      s.term.resize(cols, rows);
    } catch {
      // 尺寸非法或会话已退出，忽略
    }
  }
}

// 停止单个会话：屏蔽平台差异，对外统一入口
function killSession(term) {
  if (!term) return;
  if (process.platform === 'win32') {
    term.kill(); // ConPTY 下 term.kill() 已杀整棵进程树
    return;
  }
  // Unix：对整个进程组发 SIGTERM，宽限后再 SIGKILL（vs Code TERMINATE 思路）
  const pid = term.pid;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      term.kill();
    } catch {
      /* 已退出，忽略 */
    }
  }
  const grace = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* 已退出，忽略 */
    }
  }, 2000);
  if (grace.unref) grace.unref();
}

// 按 execId 停止"当前这一次"执行；找不到说明已结束，返回 false
function killByExec(execId) {
  const sessionId = execToSession.get(execId);
  if (!sessionId) return false;
  const s = sessions.get(sessionId);
  if (s) {
    killSession(s.term);
    sessions.delete(sessionId);
  }
  execToSession.delete(execId);
  return true;
}

module.exports = {
  on,
  openSession,
  write,
  resize,
  kill: killByExec,
  killByExec,
  getSessionIdForExec: (id) => execToSession.get(id) || null,
  getDefaultShell,
  sessions,
};
