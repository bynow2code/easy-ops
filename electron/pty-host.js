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
 *  - 平台差异只在“默认 shell 选哪个”（shellDetect.getDefaultShellPath），feature / UI 代码零平台分支。
 *  - 停止跨平台一致：统一 killByExec(execId)。Windows 的 ConPTY 下
 *    term.kill() 已杀整棵进程树；Unix 下对整个进程组先发 SIGTERM，
 *    宽限 ~2s 仍存活再 SIGKILL（与 VS Code 的 TERMINATE_TIMEOUT 思路一致），
 *    避免脚本拉起的子进程残留。平台差异全部封死在本文件内。
 */

const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const pty = require('node-pty');
const { createLogger } = require('../shared/logger');
const config = require('../server/config');
const shellDetect = require('../server/shell-detect');

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
// 复用 server/shell-detect 的权威默认路径（getDefaultShellPath）；Windows 仅
// 支持 Git Bash 与 WSL（bash 系列）。没装时 getDefaultShellPath 会返回常量路径，
// 由 openSession 内的 isUsableInterpreter 预检转成可读报错（提示去设置里指定
// shell / 开启无 shell 模式），不回退 PowerShell。

// --------- 打开会话（交互式常驻 shell）---------
// 脚本内容不作为 -c 参数，而是作为"首条输入"喂给一个常驻的交互式 shell：
// 脚本跑完停在提示符，用户可继续手敲命令（read / REPL / ssh / vim 等皆可用）。
// 不写任何临时文件，天然跨平台（Windows 上无需 /mnt/c 路径翻译）。
function openSession({ execId, scriptId, content, shell, cwd, env }) {
  const interpreter = shell || shellDetect.getDefaultShellPath();
  const ctxLogger = logger.child({ scriptId, execId });

  // 预检：解释器必须存在且可执行。否则给出清晰、可操作的报错，而不是把
  // node-pty 的底层 ENOENT/UNKNOWN 透传给前端（那条信息对用户晦涩）。
  // 覆盖两处：显式传入的 shell，以及"跟随系统默认"兜底解析出的路径
  // （Windows 上 shellDetect 解析出的默认路径未必存在时，会由下方预检转成可读报错）。
  if (typeof interpreter !== 'string' || !interpreter.trim()) {
    throw new Error(
      'No usable shell interpreter: none resolved. Set one in Settings (Settings → Shell) or enable No Shell Mode for demo output.',
    );
  }
  if (!shellDetect.isUsableInterpreter(interpreter)) {
    throw new Error(
      `No usable shell interpreter: "${interpreter}" was not found or is not executable. ` +
        'Set a valid shell in Settings (Settings → Shell) or enable No Shell Mode for demo output.',
    );
  }

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
    // 即便预检通过（如竞态/瞬时权限变化），仍给出可读错误而非底层堆栈
    throw new Error(
      `Failed to start shell interpreter "${interpreter}": ${String(err && err.message ? err.message : err)}. ` +
        'Check Settings → Shell or enable No Shell Mode.',
    );
  }

  const sessionId = `${scriptId}@${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  sessions.set(sessionId, { term, execId, scriptId });
  execToSession.set(execId, sessionId);

  // 完成探测哨兵：脚本首条输入之后写一行唯一 marker；渲染层在输出流里识别该 token
  // 即判定"脚本已结束"（shell 仍常驻、可继续交互）。marker 命令会被终端回显，
  // 渲染层会连同其输出一并剔除，终端保持干净。token 随机且带前缀，不会与用户输出重合。
  const doneToken = 'EASYOPS_DONE_' + crypto.randomBytes(16).toString('hex');

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

  // 把脚本内容作为首条输入（像在终端里粘贴/敲下这段）；空内容则直接给干净交互 shell。
  // 尾巴的 \n 用来"提交"这段输入；shell 看到脚本末尾的换行后开始执行并最终输出 PS1。
  if (content) {
    try {
      term.write(content + '\n');
    } catch {
      /* 会话异常时写入可能抛错，忽略 */
    }
  }

  // 完成探测哨兵：脚本首条输入被 shell 执行完毕并打印 PS1 之后，写入一段"自擦除"的
  // 哨兵命令（一次性写入，bash 按字符 echo + 整体提交 + 执行）：
  //   `\x1b[2K\r\x1b[2K; echo "<TOKEN>"`
  //   - 前导 `\x1b[2K\r\x1b[2K`：ANSI 清当前行（PS1 第二行 `$ `）+ 回行首 + 再清当前行。
  //     让哨兵段的"清行操作"在终端上立即生效，原 PS1 第二行的 `$ ` 视觉上消失，
  //     避免出现"额外 PS1 / 多余换行 / 光标错位"。
  //   - `; echo "<TOKEN>"`：bash 提交后执行，输出唯一哨兵 token；
  //     渲染层 sentinelFilter 整段 drop（回显行 + 输出行）。
  //   整体语义：哨兵执行后，bash 会输出"新 PS1"（正常 `$ ` 提示符），sentinelFilter
  //   已剔除整段哨兵段，终端视觉上等于"脚本输出 → 原 PS1 → 干净的新 PS1"，光标
  //   自然停在 `$ ` 之后等待用户输入。配合 sentinelFilter 严格 drop 哨兵段 + 透传
  //   清行 ANSI 操作，彻底消除"多个 PS1 / 多余换行 / 光标错位"的所有副作用。
  //   故意不写 `PROMPT_COMMAND='PS1='; PS1=`：那会永久把 PS1 改成空（PROMPT_COMMAND
  //   会在之后每次显示 PS1 前都把 PS1 置空），让交互态下的提示符永远看不见——对
  //   交互体验是反向劣化。这里依靠 sentinelFilter 把哨兵段"无痕"擦掉就够了。
  const doneMarker = `\x1b[2K\r\x1b[2K; echo "${doneToken}"`;
  try {
    term.write(doneMarker + '\n');
  } catch {
    /* 会话异常时写入可能抛错，忽略 */
  }

  ctxLogger.info('PTY 会话已创建（交互式）', { sessionId, interpreter });
  return { sessionId, doneToken, doneMarker, interpreter, args: [] };
}

function write(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session) {
    try {
      session.term.write(data);
    } catch {
      // 会话已退出时写入可能抛错，忽略
    }
  }
}

function resize(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (session) {
    try {
      session.term.resize(cols, rows);
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
  const session = sessions.get(sessionId);
  if (session) {
    killSession(session.term);
    sessions.delete(sessionId);
  }
  execToSession.delete(execId);
  return true;
}

// 终止所有仍在运行的会话（退出程序 / 关闭窗口前清场用）。
// 避免 shell 子进程及其拉起的脚本 / ssh / tail 等在主进程退出后沦为孤儿进程
// 继续后台运行（Unix 下会被 reparent 到 init，Windows 下 ConPTY 进程树残留）。
// 复用 killSession 保证跨平台一致（Unix 进程组 SIGTERM→SIGKILL，Windows 杀整棵树）。
function killAll() {
  const ids = Array.from(sessions.keys());
  for (const sessionId of ids) {
    const session = sessions.get(sessionId);
    if (session) killSession(session.term);
    sessions.delete(sessionId);
  }
  execToSession.clear();
  return ids.length;
}

module.exports = {
  on,
  openSession,
  write,
  resize,
  killByExec,
  killAll,
};
