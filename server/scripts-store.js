'use strict';

/**
 * 脚本仓库持久化（userData/scripts.json）
 * ------------------------------------------------------------------
 * 字段：
 *   scripts  Array<{ id, name, group, content, shell }>   脚本列表
 *   groups   Array<string>                                 分组名列表
 *
 * 设计要点：
 *   - 单一数据源：只有本模块（经 scripts-routes）会写 scripts.json，避免与
 *     前端 localStorage 双重写造成不一致（与 shell-config 同一套路）。
 *   - 只持久化"数据"：id/name/group/content/shell；运行期字段（status）不落盘。
 *   - 读 / 写都是无副作用的小函数；文件缺失 / 解析失败时回退到默认空仓库，
 *     调用方决定何时落盘。
 *   - 落盘前确保父目录存在（首次运行 userData 可能尚无 scripts.json）。
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

// 缺省空仓库（文件缺失 / 解析失败时回退）
const EMPTY_REPO = Object.freeze({ scripts: [], groups: [] });

function getPath() {
  return config.scriptsFile;
}

// 单条脚本字段清洗：缺 id/name/group 视为非法，返回 null 被丢弃
function normalizeScript(s) {
  if (!s || typeof s !== 'object') return null;
  const id = typeof s.id === 'string' ? s.id : null;
  const name = typeof s.name === 'string' ? s.name : null;
  const group = typeof s.group === 'string' ? s.group : null;
  if (!id || !name || !group) return null;
  return {
    id,
    name,
    group,
    content: typeof s.content === 'string' ? s.content : '',
    shell: typeof s.shell === 'string' && s.shell ? s.shell : 'global',
  };
}

function normalize(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const scripts = Array.isArray(safe.scripts)
    ? safe.scripts.map(normalizeScript).filter(Boolean)
    : [];
  const groups = Array.isArray(safe.groups)
    ? safe.groups.filter((g) => typeof g === 'string' && g.length > 0)
    : [];
  return { scripts, groups };
}

function read() {
  try {
    const raw = fs.readFileSync(getPath(), 'utf8');
    return normalize(JSON.parse(raw));
  } catch {
    return { scripts: [], groups: [] };
  }
}

function write(data) {
  const safe = normalize(data);
  // 目录可能尚不存在（首次运行），先确保存在再写入
  fs.mkdirSync(path.dirname(getPath()), { recursive: true });
  fs.writeFileSync(getPath(), JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

/**
 * 生成新脚本 id（前端可自带 id 以避免来回 id 不一致；此处仅作兜底）。
 */
function newId() {
  return `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 新增或更新一条脚本（按 id 判重）。
 * - 提供 id 且仓库中已存在 → 原地替换字段；
 * - 否则（无 id 或 id 不存在）→ 追加一条（自动补 id）。
 * 返回写入后的整条脚本记录。
 */
function upsertScript(script) {
  const repo = read();
  const rec = normalizeScript(script);
  if (!rec) return null;
  if (!rec.id || !repo.scripts.some((s) => s.id === rec.id)) {
    rec.id = rec.id || newId();
    repo.scripts.push(rec);
  } else {
    const idx = repo.scripts.findIndex((s) => s.id === rec.id);
    repo.scripts[idx] = rec;
  }
  write(repo);
  return rec;
}

// 删除一条脚本（按 id）。返回是否删除成功。
function removeScript(id) {
  const repo = read();
  const before = repo.scripts.length;
  repo.scripts = repo.scripts.filter((s) => s.id !== id);
  if (repo.scripts.length === before) return false;
  write(repo);
  return true;
}

// 新增分组（去重）。返回最新分组列表。
function addGroup(name) {
  if (typeof name !== 'string' || !name) return null;
  const repo = read();
  if (!repo.groups.includes(name)) repo.groups.push(name);
  write(repo);
  return repo.groups;
}

// 移除分组，并级联删除其下所有脚本。返回 { scripts, groups }。
function removeGroup(name) {
  const repo = read();
  repo.groups = repo.groups.filter((g) => g !== name);
  repo.scripts = repo.scripts.filter((s) => s.group !== name);
  write(repo);
  return { scripts: repo.scripts, groups: repo.groups };
}

module.exports = {
  getPath,
  read,
  write,
  normalize,
  normalizeScript,
  upsertScript,
  removeScript,
  addGroup,
  removeGroup,
  newId,
};
