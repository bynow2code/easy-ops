import { describe, it, expect } from 'vitest';
import { resolveShellPath, resolveDisplayShell } from '../client/src/shellUtils.js';

describe('shellUtils: resolveShellPath', () => {
  it("'global' / 空 / null → 应用全局 shell 路径", () => {
    expect(resolveShellPath('global', '/g/bash')).toBe('/g/bash');
    expect(resolveShellPath('', '/g/bash')).toBe('/g/bash');
    expect(resolveShellPath(null, '/g/bash')).toBe('/g/bash');
  });

  it('指定解释器路径原样返回（不回退全局）', () => {
    expect(resolveShellPath('/usr/zsh', '/g/bash')).toBe('/usr/zsh');
  });
});

describe('shellUtils: resolveDisplayShell（回归：切换全局默认不影响已打开窗口）', () => {
  // exec.shell='global' 的窗口运行时固化在 /old/zsh；之后用户把全局默认切到 /new/bash。
  // 已打开窗口必须继续显示 /old/zsh，而不是跟随新全局。
  it('已打开窗口冻结为运行时刻路径，不受全局切换影响', () => {
    expect(resolveDisplayShell('global', '/old/zsh', '/new/bash')).toBe('/old/zsh');
  });

  it('脚本指定解释器也用运行时固化的 shellPath', () => {
    expect(resolveDisplayShell('/usr/fish', '/usr/fish', '/new/bash')).toBe('/usr/fish');
  });

  it('No Shell Mode 占位（无固化路径）才回退到当前全局', () => {
    expect(resolveDisplayShell('global', null, '/new/bash')).toBe('/new/bash');
  });
});
