// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import shellRoutes from '../server/shell-routes.js';

// 单一数据源验证：shell-routes 直接复用 server/shell-detect + server/shell-config，
// 这里用临时 userData 目录跑一遍真实 HTTP 接口，确认前后端连接的"后端"可用。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easyops-shelltest-'));
process.env.EASY_OPS_USER_DATA = tmp;
// 一个"自定义"可执行壳：不在检测候选清单里，因此新增/删除完全由自定义列表控制，
// 避免与自动检测的 shell 混淆（否则 DELETE 后它仍会以 detected 身份出现）。
const fakeShell = path.join(tmp, 'fake-bash');
fs.writeFileSync(fakeShell, '#!/bin/sh\necho hi\n');
fs.chmodSync(fakeShell, 0o755);

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  shellRoutes.registerShellRoutes(app);
  await new Promise((resolve, reject) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.on('error', reject);
  });
});

afterAll(() => {
  if (server) server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('shell API (backend)', () => {
  it('GET /api/shells 返回检测到的 shell 列表', async () => {
    const res = await fetch(`${base}/api/shells`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.shells)).toBe(true);
    expect(typeof data.noShellMode).toBe('boolean');
    expect('activeShellPath' in data).toBe(true);
  });

  it('POST 再 DELETE 一个自定义 shell 可往返', async () => {
    const add = await fetch(`${base}/api/shells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fakeShell }),
    });
    const addData = await add.json();
    expect(addData.ok).toBe(true);
    expect(addData.shells.some((s) => s.path === fakeShell)).toBe(true);

    const del = await fetch(`${base}/api/shells`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fakeShell }),
    });
    const delData = await del.json();
    expect(delData.ok).toBe(true);
    expect(delData.shells.some((s) => s.path === fakeShell)).toBe(false);
  });

  it('新增不存在的路径应被拒绝', async () => {
    const res = await fetch(`${base}/api/shells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/no/such/shell-xyz' }),
    });
    expect(res.ok).toBe(false);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('POST /api/shells/active 可设置当前 shell', async () => {
    const shPath = '/bin/zsh'; // 系统检测到的 shell，必然在列表中
    const res = await fetch(`${base}/api/shells/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: shPath }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.activeShellPath).toBe(shPath);
    // 清理：还原为跟随默认
    await fetch(`${base}/api/shells/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: null }),
    });
  });

  it('新增一个目录应被拒绝（Not a file）', async () => {
    const res = await fetch(`${base}/api/shells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: tmp }), // tmp 本身是个目录
    });
    expect(res.ok).toBe(false);
    const data = await res.json();
    expect(data.error || '').toMatch(/Not a file/i);
  });

  it('新增不可执行文件应被拒绝（Not an executable）', async () => {
    const nonExec = path.join(tmp, 'not-exec.sh');
    fs.writeFileSync(nonExec, 'echo hi'); // 默认 0644，无执行位
    const res = await fetch(`${base}/api/shells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: nonExec }),
    });
    expect(res.ok).toBe(false);
    const data = await res.json();
    expect(data.error || '').toMatch(/Not an executable/i);
  });

  it('新增相对路径应被拒绝（must be absolute）', async () => {
    const res = await fetch(`${base}/api/shells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'relative/bash' }),
    });
    expect(res.ok).toBe(false);
    const data = await res.json();
    expect(data.error || '').toMatch(/absolute/i);
  });

  it('新增空路径应被拒绝（Empty path）', async () => {
    const res = await fetch(`${base}/api/shells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '' }),
    });
    expect(res.ok).toBe(false);
    const data = await res.json();
    expect(data.error || '').toMatch(/Empty path/i);
  });

  it('重复新增同一 shell 返回 409', async () => {
    const add1 = await fetch(`${base}/api/shells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fakeShell }),
    });
    expect((await add1.json()).ok).toBe(true);
    const add2 = await fetch(`${base}/api/shells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fakeShell }),
    });
    expect(add2.status).toBe(409);
    // 清理
    await fetch(`${base}/api/shells`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fakeShell }),
    });
  });

  it('Windows 上只接受 Git Bash / WSL（拒绝其他 exe）', async () => {
    const platformOrig = process.platform;
    const statSyncOrig = fs.statSync;
    const accessSyncOrig = fs.accessSync;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      // 桩：所有路径都"存在且可执行"，以便单独验证"Windows 仅支持 bash/wsl"分支
      fs.statSync = () => ({ isDirectory: () => false });
      fs.accessSync = () => undefined;

      const cmd = await fetch(`${base}/api/shells`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'C:\\Windows\\System32\\cmd.exe' }),
      });
      const cmdData = await cmd.json();
      expect(cmdData.ok).toBe(false);
      expect(cmdData.error || '').toMatch(/Git Bash or WSL/i);

      const bash = await fetch(`${base}/api/shells`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'C:\\Program Files\\Git\\bin\\bash.exe' }),
      });
      const bashData = await bash.json();
      expect(bashData.ok).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: platformOrig });
      fs.statSync = statSyncOrig;
      fs.accessSync = accessSyncOrig;
    }
  });
});
