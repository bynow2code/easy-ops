// @vitest-environment node
import { describe, it, expect } from 'vitest';
import store from '../server/scripts-store.js';

const { DEFAULT_GROUP, GROUP_NAME_MAX, SCRIPT_NAME_MIN, SCRIPT_NAME_MAX, normalize, applyRemoveGroup, applyRenameGroup, applyReorderGroups, applyImport, addGroup, upsertScript } = store;

describe('scripts-store: backward compatibility', () => {
  it('归一化旧版裸数组（无 groups、无 group 字段）→ 归入默认分组', () => {
    const raw = [
      { id: '1', name: 'PMS-DEV', content: '#!/bin/bash\necho hi' },
      { id: '2', name: 'No content' },
    ];
    const repo = normalize(raw);
    expect(repo.defaultGroup).toBe(DEFAULT_GROUP);
    expect(repo.groups).toContain(DEFAULT_GROUP);
    expect(repo.scripts).toHaveLength(2);
    repo.scripts.forEach((s) => expect(s.group).toBe(DEFAULT_GROUP));
    expect(repo.scripts[0].content).toBe('#!/bin/bash\necho hi');
  });

  it('旧版数组带 group 但无 groups 列表 → 不信任 group，强制归 Default', () => {
    const raw = [{ id: '1', name: 'Deploy', content: 'ls', group: 'backend' }];
    const repo = normalize(raw);
    // 外部/旧版配置（裸数组、缺 groups 列表）视为只有 name+content 可靠，
    // 其中的 group 字段不信任，脚本强制归入默认分组，多余字段不污染分组列表。
    expect(repo.groups).not.toContain('backend');
    expect(repo.groups).toContain(DEFAULT_GROUP);
    expect(repo.scripts[0].group).toBe(DEFAULT_GROUP);
  });

  it('包装格式 {scripts, groups, defaultGroup} 原样保留', () => {
    const raw = {
      scripts: [{ id: '1', name: 'A', content: 'x', group: 'g1' }],
      groups: ['g1'],
      defaultGroup: 'g1',
    };
    const repo = normalize(raw);
    expect(repo.defaultGroup).toBe('g1');
    expect(repo.groups).toContain('g1');
  });

  it('缺少 name 的条目被丢弃（name 是兼容底线）', () => {
    const repo = normalize([
      { id: '1', content: 'x' },
      { id: '2', name: 'ok', content: 'y' },
    ]);
    expect(repo.scripts).toHaveLength(1);
    expect(repo.scripts[0].name).toBe('ok');
  });

  it('缺 id 的脚本在归一化时生成新 id', () => {
    const repo = normalize([{ name: 'NoId', content: 'x' }]);
    expect(repo.scripts).toHaveLength(1);
    expect(typeof repo.scripts[0].id).toBe('string');
    expect(repo.scripts[0].id.length).toBeGreaterThan(0);
  });
});

describe('scripts-store: group delete (move vs delete)', () => {
  const base = {
    scripts: [
      { id: 'a', name: 'A', group: 'backend', content: 'x' },
      { id: 'b', name: 'B', group: 'frontend', content: 'y' },
    ],
    groups: ['backend', 'frontend'],
    defaultGroup: DEFAULT_GROUP,
  };

  it('默认分组不可删 → 返回 null', () => {
    expect(applyRemoveGroup(base, DEFAULT_GROUP)).toBe(null);
  });

  it('不勾选「一并删除」→ 脚本挪到默认分组而非丢失', () => {
    const next = applyRemoveGroup(base, 'backend', false);
    expect(next.groups).not.toContain('backend');
    expect(next.scripts.find((s) => s.id === 'a').group).toBe(DEFAULT_GROUP);
    expect(next.scripts).toHaveLength(2); // 未删除
  });

  it('勾选「一并删除」→ 连同脚本删除', () => {
    const next = applyRemoveGroup(base, 'backend', true);
    expect(next.groups).not.toContain('backend');
    expect(next.scripts.find((s) => s.id === 'a')).toBeUndefined();
    expect(next.scripts).toHaveLength(1);
  });
});

describe('scripts-store: group rename', () => {
  const base = {
    scripts: [{ id: 'a', name: 'A', group: 'backend', content: 'x' }],
    groups: ['backend', 'frontend'],
    defaultGroup: DEFAULT_GROUP,
  };

  it('重命名普通分组 → groups 更新，脚本引用同步', () => {
    const next = applyRenameGroup(base, 'backend', 'svc');
    expect(next.groups).toContain('svc');
    expect(next.groups).not.toContain('backend');
    expect(next.scripts.find((s) => s.id === 'a').group).toBe('svc');
  });

  it('普通分组重名 → 拒绝（返回原 repo 引用）', () => {
    expect(applyRenameGroup(base, 'backend', 'frontend')).toBe(base);
  });

  it('重命名默认分组 → defaultGroup 与脚本引用同步更新', () => {
    const next = applyRenameGroup(base, DEFAULT_GROUP, 'General');
    expect(next.defaultGroup).toBe('General');
    expect(next.groups).toContain('General');
    // 默认分组下没有脚本时，仅分组名变化
    expect(next.scripts.find((s) => s.id === 'a').group).toBe('backend');
  });
});

describe('scripts-store: group name length (1-10)', () => {
  const base = {
    scripts: [{ id: 'a', name: 'A', group: 'backend', content: 'x' }],
    groups: ['backend', 'frontend'],
    defaultGroup: DEFAULT_GROUP,
  };

  it('applyRenameGroup：边界 1 字符合法', () => {
    const next = applyRenameGroup(base, 'backend', 'a');
    expect(next).not.toBe(base);
    expect(next.groups).toContain('a');
  });

  it(`applyRenameGroup：边界 ${GROUP_NAME_MAX} 字符合法`, () => {
    const ok = 'x'.repeat(GROUP_NAME_MAX);
    const next = applyRenameGroup(base, 'backend', ok);
    expect(next).not.toBe(base);
    expect(next.groups).toContain(ok);
  });

  it(`applyRenameGroup：${GROUP_NAME_MAX + 1} 字符超长 → 拒绝（返回原 repo）`, () => {
    expect(applyRenameGroup(base, 'backend', 'x'.repeat(GROUP_NAME_MAX + 1))).toBe(base);
  });

  it('addGroup：空 / 空白 / 超长 → 返回 null（提前返回，不写盘）', () => {
    expect(addGroup('')).toBe(null);
    expect(addGroup('   ')).toBe(null);
    expect(addGroup('x'.repeat(GROUP_NAME_MAX + 1))).toBe(null);
  });
});

describe('scripts-store: script name length (1-20)', () => {
  it('upsertScript：空白/空 name → 返回 null（不写盘）', () => {
    expect(upsertScript({ name: '   ', group: DEFAULT_GROUP, content: 'x' })).toBe(null);
    expect(upsertScript({ name: '', group: DEFAULT_GROUP, content: 'x' })).toBe(null);
  });

  it(`upsertScript：超长（>${SCRIPT_NAME_MAX}）name → 返回 null（不写盘）`, () => {
    expect(upsertScript({ name: 'x'.repeat(SCRIPT_NAME_MAX + 1), group: DEFAULT_GROUP, content: 'x' })).toBe(null);
  });

  it('边界常量与需求一致（1-20）', () => {
    expect(SCRIPT_NAME_MIN).toBe(1);
    expect(SCRIPT_NAME_MAX).toBe(20);
  });
});

describe('scripts-store: group reorder', () => {
  const base = {
    scripts: [
      { id: 'a', name: 'A', group: 'backend', content: 'x' },
      { id: 'b', name: 'B', group: 'frontend', content: 'y' },
    ],
    groups: ['backend', 'frontend'],
    defaultGroup: DEFAULT_GROUP,
  };
  const full = { ...base, groups: [DEFAULT_GROUP, 'backend', 'frontend'] };

  it('合法重排 → 原样采用传入顺序（默认分组可落任意位置）', () => {
    const next = applyReorderGroups(full, [DEFAULT_GROUP, 'frontend', 'backend']);
    expect(next.groups).toEqual([DEFAULT_GROUP, 'frontend', 'backend']);
    expect(next.scripts).toHaveLength(2); // 脚本不受影响
  });

  it('默认分组可移动到非首位', () => {
    // 旧实现强制默认分组置顶；现改为尊重用户拖拽结果：default 落在中间仍被原样保留。
    const next = applyReorderGroups(full, ['backend', DEFAULT_GROUP, 'frontend']);
    expect(next.groups).toEqual(['backend', DEFAULT_GROUP, 'frontend']);
  });

  it('漏带默认分组 → 集合不完整，拒绝（返回 null）', () => {
    expect(applyReorderGroups(full, ['frontend', 'backend'])).toBe(null);
  });

  it('集合不一致（缺项/多余项）→ 拒绝（返回 null）', () => {
    expect(applyReorderGroups(full, [DEFAULT_GROUP, 'backend'])).toBe(null);
    expect(applyReorderGroups(full, [DEFAULT_GROUP, 'backend', 'frontend', 'extra'])).toBe(null);
  });

  it('含重复项 → 拒绝（返回 null）', () => {
    expect(applyReorderGroups(full, [DEFAULT_GROUP, 'backend', 'backend', 'frontend'])).toBe(null);
  });

  it('含非字符串 / 空串 → 拒绝（返回 null）', () => {
    expect(applyReorderGroups(full, [DEFAULT_GROUP, 'backend', ''])).toBe(null);
    expect(applyReorderGroups(full, [DEFAULT_GROUP, 'backend', 123])).toBe(null);
  });

  it('非数组入参 → 拒绝（返回 null）', () => {
    expect(applyReorderGroups(full, null)).toBe(null);
    expect(applyReorderGroups(full, 'backend')).toBe(null);
  });
});

describe('scripts-store: import', () => {
  const base = {
    scripts: [{ id: 'existing', name: 'Keep', group: DEFAULT_GROUP, content: 'old' }],
    groups: [DEFAULT_GROUP],
    defaultGroup: DEFAULT_GROUP,
  };

  it('导入只需 name+content，归入默认分组，按 id 覆盖', () => {
    const next = applyImport(base, [
      { id: 'new1', name: 'Imported', content: 'echo 1' },
      { id: 'existing', name: 'Keep', content: 'updated' },
      { name: 'NoId', content: 'echo 2' },
    ]);
    expect(next.scripts.find((s) => s.id === 'new1').group).toBe(DEFAULT_GROUP);
    expect(next.scripts.find((s) => s.id === 'existing').content).toBe('updated');
    expect(next.scripts.some((s) => s.name === 'NoId')).toBe(true);
    // 无 name 的条目被忽略
    expect(next.scripts.every((s) => s.name)).toBe(true);
  });

  it('裸数组（非包装 {scripts}）也能导入并归 Default', () => {
    const next = applyImport(base, [
      { name: 'A', content: 'echo a' },
      { name: 'B', content: 'echo b' },
    ]);
    const imported = next.scripts.filter((s) => s.name === 'A' || s.name === 'B');
    expect(imported).toHaveLength(2);
    expect(imported.every((s) => s.group === DEFAULT_GROUP)).toBe(true);
  });
});
