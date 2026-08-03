import { describe, it, expect } from 'vitest';
import { filterSentinelChunk, isPrefixOf, SENTINEL_HINT } from '../client/src/sentinelFilter.js';

const TOKEN = 'EASYOPS_DONE_abc123def456';

describe('sentinelFilter', () => {
  it('无 token 时原样透传', () => {
    const r = filterSentinelChunk('hello\nworld\n', null, '');
    expect(r).toEqual({ text: 'hello\nworld\n', buf: '', detected: false });
  });

  it('普通输出（不含 token）完整保留，不误判', () => {
    const data = 'build ok\n1 file changed\nuser@host:~$ ';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(false);
    expect(r.text).toBe(data);
    expect(r.buf).toBe('');
  });

  it('单 chunk 内含哨兵回显行与输出行，两者均被剔除并标记 detected', () => {
    const data =
      'script output\nuser@host:~$ echo "' + TOKEN + '"\n' + TOKEN + '\nuser@host:~$ ';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    // 哨兵两行被剔除，仅保留脚本输出与末尾提示符
    expect(r.text).toBe('script output\nuser@host:~$ ');
    expect(r.buf).toBe('');
    expect(r.text).not.toContain(TOKEN);
  });

  it('token 跨 chunk 拆分时，首段尾行被持起、次段重组后整体剔除、无碎片泄漏', () => {
    const c1 = 'user@host:~$ echo "' + TOKEN.slice(0, 20); // 不完整尾行（无换行）
    const r1 = filterSentinelChunk(c1, TOKEN, '');
    expect(r1.detected).toBe(false);
    expect(r1.text).toBe(''); // 哨兵片段持起，未写出
    expect(r1.buf).toBe(c1);

    const c2 = TOKEN.slice(20) + '"\n' + TOKEN + '\n';
    const r2 = filterSentinelChunk(c2, TOKEN, r1.buf);
    expect(r2.detected).toBe(true);
    expect(r2.text).toBe(''); // 哨兵整行被剔除，无 echo 命令碎片残留
    expect(r2.text).not.toContain(SENTINEL_HINT);
    expect(r2.buf).toBe('');
  });

  it('仅哨兵输出行（无回显命令）也被剔除', () => {
    const data = 'done\n' + TOKEN + '\n';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    expect(r.text).toBe('done\n');
  });

  it('isPrefixOf 基本语义', () => {
    expect(isPrefixOf('ab', 'abc')).toBe(true);
    expect(isPrefixOf('abc', 'abc')).toBe(false); // 等长不算前缀
    expect(isPrefixOf('', 'abc')).toBe(false); // 空串不算
    expect(isPrefixOf('xy', 'abc')).toBe(false);
  });
});
