'use strict';

import { describe, it, expect } from 'vitest';
import { isUsableInterpreter } from '../server/shell-detect.js';

describe('isUsableInterpreter (解释器可用性预检)', () => {
  it('返回 true 对真实存在且可执行的解释器（process.execPath 必然可执行）', () => {
    expect(isUsableInterpreter(process.execPath)).toBe(true);
  });

  it('返回 false 对空值 / 非法入参（上游据此抛"none resolved"）', () => {
    expect(isUsableInterpreter('')).toBe(false);
    expect(isUsableInterpreter('   ')).toBe(false);
    expect(isUsableInterpreter(null)).toBe(false);
    expect(isUsableInterpreter(undefined)).toBe(false);
    expect(isUsableInterpreter(42)).toBe(false);
  });

  it('返回 false 对不存在的路径（上游据此抛"not found or not executable"）', () => {
    expect(isUsableInterpreter('/no/such/binary/does-not-exist-xyz')).toBe(false);
  });
});
