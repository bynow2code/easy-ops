// 完成探测哨兵过滤器（纯函数，便于单测）
// ------------------------------------------------------------------
// 交互式常驻 shell 下，pty-host 在脚本首条输入之后写入一行唯一哨兵
// （echo "<EASYOPS_DONE_...>"），渲染层在输出流里识别该 token 即判定
// "脚本已结束"，并把该哨兵的回显命令与 echo 输出一并剔除，终端保持干净。
//
// 本模块把"从数据流中剔除哨兵行"做成无副作用的纯变换：调用方持有 buf
// （跨 chunk 重组不完整尾行），每次传入新数据拿回 { text, buf, detected }。
// token 每会话唯一、随机，不会与用户真实输出重合，故按整行 includes 判定安全。

export const SENTINEL_HINT = 'echo "EASYOPS_DONE_';

export function isPrefixOf(a, b) {
  return a.length > 0 && a.length < b.length && b.startsWith(a);
}

/**
 * @param {string} data 本 chunk 的 PTY 输出
 * @param {string|null} token 哨兵 token（无则原样透传）
 * @param {string} buf 上一 chunk 残留的不完整尾行
 * @returns {{ text: string, buf: string, detected: boolean }}
 */
export function filterSentinelChunk(data, token, buf) {
  if (!token) return { text: data, buf: '', detected: false };
  const echoLine = 'echo ' + JSON.stringify(token); // 形如 echo "EASYOPS_DONE_..."
  const acc = (buf || '') + data;
  const parts = acc.split('\n');
  const tail = parts.pop(); // 不含换行符的不完整尾行
  const out = [];
  let detected = false;
  for (const line of parts) {
    if (line.includes(token)) {
      detected = true;
      continue; // 丢弃哨兵行（回显命令或 echo 输出），保持终端干净
    }
    out.push(line + '\n');
  }
  let nextBuf = '';
  if (tail.length > 0) {
    // 仅当尾行疑似哨兵片段时才持到下一 chunk 重组；否则立即写出，
    // 避免延迟普通输出/交互回显（如脚本结束后的提示符）。
    const looksSentinel =
      tail.includes(token) ||
      tail.includes(SENTINEL_HINT) ||
      isPrefixOf(tail, echoLine) ||
      isPrefixOf(tail, token);
    if (looksSentinel) nextBuf = tail;
    else out.push(tail);
  }
  return { text: out.join(''), buf: nextBuf, detected };
}
