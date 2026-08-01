'use strict';

/**
 * Shell detection（纯函数式 + 探测副作用）
 * ------------------------------------------------------------------
 * 在常见路径下探测系统已安装的 shell 解释器；为每个候选调用 `--version`
 * 取首行作为版本说明。返回的数组不含重复；只保留可执行且能拿到版本信息的项。
 *
 * 设计要点：
 *  - 探测路径与平台绑定（macOS / Linux），Windows 暂不展开。
 *  - 探测本身只读、不写：可在调用方任意时机调用。
 *  - 每个 shell 探测带 2s 超时，避免坏路径卡住启动。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CANDIDATES_DARWIN = [
  '/bin/bash',
  '/bin/zsh',
  '/bin/sh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/bin/fish',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/usr/local/bin/fish',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
  '/opt/homebrew/bin/fish',
];

const CANDIDATES_LINUX = [
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

function candidates() {
  if (process.platform === 'darwin') return CANDIDATES_DARWIN;
  if (process.platform === 'linux') return CANDIDATES_LINUX;
  return []; // Windows 暂未实现
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
    const version = probeVersion(p);
    if (!version) continue;
    seen.add(p);
    out.push({ path: p, name: path.basename(p), version });
  }
  return out;
}

module.exports = { detect };