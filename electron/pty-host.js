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
 *  - 交互式常驻 shell：pty.spawn(interpreter, [])，脚本跑完停在提示符，用户可继续手敲命令。
 *  - bash 家族：为避免多行脚本触发 PS2 空行，把脚本内容先写入临时文件，再向 PTY 发送单行
 *    `source` 命令执行；非 bash 仍把内容作为首条输入直接喂入。
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

// --------- 交互式终端回显抑制（仅 bash 家族）---------
// 交互式 shell 下，脚本作为"首条输入"喂入会先被终端回显（ECHO），导致终端里多出
// 一行脚本命令本身；完成探测哨兵若单独再写一行，又多出一个 PS1。两者叠加，一个
// 单行脚本的终端会堆出"命令回显 + 输出 + 多个提示符"的多行垃圾。
//
// 干净做法：用 bash 的 `--init-file` 在交互 shell 启动时就 `stty -echo` 关掉终端回显，
// 并把哨兵 echo 与"恢复回显"并入脚本末尾同一行——这样脚本内容不会被回显，且脚本跑完
// 只留一个可交互提示符。非 bash 家族（zsh/fish）沿用旧哨兵方案，行为不变。
//
// 判定：路径以 bash 或 wsl 结尾（含 .exe）。WSL 的 bash 既可能是 wsl.exe 启动器，
// 也可能是 System32\bash.exe，二者都按 WSL 路径规则转换 init 文件位置。

function isBashFamily(interpreter) {
  return /(^|[\\/])(bash|wsl)(\.exe)?$/i.test(interpreter);
}

// 生成（幂等）EasyOps 专用 bash 启动文件，返回其 Windows 绝对路径。
// 关键设计：保留用户"平时的终端"外观——先 source 其 ~/.bashrc 拿回完整环境
// （PATH / alias / 主题 / 自定义带路径/颜色的 PS1 等），再只关掉"后续回显"
// （避免自动执行的脚本命令被回显到屏幕上）。不写死 PS1、不跳过用户配置。
// 写入失败不致命（退化为回显开启，仅视觉多一行脚本命令）。
let cachedInitWinPath = null;
function ensureBashInitFile() {
  if (cachedInitWinPath) return cachedInitWinPath;
  const dir = config.getUserDataDir();
  const fs = require('fs');
  const path = require('path');
  const p = path.join(dir, 'easyops-shell-init.sh');
  const content = [
    '# EasyOps runtime init (auto-generated — do not edit)',
    '# 先给一个非空 PS1，避免用户 ~/.bashrc 里常见的 `[ -z "$PS1" ] && return` 守卫提前退出。',
    "PS1='\\w\\$ '",
    '# 先加载系统级 profile：Git Bash 的彩色 PS1 / __git_ps1 / `ls --color=auto` alias',
    '# 都定义在 /etc/profile.d/*.sh，由 /etc/profile 拉起。只 source ~/.bashrc 拿不到',
    '# 这些，终端就会退化成朴素的 `~$`。',
    '[ -f /etc/profile ] && source /etc/profile',
    '# 再加载用户 .bashrc，恢复 alias / PATH / 主题 / 自定义 PS1 等“平时的终端”样式。',
    '[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"',
    '# 关掉后续终端回显：自动执行的脚本命令（source <脚本文件>）不会被回显到屏幕，',
    '# 但脚本的 stdout/stderr 仍正常显示。脚本跑完由 openSession 发送 `stty echo` 恢复。',
    'stty -echo 2>/dev/null || true',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, content, { mode: 0o644 });
  } catch (e) {
    logger.warn('无法写入 EasyOps shell init 文件，回显抑制将失效', { path: p, err: e.message });
  }
  cachedInitWinPath = p;
  return p;
}

// 把本次脚本内容写入临时脚本文件，返回 bash 可读路径。
// 不把多行内容直接喂给交互式 bash，避免 bash 每读一行不完整命令就打印 PS2（`>`）空行。
function ensureScriptFile(execId, content, interpreter) {
  const dir = config.getUserDataDir();
  const fs = require('fs');
  const path = require('path');
  const winPath = path.join(dir, `easyops-script-${execId}.sh`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(winPath, content, { mode: 0o644 });
  } catch (e) {
    logger.warn('无法写入 EasyOps 临时脚本文件', { path: winPath, err: e.message });
  }
  return toBashInitPath(winPath, interpreter);
}

// 删除临时脚本文件（会话结束时清理）
function removeScriptFile(execId) {
  const dir = config.getUserDataDir();
  const fs = require('fs');
  const path = require('path');
  const winPath = path.join(dir, `easyops-script-${execId}.sh`);
  try {
    fs.unlinkSync(winPath);
  } catch {
    /* 文件不存在或已清理，忽略 */
  }
}

// 把 Windows 路径转成 bash 可接受的形式：Git Bash 用 /<drive>/…，WSL 用 /mnt/<drive>/…。
function toBashInitPath(winPath, interpreter) {
  const normalized = winPath.replace(/\\/g, '/');
  const m = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!m) return normalized;
  const drive = m[1].toLowerCase();
  const rest = m[2];
  if (/Git[\\/]bin[\\/]bash\.exe$/i.test(interpreter)) return `/${drive}/${rest}`;
  return `/mnt/${drive}/${rest}`; // WSL（wsl.exe 启动器 或 System32\bash.exe）
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

  // bash 家族：用 --init-file 关回显，并把哨兵并入脚本末尾（见下方注入）。
  // WSL 启动器（wsl.exe）需在其后追加 bash；直接 bash 二进制（Git / System32）则直接 --init-file。
  const bashLike = isBashFamily(interpreter);
  let spawnArgs = [];
  if (bashLike) {
    const initWin = ensureBashInitFile();
    const initBash = toBashInitPath(initWin, interpreter);
    spawnArgs = /wsl\.exe$/i.test(interpreter)
      ? ['bash', '--init-file', initBash]
      : ['--init-file', initBash];
  }

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
    // 交互式：不传 -c 等参数，直接起一个读 pty 的活 shell。
    // bash 家族带 --init-file 关回显；其余（zsh/fish）沿用默认参数。
    term = pty.spawn(interpreter, spawnArgs, {
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
    // 清理本次会话的临时脚本文件（失败不致命）
    if (scriptBashPath) removeScriptFile(execId);
    bus.emit('exit', {
      execId,
      scriptId,
      exitCode: exitCode ?? null,
      signal: signal ?? null,
      sessionId,
    });
  });

  // 执行脚本：
  //  - bash 家族：把脚本内容先写入临时文件，再向 PTY 发送单行 `source` 命令。
  //    原因：直接把多行内容 write 进交互式 bash，bash 每读完一行不完整命令都会打印
  //    PS2 提示符 `>`，造成脚本输出前出现大量空行（用户反馈"多行形式/多余换行"）。
  //    用 source 单条命令即可避免 PS2，同时保留"脚本跑完继续在终端交互"的能力。
  //    `stty -echo` 已关掉命令回显，因此 `source ...` 这一行本身也不会显示。
  //    哨兵 echo 与恢复回显接在同一行，确保只输出一个可交互提示符。
  //  - 非 bash 家族：沿用旧方案（脚本 + 独立哨兵行，由 sentinelFilter 处理回显/清行）。
  let doneMarker = null;
  let scriptBashPath = null;
  if (content) {
    try {
      if (bashLike) {
        scriptBashPath = ensureScriptFile(execId, content, interpreter);
        term.write(`source "${scriptBashPath}"; echo "${doneToken}"; stty echo\n`);
      } else {
        term.write(content + '\n');
      }
    } catch {
      /* 会话异常时写入可能抛错，忽略 */
    }
  } else if (bashLike) {
    // 无脚本：直接输出哨兵并恢复回显，保持可交互（回显在 init 里被关掉）
    try {
      term.write(`echo "${doneToken}"; stty echo\n`);
    } catch {
      /* noop */
    }
  }

  if (!bashLike) {
    // 完成探测哨兵（仅非 bash：命令回显 + ANSI 清行由 sentinelFilter 处理）。
    //   `\x1b[2K\r\x1b[2K; echo "<TOKEN>"`：前导清行序列消除脚本后的多余 PS1，
    //   渲染层 sentinelFilter 整段 drop（回显行 + 输出行）。
    doneMarker = `\x1b[2K\r\x1b[2K; echo "${doneToken}"`;
    try {
      term.write(doneMarker + '\n');
    } catch {
      /* 会话异常时写入可能抛错，忽略 */
    }
  }

  ctxLogger.info('PTY 会话已创建（交互式）', { sessionId, interpreter, bashLike });
  return { sessionId, doneToken, doneMarker, interpreter, args: spawnArgs };
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
