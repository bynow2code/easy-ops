'use strict';

/**
 * 脚本仓库持久化（userData/scripts.json）
 * ------------------------------------------------------------------
 * 字段：
 *   scripts      Array<{ id, name, group, content, shell }>   脚本列表
 *   groups       Array<string>                                 分组名列表
 *   defaultGroup string                                         内置默认分组名
 *
 * 设计要点：
 *   - 单一数据源：只有本模块（经 scripts-routes）会写 scripts.json，避免与
 *     前端 localStorage 双重写造成不一致（与 shell-config 同一套路）。
 *   - 只持久化"数据"：id/name/group/content/shell；运行期字段（status）不落盘。
 *   - 纯函数（normalize / applyXxx）承载全部业务变换，便于单测；读写（read/write）
 *     仅负责文件 IO 与无副作用的小包装。
 *   - 兼容性（name + content 为兼容底线）：
 *      · "本应用规范格式"= 同时具备 scripts[] / groups[] / defaultGroup 的配置，
 *        才信任其中的分组字段，按脚本实际引用的分组名补全 groups。
 *      · "外部/旧版配置"（裸数组、或缺少 groups/defaultGroup 的包装格式）视为只有
 *        name + content 可靠，其中的 group 字段不信任，全部脚本强制归入默认分组，
 *        并把配置重写回规范格式（见 read 的自愈写回）。老数据零丢失地迁移到新结构。
 *   - 落盘前确保父目录存在（首次运行 userData 可能尚无 scripts.json）。
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DEFAULT_GROUP = config.DEFAULT_GROUP || 'Default';

// 分组名长度限制（前后端一致）：最少 1、最多 10 个字符。
const GROUP_NAME_MIN = 1;
const GROUP_NAME_MAX = 10;

// 脚本名长度限制（前后端一致）：最少 1、最多 10 个字符。
const SCRIPT_NAME_MIN = 1;
const SCRIPT_NAME_MAX = 20;

function getPath() {
  return config.scriptsFile;
}

// 生成新脚本 id（前端可自带 id 以避免来回 id 不一致；此处仅作兜底）。
function newId() {
  return `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 单条脚本字段清洗（纯函数）。
 *  - name 是兼容底线，必须有（旧数据亦如此）；缺失整条丢弃。
 *  - id / group 可缺省：id 缺则就地生成，group 缺则留空串由 normalize 补默认分组。
 *  - content 缺省为空串（老导出格式同样只有 name/content）。
 */
function normalizeScript(s) {
  if (!s || typeof s !== 'object') return null;
  const rawId = typeof s.id === 'string' ? s.id : '';
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  if (!name) return null;
  const rawGroup = typeof s.group === 'string' && s.group ? s.group : '';
  const content = typeof s.content === 'string' ? s.content : '';
  const shell = typeof s.shell === 'string' && s.shell ? s.shell : 'global';
  return {
    id: rawId || newId(),
    name,
    group: rawGroup,
    content,
    shell,
  };
}

/**
 * 整仓归一化（纯函数）：兼容旧裸数组格式，落实默认分组与分组列表补全。
 * 返回 { scripts, groups, defaultGroup }，绝不抛错。
 *
 * 关键区分：只有"本应用规范格式"（同时具备 scripts[] / groups[] / defaultGroup）
 * 才信任其中的分组字段；其余外部/旧版配置视为只有 name+content 可靠，强制全部
 * 归入默认分组（对应需求：遇到只有 name+content 可用的配置，脚本全在 Default 里）。
 */
function normalize(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};

  // 是否为本应用规范格式：仅此情形信任分组字段，避免外部/旧版配置里不可靠的
  // group 被误当成真实分组。
  const isCanonical =
    Array.isArray(safe.scripts) &&
    Array.isArray(safe.groups) &&
    typeof safe.defaultGroup === 'string' &&
    safe.defaultGroup.length > 0;

  // 旧版（bare array）或新版（{scripts}）统一抽取脚本数组
  const scriptsInput = Array.isArray(safe) ? safe : Array.isArray(safe.scripts) ? safe.scripts : [];

  // 默认分组名：优先沿用已存的，否则落盘兜底常量
  const defaultGroup =
    typeof safe.defaultGroup === 'string' && safe.defaultGroup ? safe.defaultGroup : DEFAULT_GROUP;

  // 分组列表：优先沿用已存的，并确保默认分组在列（置顶）
  let groups = Array.isArray(safe.groups)
    ? safe.groups.filter((g) => typeof g === 'string' && g.length > 0)
    : [];
  if (!groups.includes(defaultGroup)) groups.unshift(defaultGroup);

  // 逐条清洗；规范格式下尊重脚本自带分组（并补进列表），缺失分组则归默认；
  // 非规范（外部/旧版）配置不信任分组字段，一律归入默认分组。
  const scripts = [];
  for (const item of scriptsInput) {
    const rec = normalizeScript(item);
    if (!rec) continue;
    if (!isCanonical) {
      rec.group = defaultGroup;
    } else if (!rec.group) {
      rec.group = defaultGroup;
    } else if (!groups.includes(rec.group)) {
      groups.push(rec.group);
    }
    scripts.push(rec);
  }

  return { scripts, groups, defaultGroup };
}

/**
 * 读取仓库并归一化。
 *  - correct=true（默认）：若磁盘原始内容非规范格式（裸数组 / 缺 groups / 含多余
 *    字段 / 外部配置等），读取后立即重写回规范格式（自愈），保证后续读取稳定、
 *    界面分组一致。仅当文件已存在且确实需要纠正时才写盘，不凭空新建；写盘失败
 *    不阻塞本次读取。
 *  - correct=false：纯读取，不写盘（测试或需只读场景用）。
 */
function read({ correct = true } = {}) {
  let rawText = null;
  try {
    rawText = fs.readFileSync(getPath(), 'utf8');
  } catch {
    return { scripts: [], groups: [DEFAULT_GROUP], defaultGroup: DEFAULT_GROUP };
  }
  let repo;
  try {
    repo = normalize(JSON.parse(rawText));
  } catch {
    return { scripts: [], groups: [DEFAULT_GROUP], defaultGroup: DEFAULT_GROUP };
  }
  if (correct) {
    const canonical = JSON.stringify(
      { scripts: repo.scripts, groups: repo.groups, defaultGroup: repo.defaultGroup },
      null,
      2,
    );
    // 仅当与规范格式存在差异时才重写，已规范的配置不重复写盘
    if (canonical !== rawText.trim()) {
      try {
        fs.mkdirSync(path.dirname(getPath()), { recursive: true });
        fs.writeFileSync(getPath(), canonical, 'utf8');
      } catch {
        /* 纠正失败不阻塞读取 */
      }
    }
  }
  return repo;
}

function write(repo) {
  const safe = normalize(repo);
  // 目录可能尚不存在（首次运行），先确保存在再写入
  fs.mkdirSync(path.dirname(getPath()), { recursive: true });
  fs.writeFileSync(
    getPath(),
    JSON.stringify(
      { scripts: safe.scripts, groups: safe.groups, defaultGroup: safe.defaultGroup },
      null,
      2,
    ),
    'utf8',
  );
  return safe;
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
  // 脚本名长度须落在 [SCRIPT_NAME_MIN, SCRIPT_NAME_MAX]，越界拒绝（不写盘）
  if (rec.name.length < SCRIPT_NAME_MIN || rec.name.length > SCRIPT_NAME_MAX) return null;
  const idx = repo.scripts.findIndex((s) => s.id === rec.id);
  if (idx >= 0) {
    repo.scripts[idx] = rec;
  } else {
    repo.scripts.push(rec);
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

// 新增分组（去重）。返回最新分组列表；分组名须在 [GROUP_NAME_MIN, GROUP_NAME_MAX]
// 范围内，否则返回 null（拒绝）。
function addGroup(rawName) {
  if (typeof rawName !== 'string') return null;
  const name = rawName.trim();
  if (name.length < GROUP_NAME_MIN || name.length > GROUP_NAME_MAX) return null;
  const repo = read();
  if (!repo.groups.includes(name)) repo.groups.push(name);
  write(repo);
  return repo.groups;
}

/**
 * 移除分组（纯函数）：默认分组不可删，返回 null 表示拒绝。
 *  - deleteScripts=false（默认）：该组脚本挪到默认分组，不丢失；
 *  - deleteScripts=true：连同该组脚本一并删除。
 */
function applyRemoveGroup(repo, name, deleteScripts = false) {
  // 非法 name（非字符串/空）一律拒绝，返回 null——与前端镜像 removeGroupFromRepo 语义一致，
  // 避免被调用方当成"成功（无变更）"而误写盘。
  if (typeof name !== 'string' || !name) return null;
  if (name === repo.defaultGroup) return null; // 默认分组不可删
  const scripts = deleteScripts
    ? repo.scripts.filter((s) => s.group !== name)
    : repo.scripts.map((s) => (s.group === name ? { ...s, group: repo.defaultGroup } : s));
  const groups = repo.groups.filter((g) => g !== name);
  return { scripts, groups, defaultGroup: repo.defaultGroup };
}

function removeGroup(name, options = {}) {
  const repo = read();
  const next = applyRemoveGroup(repo, name, options.deleteScripts);
  if (!next) return null;
  write(next);
  return next;
}

/**
 * 重命名分组（纯函数）：
 *  - 默认分组重命名：同步更新 defaultGroup 与所有引用，允许改成任意非空名（含与其他重名时强制唯一）；
 *  - 普通分组重命名：若新名已存在则拒绝（返回 null）。
 */
function applyRenameGroup(repo, oldName, newName) {
  if (typeof oldName !== 'string' || !oldName) return repo;
  if (typeof newName !== 'string' || !newName.trim()) return repo;
  newName = newName.trim();
  // 分组名长度须落在 [GROUP_NAME_MIN, GROUP_NAME_MAX]，越界视为非法入参（拒绝）
  if (newName.length < GROUP_NAME_MIN || newName.length > GROUP_NAME_MAX) return repo;
  const isDefault = oldName === repo.defaultGroup;
  if (!isDefault && repo.groups.includes(newName)) return repo; // 普通分组重名拒绝（返回原引用）
  // 默认分组若撞名，强制唯一：自动追加后缀
  let finalName = newName;
  if (isDefault && newName !== oldName && repo.groups.includes(newName)) {
    let i = 2;
    while (repo.groups.includes(`${newName} (${i})`)) i += 1;
    finalName = `${newName} (${i})`;
  }
  let groups = repo.groups.map((g) => (g === oldName ? finalName : g));
  // 默认分组重命名时确保新名在列（旧名可能因异常缺失）
  if (isDefault && !groups.includes(finalName)) groups = [...groups, finalName];
  const scripts = repo.scripts.map((s) => (s.group === oldName ? { ...s, group: finalName } : s));
  return { scripts, groups, defaultGroup: isDefault ? finalName : repo.defaultGroup };
}

function renameGroup(oldName, newName) {
  const repo = read();
  // applyRenameGroup 对非法入参返回原 repo 引用（无变化），有效入参返回新对象。
  const next = applyRenameGroup(repo, oldName, newName);
  if (next === repo) return null; // 非法入参 / 无变化 → 拒绝
  write(next);
  return next;
}

/**
 * 重排分组顺序（纯函数）：只动 groups 列表顺序，脚本与默认分组名不变。
 *  - orderedNames 必须是当前 groups 的全集（同元素、无重复），否则返回 null（拒绝），
 *    防止前端传错导致分组丢失或混入多余项。
 *  - 顺序即用户拖拽结果（含默认分组可落任意位置），原样采用，不做强制置顶。
 *    默认分组的"不可删除"由 removeGroup 单独保证，与排序位置解耦。
 */
function applyReorderGroups(repo, orderedNames) {
  if (!Array.isArray(orderedNames)) return null;
  const names = orderedNames.map((n) => (typeof n === 'string' ? n : ''));
  if (names.some((n) => !n)) return null; // 含非字符串 / 空串 → 拒绝
  const unique = [...new Set(names)];
  if (unique.length !== names.length) return null; // 有重复 → 拒绝
  const set = new Set(repo.groups);
  if (unique.length !== repo.groups.length) return null; // 集合大小不一致 → 拒绝
  if (!unique.every((n) => set.has(n))) return null; // 元素不完全是已知分组 → 拒绝
  // 原样采用传入顺序（默认分组可落任意位置），与前端 computeGroupReorder 同源语义。
  return { scripts: repo.scripts, groups: names, defaultGroup: repo.defaultGroup };
}

function reorderGroups(orderedNames) {
  const repo = read();
  const next = applyReorderGroups(repo, orderedNames);
  if (!next) return null; // 非法顺序 → 拒绝（不写盘）
  write(next);
  return next;
}

/**
 * 批量导入脚本（纯函数）：以"新版本为主"，导入文件只需 name + content。
 * 每条记录缺 id 则生成新 id；缺 group 归入默认分组；按 id 去重（存在则覆盖）。
 */
function applyImport(repo, incoming) {
  const items = Array.isArray(incoming) ? incoming : [];
  const scripts = repo.scripts.slice();
  for (const it of items) {
    const name = it && typeof it.name === 'string' ? it.name.trim() : '';
    if (!name) continue;
    const rec = {
      id: it && typeof it.id === 'string' && it.id ? it.id : newId(),
      name,
      group: repo.defaultGroup,
      content: it && typeof it.content === 'string' ? it.content : '',
      shell: 'global',
    };
    const idx = scripts.findIndex((s) => s.id === rec.id);
    if (idx >= 0) scripts[idx] = rec;
    else scripts.push(rec);
  }
  return { scripts, groups: repo.groups, defaultGroup: repo.defaultGroup };
}

function importScripts(incoming) {
  const repo = read();
  const next = applyImport(repo, incoming);
  write(next);
  return next;
}

module.exports = {
  DEFAULT_GROUP,
  GROUP_NAME_MIN,
  GROUP_NAME_MAX,
  SCRIPT_NAME_MIN,
  SCRIPT_NAME_MAX,
  getPath,
  newId,
  normalize,
  normalizeScript,
  applyRemoveGroup,
  applyRenameGroup,
  applyReorderGroups,
  applyImport,
  read,
  write,
  upsertScript,
  removeScript,
  addGroup,
  removeGroup,
  renameGroup,
  reorderGroups,
  importScripts,
};
