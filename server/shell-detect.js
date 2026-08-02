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

module.exports = { detect, probeVersion };