// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import scriptsRoutes from '../server/scripts-routes.js';

// 单一数据源验证：scripts-routes 直接复用 server/scripts-store（写 scripts.json）。
// 用临时 userData 目录跑真实 HTTP 接口，确认分组重排的后端可用。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easyops-scriptstest-'));
process.env.EASY_OPS_USER_DATA = tmp;

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  scriptsRoutes.registerScriptsRoutes(app);
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

describe('scripts API (backend)', () => {
  it('初始 GET /api/scripts 含默认分组', async () => {
    const res = await fetch(`${base}/api/scripts`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.groups)).toBe(true);
    expect(data.groups).toContain(data.defaultGroup);
  });

  it('新增两个分组后可重排顺序', async () => {
    // 新增 backend / frontend 两个分组
    await fetch(`${base}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'backend' }),
    });
    await fetch(`${base}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'frontend' }),
    });
    const before = await (await fetch(`${base}/api/scripts`)).json();
    expect(before.groups).toContain('backend');
    expect(before.groups).toContain('frontend');

    // 重排：默认分组置顶，frontend 提到 backend 之前
    const reorder = await fetch(`${base}/api/groups/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: [before.defaultGroup, 'frontend', 'backend'] }),
    });
    expect(reorder.ok).toBe(true);
    const after = await reorder.json();
    expect(after.groups).toEqual([after.defaultGroup, 'frontend', 'backend']);

    // 持久化确认：再次 GET 仍为新顺序
    const persisted = await (await fetch(`${base}/api/scripts`)).json();
    expect(persisted.groups).toEqual([persisted.defaultGroup, 'frontend', 'backend']);
  });

  it('默认分组可重排到非首位并持久化', async () => {
    const data = await (await fetch(`${base}/api/scripts`)).json();
    const dg = data.defaultGroup;
    // 重排：把默认分组放到 backend 之后（不再强制置顶）
    const reorder = await fetch(`${base}/api/groups/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ['backend', dg, 'frontend'] }),
    });
    expect(reorder.ok).toBe(true);
    const after = await reorder.json();
    expect(after.groups).toEqual(['backend', dg, 'frontend']);

    const persisted = await (await fetch(`${base}/api/scripts`)).json();
    expect(persisted.groups).toEqual(['backend', persisted.defaultGroup, 'frontend']);
  });

  it('缺项集合的重排请求应被拒绝（400）', async () => {
    const res = await fetch(`${base}/api/groups/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ['Default'] }), // 缺 backend / frontend
    });
    expect(res.ok).toBe(false);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('空 / 非数组 order 应被拒绝（400）', async () => {
    const empty = await fetch(`${base}/api/groups/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: [] }),
    });
    expect(empty.ok).toBe(false);
    const noArray = await fetch(`${base}/api/groups/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: 'frontend' }),
    });
    expect(noArray.ok).toBe(false);
  });
});
