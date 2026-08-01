import { describe, it, expect, vi } from 'vitest';

// 受控的 monaco 桩：捕获 registerCompletionItemProvider 的入参，
// 以便端到端验证「注册成功」且「注册的 provider 真的返回补全项」。
const { CompletionItemKind, registerSpy } = vi.hoisted(() => {
  const CompletionItemKind = { Function: 1, Keyword: 2, Variable: 3 };
  const registerSpy = vi.fn();
  return { CompletionItemKind, registerSpy };
});

vi.mock('monaco-editor/editor/editor.api', () => ({
  languages: {
    registerCompletionItemProvider: (lang, provider) => {
      registerSpy(lang, provider);
      return { dispose() {} };
    },
    CompletionItemKind,
  },
}));

import { registerShellCompletions, getShellCompletions } from './shellCompletions';

// 注册一次（模块级守卫只生效一次），捕获已注册的 provider 复用
registerShellCompletions();
const [, provider] = registerSpy.mock.calls[0];

// 轻量 mock model，仅需 getWordUntilPosition / getValueInRange
function makeModel(text) {
  return {
    getWordUntilPosition(pos) {
      const line = text.split('\n')[pos.lineNumber - 1] ?? '';
      const before = line.slice(0, pos.column - 1);
      const m = before.match(/[A-Za-z0-9_]*$/);
      const word = m ? m[0] : '';
      return { word, startColumn: pos.column - word.length, endColumn: pos.column };
    },
    getValueInRange(r) {
      const line = text.split('\n')[r.startLineNumber - 1] ?? '';
      return line.slice(r.startColumn - 1, r.endColumn - 1);
    },
  };
}

describe('shell completions', () => {
  it('registers a completion provider for the "shell" language', () => {
    expect(registerSpy).toHaveBeenCalledTimes(1);
    const [lang] = registerSpy.mock.calls[0];
    expect(lang).toBe('shell');
  });

  it('the registered provider returns command + keyword suggestions', () => {
    const model = makeModel('ec');
    const res = provider.provideCompletionItems(model, { lineNumber: 1, column: 3 });
    const labels = res.suggestions.map((s) => s.label);
    expect(labels).toContain('echo');
    expect(labels).toContain('exec');
    // 每项都带合法 range（覆盖已输入 token）
    expect(res.suggestions[0].range).toEqual({
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 1,
      endColumn: 3,
    });
  });

  it('returns variable suggestions when the token starts with $', () => {
    const model = makeModel('$ho');
    const res = provider.provideCompletionItems(model, { lineNumber: 1, column: 4 });
    const labels = res.suggestions.map((s) => s.label);
    expect(labels).toContain('$HOME');
    expect(labels).toContain('$HOSTNAME');
    expect(labels).not.toContain('$PATH'); // 按 $ho 过滤掉了（path 不含 ho）
  });

  it('returns all variables for a lone $', () => {
    const model = makeModel('$');
    const res = provider.provideCompletionItems(model, { lineNumber: 1, column: 2 });
    expect(res.suggestions.length).toBeGreaterThan(10);
  });

  it('getShellCompletions (pure) is consistent with the registered provider', () => {
    const model = makeModel('git');
    const direct = getShellCompletions(model, { lineNumber: 1, column: 4 });
    expect(direct.suggestions.map((s) => s.label)).toContain('git');
  });
});
