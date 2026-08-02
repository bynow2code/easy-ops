'use strict';

/**
 * Shell REST 路由（Express）
 * ------------------------------------------------------------------
 * 把"后端检测到的 shell + 用户自定义 shell"通过 HTTP 暴露给前端，
 * 成为前后端连接的真实接口。复用 server/shell-detect（探测）与
 * server/shell-config（持久化），单一数据源——只有这里会写 shell-config.json。
 *
 * 路由：
 *   GET    /api/shells                 列出（检测 + 自定义合并），含 noShellMode / activeShellPath
 *   POST   /api/shells        {path}   新增自定义 shell（校验存在/可执行/受支持 + 去重）
 *   DELETE /api/shells        {path}   移除自定义 shell（激活的不可移除）
 *   POST   /api/shells/active {path}   设置当前 shell（null = 跟随自动检测默认）
 *   POST   /api/shells/no-shell-mode {value} 切换"无 shell 模式"
 *
 * 注意：探测本身只读、带 2s 超时；本模块不依赖 Electron，可独立运行与测试。
 */

const path = require('path');
const shellDetect = require('./shell-detect');
const shellCfg = require('./shell-config');
const config = require('./config');

// 检测项 + 自定义项合并去重，回填 platform/posix，统一输出结构
function loadShells(userDataDir) {
  const cfg = shellCfg.read(userDataDir);
  if (cfg.noShellMode) return { noShellMode: true, shells: [], activeShellPath: null };

  const detected = shellDetect.detect();
  // 自定义项补 platform / posix 标记，使设置页标签与探测项一致
  const custom = cfg.shells.map((s) => ({
    ...s,
    custom: true,
    platform: process.platform,
    posix: /(bash|zsh|sh|fish|wsl)/i.test(s.path || ''),
  }));
  const map = new Map();
  [...detected, ...custom].forEach((s) => {
    if (!map.has(s.path)) map.set(s.path, s);
  });
  return {
    noShellMode: false,
    shells: Array.from(map.values()),
    // activeShellPath 为 null 表示"跟随系统默认 shell"：解析成真实路径返回前端，
    // 避免前端回退到检测列表首个（/bin/bash），从而真正跟随用户默认（如 /bin/zsh）。
    // 注意：此处只读、不改写 config（仅用户显式 POST /active 才持久化）。
    activeShellPath: cfg.activeShellPath || shellDetect.getDefaultShellPath(),
  };
}

function validatePath(p) {
  return typeof p === 'string' && p ? null : { ok: false, error: 'Empty path' };
}

function registerShellRoutes(app) {
  // userData 目录延迟读取：允许调用方在 require 之前通过 env 注入
  const userDataDir = () => config.getUserDataDir();

  app.get('/api/shells', (_req, res) => {
    res.json(loadShells(userDataDir()));
  });

  app.post('/api/shells', (req, res) => {
    const p = req.body && req.body.path;
    const v = shellDetect.validateCustomShellPath(p);
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

    const cfg = shellCfg.read(userDataDir());
    if (cfg.shells.some((s) => s.path === p)) {
      return res.status(409).json({ ok: false, error: 'Already added' });
    }
    cfg.shells.push({ path: p, name: path.basename(p), custom: true });
    shellCfg.write(userDataDir(), cfg);
    res.json({ ok: true, shells: loadShells(userDataDir()).shells });
  });

  app.delete('/api/shells', (req, res) => {
    const p = req.body && req.body.path;
    const argErr = validatePath(p);
    if (argErr) return res.status(400).json(argErr);

    const cfg = shellCfg.read(userDataDir());
    if (!cfg.shells.some((s) => s.path === p)) {
      return res.status(404).json({ ok: false, error: 'Shell not found' });
    }
    if (cfg.activeShellPath === p) {
      return res.status(409).json({ ok: false, error: 'Cannot remove the active shell' });
    }
    shellCfg.removeShell(userDataDir(), p);
    const st = loadShells(userDataDir());
    res.json({
      ok: true,
      noShellMode: st.noShellMode,
      shells: st.shells,
      activeShellPath: st.activeShellPath,
    });
  });

  app.post('/api/shells/active', (req, res) => {
    const p = req.body && req.body.path;
    if (p) {
      const found = loadShells(userDataDir()).shells.find((s) => s.path === p);
      if (!found) return res.status(404).json({ ok: false, error: 'Shell not in list' });
    }
    shellCfg.update(userDataDir(), (c) => {
      c.activeShellPath = p || null; // 跟随默认
      c.noShellMode = false; // 显式选 shell 自动退出无 shell 模式
    });
    const st = loadShells(userDataDir());
    res.json({
      ok: true,
      noShellMode: st.noShellMode,
      shells: st.shells,
      activeShellPath: st.activeShellPath,
    });
  });

  app.post('/api/shells/no-shell-mode', (req, res) => {
    const value = !!(req.body && req.body.value);
    shellCfg.update(userDataDir(), (c) => {
      c.noShellMode = value;
      if (value) c.activeShellPath = null; // 切到无 shell 时清掉当前
    });
    const st = loadShells(userDataDir());
    res.json({
      ok: true,
      noShellMode: st.noShellMode,
      shells: st.shells,
      activeShellPath: st.activeShellPath,
    });
  });
}

module.exports = { registerShellRoutes, loadShells };
