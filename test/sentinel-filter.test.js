import { describe, it, expect } from 'vitest';
import { filterSentinelChunk, isPrefixOf, SENTINEL_HINT } from '../client/src/sentinelFilter.js';

const TOKEN = 'EASYOPS_DONE_abc123def456';

// pty-host 当前 sentinel 命令（去掉尾部提交换行）：
//   \x1b[2K\r\x1b[2K; echo "<TOKEN>"
// 由 pty-host 在脚本结束后的 PS1 之后直接写入（不带回显的 PS1 前缀，因为该 PS1 已由
// bash 在写入前显示）。bash 回显该命令、执行后输出 TOKEN + 换行、再显示新的"真实 PS1"
// （保留用户自定义提示符，不再有旧方案那种被 PROMPT_COMMAND 清空的空 PS1 行）。
// sentinelFilter 处理：哨兵回显行整段 drop（仅透传清空行的 ANSI 序列），吸收模式仅吞掉
// 紧接着的 echo 输出行（1 行）；其后真实 PS1 原样保留。用户后续键入内容紧跟在真实 PS1 之后。
const SENTINEL_CMD = '\x1b[2K\r\x1b[2K; echo "' + TOKEN + '"';
const ANSI = '\x1b[2K\x1b[2K\r'; // 哨兵回显行透传给 xterm 的清行序列（2K + 2K + CR）

describe('sentinelFilter', () => {
  it('无 token 时原样透传', () => {
    const r = filterSentinelChunk('hello\nworld\n', null, '');
    expect(r).toEqual({ text: 'hello\nworld\n', buf: '', detected: false, consumeLines: 0 });
  });

  it('普通输出（不含 token）完整保留，不误判', () => {
    const data = 'build ok\n1 file changed\nuser@host:~$ ';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(false);
    expect(r.text).toBe(data);
    expect(r.buf).toBe('');
    expect(r.consumeLines).toBe(0);
  });

  it('单 chunk：脚本输出 + PS1 + 哨兵段 + echo 输出 + 真实 PS1 + 用户输入，哨兵段整段 drop，真实 PS1 保留', () => {
    // 真实字节流：脚本输出 → 脚本结束后的 PS1 → 哨兵命令回显（无前缀）→ echo 输出
    //   → 哨兵后的真实 PS1 → 用户键入字符
    // sentinelFilter 处理：
    //   1) 哨兵命令回显行（含 echo "EASYOPS_DONE_…"）整段 drop，仅透传清行 ANSI
    //   2) echo 输出行（含 token）→ 哨兵吸收模式吞掉（consumeLines 1→0）
    //   3) 真实 PS1（user@host:~$ ）原样透传，不丢失任何字符
    const ps1 = 'user@host:~$ ';
    const data =
      'Already up to date.\n' +
      ps1 + // 脚本结束后的真实 PS1
      SENTINEL_CMD + '\n' + // 哨兵回显命令（pty-host 写入，无 PS1 前缀）
      TOKEN + '\n' + // echo 输出
      ps1 + // 哨兵后的真实 PS1（必须保留）
      '15'; // 用户后续输入
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    // 期望：脚本输出 + 清行 ANSI（把脚本结束后显示的旧 PS1 一并擦掉）+ 哨兵后的真实 PS1
    //   + 用户输入；哨兵命令文本与 echo 输出均剔除，且真实 PS1 一个字符都不丢。
    //   注意：脚本结束后的旧 PS1 被哨兵的清行 ANSI 一同擦除，不会以"两个 PS1"形式残留。
    expect(r.text).toBe('Already up to date.\n' + ANSI + ps1 + '15');
    expect(r.text).toContain(ANSI);
    expect(r.text).not.toContain(TOKEN);
    expect(r.text).not.toContain(SENTINEL_HINT);
    expect(r.text).not.toContain('echo "');
    expect(r.buf).toBe('');
    expect(r.consumeLines).toBe(0);
  });

  it('token 跨 chunk 拆分：PS1 前缀立即写出，echo 命令片段持起重组后整段 drop', () => {
    // chunk 1 = 普通行 + PS1 第二行 + "echo \""（无 \n）；chunk 2 = token + "\"" + \n + echo 输出 + 真实 PS1 + 输入
    //   r1：普通行写出；PS1 前缀（"user@host:~$ "）立即写出；echo 命令片段持到 buf。
    //   r2：buf + c2 凑齐 echo 命令行 → 整段 drop（其 PS1 前缀已在 r1 写出，不重复）；
    //       echo 输出行被吸收；真实 PS1 保留；用户输入 '15'（tail）立即写出。
    const c1 = 'script output\nuser@host:~$ echo "';
    const r1 = filterSentinelChunk(c1, TOKEN, '');
    expect(r1.detected).toBe(false);
    expect(r1.text).toBe('script output\nuser@host:~$ \n');
    expect(r1.buf).toBe('echo "');

    const c2 = TOKEN + '"\n' + TOKEN + '\nuser@host:~$ 15';
    const r2 = filterSentinelChunk(c2, TOKEN, r1.buf);
    expect(r2.detected).toBe(true);
    // 本跨 chunk 片段未携带清行 ANSI 前缀（仅模拟 echo " 边界），故输出只含真实 PS1 + 用户输入
    expect(r2.text).toBe('user@host:~$ 15');
    expect(r2.text).not.toContain(TOKEN);
    expect(r2.text).not.toContain(SENTINEL_HINT);
    expect(r2.buf).toBe('');
    expect(r2.consumeLines).toBe(0);
  });

  it('仅哨兵输出行（无回显命令）也被剔除', () => {
    const data = 'done\n' + TOKEN + '\n';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    expect(r.text).toBe('done\n');
    expect(r.consumeLines).toBe(0);
  });

  it('哨兵吸收模式跨 chunk：echo 输出在下一 chunk 才到达，吸收 1 行后真实 PS1 保留', () => {
    // chunk 1 含完整哨兵命令回显行（带 \n）；chunk 2 携带 echo 输出 + 真实 PS1 + 后续输入。
    //   r1：哨兵命令回显行 → 仅透传 ANSI，consumeLines=1（等待吸收下一行的 echo 输出）
    //   r2：echo 输出行被吸收（consumeLines 1→0）；真实 PS1 保留；用户输入紧跟
    const ps1 = 'user@host:~$ ';
    const c1 = ps1 + SENTINEL_CMD + '\n';
    const r1 = filterSentinelChunk(c1, TOKEN, '');
    expect(r1.detected).toBe(true);
    // 哨兵命令行的 PS1 前缀不在此重复透传（bash 已在写入前显示）；只透传清行 ANSI
    expect(r1.text).toBe(ANSI);
    expect(r1.consumeLines).toBe(1);

    const c2 = TOKEN + '\n' + ps1 + '15';
    const r2 = filterSentinelChunk(c2, TOKEN, r1.buf, { consumeLines: r1.consumeLines });
    expect(r2.detected).toBe(true);
    expect(r2.text).toBe(ps1 + '15');
    expect(r2.consumeLines).toBe(0);
  });

  it('哨兵回显行单独出现（无 PS1 前缀）：整段 drop，仅透传 ANSI', () => {
    // 自定义 PS1（无前缀）下 echo 命令回显不带 PS1 内容。filter 应整段 drop，仅透传 ANSI。
    const data = SENTINEL_CMD + '\n' + TOKEN + '\nafter';
    const r = filterSentinelChunk(data, TOKEN, '');
    expect(r.detected).toBe(true);
    expect(r.text).toBe(ANSI + 'after');
    expect(r.text).not.toContain(TOKEN);
    expect(r.consumeLines).toBe(0);
  });

  it('isPrefixOf 基本语义', () => {
    expect(isPrefixOf('ab', 'abc')).toBe(true);
    expect(isPrefixOf('abc', 'abc')).toBe(false); // 等长不算前缀
    expect(isPrefixOf('', 'abc')).toBe(false); // 空串不算
    expect(isPrefixOf('xy', 'abc')).toBe(false);
  });
});
