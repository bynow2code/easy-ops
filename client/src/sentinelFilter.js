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
    // 哨兵回显行（用户在 PS1 第二行 $ 后键入的 echo 命令）包含 SENTINEL_HINT：
    //   这一行的"前缀"是 shell 的 PS1 第二行内容（典型为 "$ "），后半段才是用户键入的
    //   echo 命令。若整行 drop，前缀里的 PS1 第二行（"$ "）会一起消失 → 第一个 PS1
    //   显示残缺。故精细化处理：保留 SENTINEL_HINT 之前的前缀 + 换行，丢弃 echo 命令。
    if (line.includes(SENTINEL_HINT)) {
      const prefix = line.slice(0, line.indexOf(SENTINEL_HINT));
      out.push(prefix + '\n');
      detected = true;
      continue;
    }
    if (line.includes(token)) {
      // 哨兵 echo 输出行：整行丢弃（含 echo 输出 + 行尾换行）。
      detected = true;
      continue;
    }
    out.push(line + '\n');
  }
  let nextBuf = '';
  if (tail.length > 0) {
    // 仅当尾行疑似哨兵片段时才持到下一 chunk 重组；否则立即写出，
    // 避免延迟普通输出/交互回显（如脚本结束后的提示符）。
    const sentinelHintIdx = tail.indexOf(SENTINEL_HINT);
    // tail 形如 "user@host:~$ echo "（PS1 第二行 + echo 命令前几字符）也被识别为
    // 哨兵片段早期——避免 chunk 边界刚好在 `echo "` 后时丢失 PS1 前缀。
    // 长度上限 100 是哨兵 echo 命令总长度的安全上界（echo "EASYOPS_DONE_xxx" ≈ 6+1+34+1 ≈ 42
    // 字符；前缀 + 6 字符足以判定）；超过则认为是普通长行回显，不持起。
    const echoIdx = sentinelHintIdx >= 0 ? sentinelHintIdx : tail.indexOf('echo "');
    const looksSentinel =
      tail.includes(token) ||
      tail.includes(SENTINEL_HINT) ||
      isPrefixOf(tail, echoLine) ||
      isPrefixOf(tail, token) ||
      (echoIdx >= 0 && tail.length < 100);
    if (looksSentinel && echoIdx > 0) {
      // tail 是"PS1 第二行 + echo 命令片段"的拼接：把已能确认的 PS1 前缀立即写出，
      // 仅 echo 命令片段（从 echoIdx 起）持到 buf 等重组。
      // 后续 chunk 拼齐 echo 命令后整行 drop，PS1 前缀不再重复补出。
      out.push(tail.slice(0, echoIdx) + '\n');
      nextBuf = tail.slice(echoIdx);
    } else if (looksSentinel) {
      nextBuf = tail;
    } else {
      out.push(tail);
    }
  }
  return { text: out.join(''), buf: nextBuf, detected };
}
