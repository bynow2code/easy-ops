'use strict';

/**
 * Shell detection（纯函数式 + 探测副作用）
 * ------------------------------------------------------------------
 * 按平台探测系统已安装的 shell 解释器；为每个候选调用 `--version`
 * 取首行作为版本说明。返回的每一项带 platform / posix 标记，供设置页
 * 与运行期选择使用。
 *
 * 设计要点：
 *  - 探测路径与平台绑定（macOS / Linux / Windows）。
 *  - posix=true 表示可运行 POSIX sh 脚本（.sh）；Windows 的 cmd/powershell
 *    为 false（它们只认 .ps1/.bat）。
 *  - 探测本身只读、不写：可在调用方任意时机调用。
 *  - 每个 shell 探测带 2s 超时，避免坏路径卡住启动。
 *  - 只要文件存在且可执行即列入；--version 取不到时 version 为 null（仍可用）。
 */

const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

// 通用候选路径；darwin 额外包含 homebrew 安装位置
const BASE_CANDIDATES = [
  '/bin/bash',
  '/bin/zsh',
  '/bin/sh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/bin/fish',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/usr/local/bin/fish',
];

const DARWIN_EXTRA = [
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
  '/opt/homebrew/bin/fish',
];

// Windows 候选：能跑 .sh 的放前面作为默认（Git Bash 优先于 wsl）
const WIN32_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Windows\\System32\\wsl.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'C:\\Windows\\System32\\cmd.exe',
];

// Windows 默认优先级：仅 POSIX 受支持项（Git Bash > WSL）。
// 用于 getDefaultShellPath——在"真实已安装"的候选里按此顺序挑，避免默认指向不存在的路径。
const WIN_DEFAULT_PRIORITY = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Windows\\System32\\wsl.exe',
];

function candidates() {
  if (process.platform === 'darwin') return [...BASE_CANDIDATES, ...DARWIN_EXTRA];
  if (process.platform === 'linux') return BASE_CANDIDATES;
  if (process.platform === 'win32') return WIN32_CANDIDATES;
  return [];
}

// Windows 原生解释器（cmd / powershell）不能跑 .sh；其余视为 POSIX 环境
function classifyPosix(p) {
  if (/cmd\.exe$/i.test(p)) return false;
  if (/powershell/i.test(p)) return false;
  return true;
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// 自定义 shell 路径校验：确保加入的是"真实存在、可执行、且本软件能用"的解释器。
// 用于 POST /api/shells，防止把任意文件（.txt / 目录 / 不可执行 / 非受支持壳）加进列表。
// 返回 { ok: true } 或 { ok: false, error }（error 直接作为前端提示文案）。
function validateCustomShellPath(p) {
  if (typeof p !== 'string' || !p.trim()) {
    return { ok: false, error: 'Empty path' };
  }
  // 必须是绝对路径：相对路径会按进程 cwd 解析，极易歧义且不可复现
  const isAbs =
    process.platform === 'win32'
      ? /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
      : p.startsWith('/');
  if (!isAbs) {
    return { ok: false, error: 'Path must be absolute' };
  }
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return { ok: false, error: 'File not found' };
  }
  if (stat.isDirectory()) {
    return { ok: false, error: 'Not a file (looks like a directory)' };
  }
  if (!isExecutable(p)) {
    return { ok: false, error: 'Not an executable file' };
  }
  // Windows 仅支持 Git Bash 与 WSL 跑 .sh；其余（cmd / powershell / 任意 exe）明确拒绝。
  // 注意：Windows 的 X_OK 等价于 F_OK，故用文件名进一步约束为 bash/wsl 类解释器。
  if (process.platform === 'win32' && !/(bash|wsl)\.exe$/i.test(p)) {
    return { ok: false, error: 'Only Git Bash or WSL is supported on Windows' };
  }
  return { ok: true };
}

function probeVersion(p) {
  try {
    const out = execFileSync(p, ['--version'], { encoding: 'utf8', timeout: 2000 });
    const firstLine = String(out).split(/\r?\n/)[0];
    return firstLine ? firstLine.trim() : null;
  } catch {
    return null;
  }
}

function detect() {
  const seen = new Set();
  const out = [];
  for (const p of candidates()) {
    if (!isExecutable(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({
      path: p,
      // 跨平台取文件名（兼容 Windows 反斜杠路径）
      name: p.split(/[\\/]/).pop() || p,
      version: probeVersion(p) || null,
      platform: process.platform,
      posix: classifyPosix(p),
    });
  }
  return out;
}

// 解析"系统默认 shell"路径：优先取用户实际登录 shell（$SHELL / passwd），
// 检测不到时按平台兜底（macOS Catalina+ 默认 zsh，其余 bash / Windows Git Bash）。
// 既用于后端把 activeShellPath:null（"跟随默认"）解析成真实路径，也作为前端无显式选择时的默认。
function getDefaultShellPath() {
  if (process.platform === 'win32') {
    // Windows 仅支持 Git Bash 与 WSL 跑 .sh；默认优先级 Git Bash > WSL。
    // 自动获取：在"真实已安装（可执行）"的受支持候选里按优先级挑；
    // 一个都没装则兜底到 Git Bash 默认路径常量（仍可在设置里手动修正）。
    for (const p of WIN_DEFAULT_PRIORITY) {
      if (isExecutable(p)) return p;
    }
    return 'C:\\Program Files\\Git\\bin\\bash.exe';
  }
  const env = process.env.SHELL;
  if (typeof env === 'string' && env.trim()) return env.trim();
  try {
    const info = os.userInfo();
    if (info && typeof info.shell === 'string' && info.shell) return info.shell;
  } catch {
    // 个别环境（无 passwd 条目）os.userInfo 会抛错，忽略走平台兜底
  }
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

module.exports = { detect, probeVersion, getDefaultShellPath, validateCustomShellPath };