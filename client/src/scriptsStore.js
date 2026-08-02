// 前端态（无 Electron 后端 / 后端不可达）脚本仓库的本地持久化。
// 纯 Vite 开发模式下没有主进程来落盘 scripts.json，
// 因此把脚本与分组存到 localStorage，保证 UI 仍能在重启后恢复。
// 与 shellStore 同一套路；一旦后端可达，应优先用后端（scriptsApi）。
import { DEFAULT_GROUP } from './constants.js';

const KEY = 'easy-ops.frontend-scripts';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { scripts: [], groups: [], defaultGroup: DEFAULT_GROUP };
    const obj = JSON.parse(raw);
    const scripts = Array.isArray(obj.scripts) ? obj.scripts : [];
    let groups = Array.isArray(obj.groups)
      ? obj.groups.filter((g) => typeof g === 'string' && g)
      : [];
    const defaultGroup =
      typeof obj.defaultGroup === 'string' && obj.defaultGroup ? obj.defaultGroup : DEFAULT_GROUP;
    if (!groups.includes(defaultGroup)) groups = [defaultGroup, ...groups];
    return { scripts, groups, defaultGroup };
  } catch {
    return { scripts: [], groups: [], defaultGroup: DEFAULT_GROUP };
  }
}

function write(repo) {
  try {
    const safe = read(); // 以现有值为底，避免缺字段
    const next = {
      scripts: Array.isArray(repo?.scripts) ? repo.scripts : safe.scripts,
      groups: Array.isArray(repo?.groups) ? repo.groups : safe.groups,
      defaultGroup: repo?.defaultGroup || safe.defaultGroup,
    };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 忽略 localStorage 不可用 / 配额异常
  }
}

// ---- 纯函数：无后端时在前端本地复刻后端变换（与 server/scripts-store 同源语义） ----

export function removeGroupFromRepo(repo, name, deleteScripts = false) {
  const defaultGroup = repo?.defaultGroup || DEFAULT_GROUP;
  if (!name || name === defaultGroup) return repo; // 默认分组不可删
  const scripts = deleteScripts
    ? (repo.scripts || []).filter((s) => s.group !== name)
    : (repo.scripts || []).map((s) => (s.group === name ? { ...s, group: defaultGroup } : s));
  const groups = (repo.groups || []).filter((g) => g !== name);
  return { scripts, groups, defaultGroup };
}

export function renameGroupInRepo(repo, oldName, newName) {
  if (!oldName || !newName || !newName.trim()) return repo;
  newName = newName.trim();
  const defaultGroup = repo?.defaultGroup || DEFAULT_GROUP;
  const isDefault = oldName === defaultGroup;
  if (!isDefault && (repo.groups || []).includes(newName)) return repo; // 普通分组重名拒绝
  const groups = (repo.groups || []).map((g) => (g === oldName ? newName : g));
  const scripts = (repo.scripts || []).map((s) =>
    s.group === oldName ? { ...s, group: newName } : s,
  );
  return { scripts, groups, defaultGroup: isDefault ? newName : defaultGroup };
}

export function importIntoRepo(repo, incoming) {
  const defaultGroup = repo?.defaultGroup || DEFAULT_GROUP;
  const items = Array.isArray(incoming) ? incoming : [];
  const scripts = (repo.scripts || []).slice();
  for (const it of items) {
    const name = it && typeof it.name === 'string' ? it.name.trim() : '';
    if (!name) continue;
    const rec = {
      id:
        it && typeof it.id === 'string' && it.id
          ? it.id
          : `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      group: defaultGroup,
      content: it && typeof it.content === 'string' ? it.content : '',
      shell: 'global',
    };
    const idx = scripts.findIndex((s) => s.id === rec.id);
    if (idx >= 0) scripts[idx] = rec;
    else scripts.push(rec);
  }
  return { scripts, groups: repo.groups || [], defaultGroup };
}

export function readFrontendScripts() {
  return read();
}

export function writeFrontendScripts(repo) {
  write(repo);
}
