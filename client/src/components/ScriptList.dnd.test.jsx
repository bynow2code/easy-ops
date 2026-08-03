// 回归测试：分组拖拽结束后，被拖分组不能永久残留 is-group-dragging（变灰）类。
// 复现并锁死 bug：移动分组后该组永久变灰。
// 根因曾为 handleReorderEnd 漏 setGroupDragName(null)，且分组头无 onDragEnd 兜底。
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  }
  // jsdom 默认 getBoundingClientRect 全 0，无法判定"上半/下半区"。给定高 20 的矩形（中点=10），
  // 使 clientY<=10 判定 before、>10 判定 after。
  Element.prototype.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    right: 0,
    bottom: 20,
    width: 0,
    height: 20,
    x: 0,
    y: 0,
    toJSON() {},
  });
});

vi.mock('../ptyClient.js', () => ({
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

const repoData = {
  scripts: [
    { id: 's1', name: 'Deploy', group: 'Default', content: 'echo hi', shell: 'global' },
    { id: 's2', name: 'Backup', group: 'Default', content: 'tar', shell: '/bin/bash' },
    { id: 's3', name: 'OpsTask', group: 'Ops', content: 'touch', shell: '/bin/bash' },
  ],
  groups: ['Default', 'Ops'],
  defaultGroup: 'Default',
};
const shellData = { shells: [], activeShellPath: null, noShellMode: false };

vi.mock('../apiClient.js', () => ({
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
vi.mock('../monaco/setup', () => ({
  monaco: { editor: { create: () => ({ dispose() {}, getValue: () => '', setValue() {}, onDidChangeModelContent: () => ({ dispose() {} }), updateOptions() {}, layout() {} }), defineTheme() {}, setTheme() {}, setModelLanguage() {} }, languages: { registerCompletionItemProvider: () => ({ dispose() {} }) } },
}));

import App from '../App.jsx';

function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

// 找第 idx 个分组的 head 元素，以及它所属的 .script-group 容器
function groupAt(container, idx) {
  const head = container.querySelectorAll('.script-group__head')[idx];
  const group = head.closest('.script-group');
  return { head, group };
}

// 分组标题顺序（DOM 中渲染的分组顺序）
function groupTitles(container) {
  return [...container.querySelectorAll('.script-group__title span')].map((s) => s.textContent);
}

// 某分组内脚本行的名称顺序
function scriptNamesInGroup(container, groupTitle) {
  const heads = [...container.querySelectorAll('.script-group__head')];
  const head = heads.find(
    (h) => h.querySelector('.script-group__title span')?.textContent === groupTitle,
  );
  const group = head.closest('.script-group');
  return [...group.querySelectorAll('.script-row__name')].map((n) => n.textContent);
}

// 某分组内指定名称脚本行
function rowByName(container, groupTitle, name) {
  const heads = [...container.querySelectorAll('.script-group__head')];
  const head = heads.find(
    (h) => h.querySelector('.script-group__title span')?.textContent === groupTitle,
  );
  const group = head.closest('.script-group');
  return [...group.querySelectorAll('.script-row')].find(
    (r) => r.querySelector('.script-row__name')?.textContent === name,
  );
}

const dt = () => ({ setData: () => {}, getData: () => '', effectAllowed: '' });

// jsdom 的 DragEvent 不把 clientY 写进 init（e.clientY 为 undefined → 位置判定恒为 after）。
// 直接把 clientY 作为属性挂到事件对象上，绕过该限制，使 positionFromEvent 能正确判定 before/after。
function dragOverAt(el, clientY, d) {
  const evt = new Event('dragover', { bubbles: true, cancelable: true });
  evt.clientY = clientY;
  evt.dataTransfer = d;
  fireEvent(el, evt);
}

describe('ScriptList group drag', () => {
  it('group is not stuck gray (is-group-dragging) after drag ends', async () => {
    const { container } = render(<App />);
    await flush();

    const heads = container.querySelectorAll('.script-group__head');
    expect(heads.length).toBeGreaterThanOrEqual(2);

    const { head, group } = groupAt(container, 0);

    // 模拟：开始拖拽第一个分组
    const dt = { setData: () => {}, getData: () => '', effectAllowed: '' };
    fireEvent.dragStart(head, { dataTransfer: dt });

    // 拖拽中应挂 is-group-dragging（变灰态）
    expect(group.className).toContain('is-group-dragging');

    // 模拟：拖拽结束（无论是否成功 drop）
    fireEvent.dragEnd(head);

    // 拖拽结束后必须清理：分组不再变灰
    const { group: groupAfter } = groupAt(container, 0);
    expect(groupAfter.className).not.toContain('is-group-dragging');
  });
});

describe('ScriptList before/after drop position', () => {
  it('拖分组悬停目标下半区 → 放到目标"下面"(after)', async () => {
    const { container } = render(<App />);
    await flush();
    expect(groupTitles(container)).toEqual(['Default', 'Ops']);

    const d = dt();
    const { head: head0 } = groupAt(container, 0); // Default
    fireEvent.dragStart(head0, { dataTransfer: d });

    // 悬停到 Ops 组容器下半区（clientY=18 > 中点10）→ after
    const { group: opsGroup } = groupAt(container, 1);
    dragOverAt(opsGroup, 18, d);
    fireEvent.drop(opsGroup, { dataTransfer: d });

    await flush();
    // Default 落到 Ops 之后 → [Ops, Default]
    expect(groupTitles(container)).toEqual(['Ops', 'Default']);
  });

  it('拖分组悬停目标上半区 → 放到目标"上面"(before)', async () => {
    const { container } = render(<App />);
    await flush();

    const d = dt();
    const { head: opsHead } = groupAt(container, 1); // Ops
    fireEvent.dragStart(opsHead, { dataTransfer: d });

    // 悬停到 Default 组容器上半区（clientY=2 < 中点10）→ before
    const { group: defaultGroup } = groupAt(container, 0);
    dragOverAt(defaultGroup, 2, d);
    fireEvent.drop(defaultGroup, { dataTransfer: d });

    await flush();
    // Ops 落到 Default 之前 → [Ops, Default]
    expect(groupTitles(container)).toEqual(['Ops', 'Default']);
  });

  it('拖脚本悬停目标行下半区 → 放到目标"下面"(after)', async () => {
    const { container } = render(<App />);
    await flush();
    // Default 组初始顺序：[Deploy, Backup]
    expect(scriptNamesInGroup(container, 'Default')).toEqual(['Deploy', 'Backup']);

    const d = dt();
    const rowDeploy = rowByName(container, 'Default', 'Deploy');
    fireEvent.dragStart(rowDeploy, { dataTransfer: d });

    // 悬停到 Backup 行下半区 → after
    const rowBackup = rowByName(container, 'Default', 'Backup');
    dragOverAt(rowBackup, 18, d);
    fireEvent.drop(rowBackup, { dataTransfer: d });

    await flush();
    // Deploy 放到 Backup 之后 → [Backup, Deploy]
    expect(scriptNamesInGroup(container, 'Default')).toEqual(['Backup', 'Deploy']);
  });

  it('拖脚本悬停目标行上半区 → 放到目标"上面"(before)', async () => {
    const { container } = render(<App />);
    await flush();
    expect(scriptNamesInGroup(container, 'Default')).toEqual(['Deploy', 'Backup']);

    const d = dt();
    const rowBackup = rowByName(container, 'Default', 'Backup');
    fireEvent.dragStart(rowBackup, { dataTransfer: d });

    // 悬停到 Deploy 行上半区 → before
    const rowDeploy = rowByName(container, 'Default', 'Deploy');
    dragOverAt(rowDeploy, 2, d);
    fireEvent.drop(rowDeploy, { dataTransfer: d });

    await flush();
    // Backup 放到 Deploy 之前 → [Backup, Deploy]
    expect(scriptNamesInGroup(container, 'Default')).toEqual(['Backup', 'Deploy']);
  });
});
