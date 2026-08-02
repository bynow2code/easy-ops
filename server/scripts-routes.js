'use strict';

/**
 * 脚本仓库 REST 路由（Express）
 * ------------------------------------------------------------------
 * 成为前后端连接的真实接口，是 scripts.json 的唯一写方（与 shell-routes
 * 对 shell-config.json 同一套路）。复用 server/scripts-store 做持久化。
 *
 * 路由：
 *   GET    /api/scripts         列出 { scripts, groups }
 *   POST   /api/scripts         { id?, name, group, content?, shell? }
 *                                  按 id 新增或更新一条脚本；name/group 必填
 *   DELETE /api/scripts         { id }  删除一条脚本
 *   POST   /api/groups          { name }  新增分组（去重）
 *   DELETE /api/groups          { name }  移除分组（级联删除其下脚本）
 *
 * 不依赖 Electron，可独立运行与测试。
 */

const store = require('./scripts-store');

function badRequest(res, error) {
  return res.status(400).json({ ok: false, error });
}

function registerScriptsRoutes(app) {
  // 列出全部脚本与分组
  app.get('/api/scripts', (_req, res) => {
    const repo = store.read();
    res.json({ ok: true, scripts: repo.scripts, groups: repo.groups });
  });

  // 新增 / 更新一条脚本（按 id 判重）
  app.post('/api/scripts', (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const group = typeof body.group === 'string' ? body.group.trim() : '';
    if (!name) return badRequest(res, 'Script name is required');
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

  // 新增分组
  app.post('/api/groups', (req, res) => {
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || !name.trim()) {
      return badRequest(res, 'Group name is required');
    }
    const groups = store.addGroup(name.trim());
    if (!groups) return badRequest(res, 'Group name is required');
    res.json({ ok: true, groups });
  });

  // 移除分组（级联删除其下脚本）
  app.delete('/api/groups', (req, res) => {
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || !name) return badRequest(res, 'Group name is required');
    const { scripts, groups } = store.removeGroup(name);
    res.json({ ok: true, scripts, groups });
  });
}

module.exports = { registerScriptsRoutes };
