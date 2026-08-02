'use strict';

/**
 * Shell 配置持久化（userData/shell-config.json）
 * ------------------------------------------------------------------
 * 字段：
 *   noShellMode     boolean  模拟无 shell 安装（仅测试）
 *   shells          Array<{ path, name?, version?, custom? }>  自定义补充 shell 列表
 *   activeShellPath string|null  当前使用的 shell 路径（null = 跟随自动检测的默认）
 *
 * 读 / 写都是无副作用的小函数；缺失文件或解析失败时回退到默认空配置，
 * 由调用方决定何时落盘。
 */

const fs = require('fs');
const path = require('path');

// 缺省空配置（文件缺失 / 解析失败时回退）
const EMPTY_CONFIG = Object.freeze({ noShellMode: false, shells: [], activeShellPath: null });

function getPath(userDataDir) {
  return path.join(userDataDir, 'shell-config.json');
}

function normalize(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const activeShellPath =
    typeof safe.activeShellPath === 'string' ? safe.activeShellPath || null : null;
  return {
    noShellMode: Boolean(safe.noShellMode),
    shells: Array.isArray(safe.shells)
      ? safe.shells
          .filter((s) => s && typeof s.path === 'string')
          .map((s) => ({
            path: s.path,
            name: typeof s.name === 'string' ? s.name : null,
            version: typeof s.version === 'string' ? s.version : null,
            custom: Boolean(s.custom),
          }))
      : [],
    activeShellPath,
  };
}

function read(userDataDir) {
  try {
    const raw = fs.readFileSync(getPath(userDataDir), 'utf8');
    return normalize(JSON.parse(raw));
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

function write(userDataDir, data) {
  const safe = normalize(data);
  fs.writeFileSync(getPath(userDataDir), JSON.stringify(safe, null, 2), 'utf8');
}

/**
 * 读-改-写：读取当前配置，交给 mutator 就地修改，再落盘，返回修改后的配置。
 * 适用于没有"提前返回、跳过落盘"需求的场景（如 setNoShellMode / setActive）。
 */
function update(userDataDir, mutator) {
  const cfg = read(userDataDir);
  mutator(cfg);
  write(userDataDir, cfg);
  return cfg;
}

/**
 * 从自定义 shell 列表中移除一条（按 path）。
 * - 被移除项若恰为当前激活 shell，则一并清空 activeShellPath（由调用方判断"激活不可移除"）。
 * - 仅作用于自定义列表；系统自动检测的 shell 不在本配置内，无需移除。
 * 返回是否发生过移除。
 */
function removeShell(userDataDir, filePath) {
  const cfg = read(userDataDir);
  const before = cfg.shells.length;
  cfg.shells = cfg.shells.filter((s) => s.path !== filePath);
  const removed = cfg.shells.length < before;
  if (removed && cfg.activeShellPath === filePath) cfg.activeShellPath = null;
  write(userDataDir, cfg);
  return removed;
}

module.exports = { getPath, read, write, update, normalize, removeShell };