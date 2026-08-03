// 冒烟测试：在 jsdom 下渲染 <App/>，覆盖「空状态」与「已加载脚本/分组数据」两条路径，
// 捕获初始化渲染期抛出的运行时异常（React 渲染期未捕获异常会卸载整树 → 白屏）。
// 重型 / 浏览器专属模块（pty IPC、xterm、HTTP request）mock / 注入可控数据，
// 以隔离"应用渲染逻辑"与"基础设施"，避免环境性误报。
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  }
});

// 捕获 React 渲染期未捕获异常（无 ErrorBoundary 时 React 会以 console.error 报告，
// 并卸载整棵树 → 对应浏览器里的白屏）。收集所有 console.error 调用文本。
const errorLogs = [];
let errorSpy;
beforeAll(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errorLogs.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  errorLogs.length = 0;
});

vi.mock('./ptyClient.js', () => ({
  ptyClient: {
    available: false,
    open: vi.fn(() => Promise.reject(new Error('mock'))),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => () => {},
    onExit: () => () => {},
  },
}));

// request 由 apiClient 使用：按路径返回可控数据，模拟"后端已存脚本/分组"的成功响应。
const repoData = {
  scripts: [
    { id: 's1', name: 'Deploy DEV', group: 'Default', content: 'echo hi', shell: 'global' },
    { id: 's2', name: 'Backup', group: 'Ops', content: 'tar czf', shell: '/bin/bash' },
  ],
  groups: ['Default', 'Ops'],
  defaultGroup: 'Default',
};
const shellData = { shells: [], activeShellPath: null, noShellMode: false };

vi.mock('./apiClient.js', () => ({
  request: vi.fn((path) => {
    if (String(path).includes('/scripts')) return Promise.resolve(repoData);
    if (String(path).includes('/shells')) return Promise.resolve(shellData);
    return Promise.resolve({ ok: true });
  }),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    write() {}
    onData() {
      return { dispose() {} };
    }
    reset() {}
    dispose() {}
    set options(_v) {}
    get options() {
      return {};
    }
    get cols() {
      return 80;
    }
    get rows() {
      return 24;
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} loadAddon() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
// 故意不 mock ./monaco/setup：验证真实 monaco 模块级求值不抛错

import App from './App.jsx';

function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

describe('App smoke', () => {
  it('renders App with loaded scripts/groups without React render error', async () => {
    let thrown = null;
    let container;
    try {
      const r = render(<App />);
      container = r.container;
      await flush();
    } catch (err) {
      thrown = err;
    }

    // 渲染期异常不应被吞：若有抛错直接暴露
    expect(thrown, thrown && thrown.stack ? thrown.stack : 'App threw').toBeNull();

    // 关键断言：页面确实渲染出了脚本名（非白屏）
    expect(container.textContent).toContain('Deploy DEV');
    expect(container.textContent).toContain('Backup');

    // 不应出现 React 组件渲染期未捕获异常（白屏根因信号）
    const renderErrors = errorLogs.filter(
      (l) =>
        /Error:.|cannot read|is not a function|undefined is not|Invalid hook/i.test(l) &&
        !/not wrapped in act/.test(l),
    );
    expect(
      renderErrors,
      `React render errors detected:\n${renderErrors.join('\n')}`,
    ).toHaveLength(0);
  });
});
