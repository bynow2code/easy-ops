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

  it('单 chunk 内含哨兵回显行与输出行，哨兵回显行保留 PS1 前缀、输出行整体剔除并标记 detected', () => {
    // 哨兵回显行 "user@host:~$ echo "EASYOPS_DONE_…"" 含 SENTINEL_HINT → 精细化处理，
    // 保留前缀 "user@host:~$ "（PS1 第二行内容）+ 换行，丢弃 echo 命令部分。
    // 哨兵 echo 输出行整行丢弃。最终保留：脚本输出 + PS1 第二行 + 末尾 PS1。
    const data =
      'script output\nuser@host:~$ echo "' + TOKEN + '"\n' + TOKEN + '\nuser@host:~$ ';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    expect(r.text).toBe('script output\nuser@host:~$ \nuser@host:~$ ');
    expect(r.buf).toBe('');
    expect(r.text).not.toContain(TOKEN);
    expect(r.text).not.toContain(SENTINEL_HINT);
  });

  it('token 跨 chunk 拆分时，PS1 前缀立即写出，echo 命令片段持起重组后整行 drop、无重复补前缀', () => {
    // 模拟哨兵回显行跨 chunk 的边界：chunk 1 = 普通行 + PS1 第二行 + "echo \""（无 \n）；
    // chunk 2 = token + "\"" + 提交换行 + echo 输出 + 换行。
    //   r1：普通行写出；PS1 前缀（"user@host:~$ "）立即写出；echo 命令片段持到 buf。
    //   r2：buf + c2 凑齐 echo 命令 + 输出 token 行；echo 命令整行 drop（其 PS1 前缀
    //       已在 r1 写出，本轮不再重复补）；token 输出行 drop；text 仅为 prefix '' + '\n'。
    // 这保证"PS1 第二行不丢失、也不会被重复输出两次"。
    const c1 = 'script output\nuser@host:~$ echo "';
    const r1 = filterSentinelChunk(c1, TOKEN, '');
    expect(r1.detected).toBe(false);
    expect(r1.text).toBe('script output\nuser@host:~$ \n');
    expect(r1.buf).toBe('echo "');

    const c2 = TOKEN + '"\n' + TOKEN + '\n';
    const r2 = filterSentinelChunk(c2, TOKEN, r1.buf);
    expect(r2.detected).toBe(true);
    expect(r2.text).toBe('\n'); // echo 命令整行 drop 时 prefix = '' → 仅写出 \n
    expect(r2.text).not.toContain(SENTINEL_HINT);
    expect(r2.text).not.toContain(TOKEN);
    expect(r2.buf).toBe('');
  });

  it('仅哨兵输出行（无回显命令）也被剔除', () => {
    const data = 'done\n' + TOKEN + '\n';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    expect(r.text).toBe('done\n');
  });

  it('修复后的真实字节流：脚本输出 + PS1（脚本结束）+ echo 命令 + echo 输出 + PS1（哨兵后）— 哨兵回显保留 PS1 前缀、输出行整体剔除', () => {
    // 模拟修复后的场景：pty-host 不再写哨兵前的 \n，让 echo 哨兵命令紧跟 PS1 第二行（$ 之后）输入；
    // shell 回显 echo 命令 + 输出 token + 输出下一个 PS1。
    // filter 处理：
    //   1) 哨兵回显行 "$ echo "EASYOPS_DONE_…"" 含 SENTINEL_HINT → 精细化处理，
    //      保留 SENTINEL_HINT 之前的前缀（PS1 第二行 "$ "）+ 换行，丢弃 echo 命令部分；
    //   2) echo 输出行 "EASYOPS_DONE_…" 含 token → 整行丢弃。
    // 终端最终显示：脚本输出 → 空行（PS1 开头 \n）→ PS1 第一行 → "$ " → 空行（用户回车 + 新 PS1 开头 \n）
    //   → PS1 第一行 → "$ "。两个完整 PS1，不再多出提示符或残缺 PS1 第二行。
    const ps1 = 'bynow@ERAZER MINGW64 ~\n$ ';
    const data =
      'Already up to date.\n' +
      ps1 +
      'echo "' + TOKEN + '"\n' +
      TOKEN + '\n' +
      ps1;
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    // 期望文本：脚本输出 + 第一个 PS1 + "$ \n"（PS1 第二行 + 用户回车换行） + 第二个 PS1
    expect(r.text).toBe('Already up to date.\n' + ps1 + '\n' + ps1);
    expect(r.text).not.toContain(TOKEN);
    expect(r.text).not.toContain(SENTINEL_HINT);
    expect(r.buf).toBe('');
  });

  it('哨兵回显行单独出现（无 PS2 前缀）：仍保留 SENTINEL_HINT 之前的任何前缀', () => {
    // 极端场景：自定义 PS1 把第二行设为 "% "（如 csh）。哨兵回显行变成 "% echo "EASYOPS_DONE_…""，
    // filter 应保留 "% " 前缀 + \n，丢弃 echo 命令部分——不假设 PS1 第二行一定是 "$ "。
    const data = '% echo "' + TOKEN + '"\n' + TOKEN + '\n% ';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    expect(r.text).toBe('% \n% ');
    expect(r.text).not.toContain(TOKEN);
  });

  it('isPrefixOf 基本语义', () => {
    expect(isPrefixOf('ab', 'abc')).toBe(true);
    expect(isPrefixOf('abc', 'abc')).toBe(false); // 等长不算前缀
    expect(isPrefixOf('', 'abc')).toBe(false); // 空串不算
    expect(isPrefixOf('xy', 'abc')).toBe(false);
  });
});
