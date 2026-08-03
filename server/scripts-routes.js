'use strict';

/**
 * 脚本仓库 REST 路由（Express）
 * ------------------------------------------------------------------
 * 成为前后端连接的真实接口，是 scripts.json 的唯一写方（与 shell-routes
 * 对 shell-config.json 同一套路）。复用 server/scripts-store 做持久化。
 *
 * 路由：
 *   GET    /api/scripts                列出 { scripts, groups, defaultGroup }
 *   POST   /api/scripts                { id?, name, group, content?, shell? }
 *                                          按 id 新增或更新一条脚本；name/group 必填
 *   DELETE /api/scripts                { id }  删除一条脚本
 *   POST   /api/scripts/import         { scripts: [{ id?, name, content }] }
 *                                          批量导入（只需 name+content，归入默认分组）
 *   POST   /api/groups                 { name }  新增分组（去重）
 *   PATCH  /api/groups                 { oldName, newName }  重命名分组
 *   PATCH  /api/groups/reorder         { order: string[] }  重排分组顺序（含默认分组，可落任意位置）
 *   DELETE /api/groups                 { name, deleteScripts? }
 *                                          移除分组；默认分组不可删；
 *                                          deleteScripts=false（默认）其下脚本挪到默认分组，
 *                                          deleteScripts=true 连同脚本一并删除
 *
 * 不依赖 Electron，可独立运行与测试。
 */

const store = require('./scripts-store');

function badRequest(res, error) {
  return res.status(400).json({ ok: false, error });
}

// 统一的仓库响应构造：回传脚本/分组/默认分组三项，供多个写操作后复用。
function replyRepo(res, repo) {
  res.json({
    ok: true,
    scripts: repo.scripts,
    groups: repo.groups,
    defaultGroup: repo.defaultGroup,
  });
}

function registerScriptsRoutes(app) {
  // 列出全部脚本与分组
  app.get('/api/scripts', (_req, res) => {
    const repo = store.read();
    replyRepo(res, repo);
  });

  // 新增 / 更新一条脚本（按 id 判重）
  app.post('/api/scripts', (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const group = typeof body.group === 'string' ? body.group.trim() : '';
    if (!name) return badRequest(res, 'Script name is required');
    if (name.length < store.SCRIPT_NAME_MIN || name.length > store.SCRIPT_NAME_MAX) {
      return badRequest(
        res,
        `Script name must be ${store.SCRIPT_NAME_MIN}-${store.SCRIPT_NAME_MAX} characters`,
      );
    }
    if (!group) return badRequest(res, 'Group is required');

    const saved = store.upsertScript({
      id: body.id,
      name,
      group,
      content: typeof body.content === 'string' ? body.content : '',
      shell: typeof body.shell === 'string' ? body.shell : 'global',
    });
    if (!saved) return badRequest(res, 'Invalid script payload');
    res.json({ ok: true, script: saved });
  });

  // 删除一条脚本
  app.delete('/api/scripts', (req, res) => {
    const id = req.body && req.body.id;
    if (typeof id !== 'string' || !id) return badRequest(res, 'Script id is required');
    const removed = store.removeScript(id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Script not found' });
    res.json({ ok: true, id });
  });

  // 批量导入脚本（只需 name + content）：兼容裸数组 [{name,content,...}] 与包装 {scripts:[...]}
  app.post('/api/scripts/import', (req, res) => {
    const body = req.body || {};
    const incoming = Array.isArray(body) ? body : body.scripts;
    if (!Array.isArray(incoming)) return badRequest(res, 'scripts array is required');
    const repo = store.importScripts(incoming);
    replyRepo(res, repo);
  });

  // 新增分组
  app.post('/api/groups', (req, res) => {
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || !name.trim()) {
      return badRequest(res, 'Group name is required');
    }
    const trimmed = name.trim();
    if (trimmed.length < store.GROUP_NAME_MIN || trimmed.length > store.GROUP_NAME_MAX) {
      return badRequest(
        res,
        `Group name must be ${store.GROUP_NAME_MIN}-${store.GROUP_NAME_MAX} characters`,
      );
    }
    const groups = store.addGroup(trimmed);
    if (!groups) return badRequest(res, 'Group already exists');
    res.json({ ok: true, groups });
  });

  // 重命名分组（默认分组可重命名，普通分组不可与现有重名）
  app.patch('/api/groups', (req, res) => {
    const { oldName, newName } = req.body || {};
    if (typeof oldName !== 'string' || !oldName) {
      return badRequest(res, 'oldName is required');
    }
    if (typeof newName !== 'string' || !newName.trim()) {
      return badRequest(res, 'newName is required');
    }
    const trimmedNew = newName.trim();
    if (trimmedNew.length < store.GROUP_NAME_MIN || trimmedNew.length > store.GROUP_NAME_MAX) {
      return badRequest(
        res,
        `Group name must be ${store.GROUP_NAME_MIN}-${store.GROUP_NAME_MAX} characters`,
      );
    }
    const repo = store.renameGroup(oldName, trimmedNew);
    if (!repo) return badRequest(res, 'Cannot rename group (invalid or duplicate name)');
    // 注意：renameGroup 会同步该分组下所有脚本的 group 字段，故需把 scripts
    // 一并返回，否则前端拿不到更新后的脚本分组（重命名后脚本"消失"）。
    replyRepo(res, repo);
  });

  // 重排分组顺序：PATCH /api/groups/reorder { order: string[] }
  //   order 须为当前全部分组名（同集合、无重复），默认分组可落任意位置；
  //   原样采用传入顺序。非法顺序（缺项/重复/含未知分组）→ 400，不写盘。
  app.patch('/api/groups/reorder', (req, res) => {
    const order = req.body && req.body.order;
    if (!Array.isArray(order) || order.length === 0) {
      return badRequest(res, 'order array is required');
    }
    const repo = store.reorderGroups(order);
    if (!repo) return badRequest(res, 'Invalid group order');
    replyRepo(res, repo);
  });

  // 移除分组（默认分组不可删；脚本可一并删除或挪到默认分组）
  app.delete('/api/groups', (req, res) => {
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || !name) return badRequest(res, 'Group name is required');
    const deleteScripts = Boolean(req.body && req.body.deleteScripts);
    const repo = store.removeGroup(name, { deleteScripts });
    if (!repo) return badRequest(res, 'Default group cannot be deleted');
    replyRepo(res, repo);
  });
}

module.exports = { registerScriptsRoutes };
