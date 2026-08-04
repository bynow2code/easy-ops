// 完成探测哨兵过滤器（纯函数，便于单测）
// ------------------------------------------------------------------
// 交互式常驻 shell 下，pty-host 在脚本首条输入之后写入一段"自擦除"哨兵（一次性写入，
// 由 bash 按字符回显、整体提交后执行）：
//   `\x1b[2K\r\x1b[2K; echo "<EASYOPS_DONE_...>"`
//
// 作用：
//  1) 前导 `\x1b[2K\r\x1b[2K`：ANSI 清当前行（脚本结束后的 PS1 第二行 "$ "）+ 回行首 + 再清当前行。
//     让哨兵命令的"清行操作"在终端上真正生效——原 PS1 第二行的 "$ " 视觉消失，避免出现
//     "额外 PS1 / 多余换行 / 光标错位"。
//  2) `; echo "TOKEN"`：bash 提交后执行，输出唯一哨兵 token；sentinelFilter 整段 drop
//     （回显命令文本 + echo 输出），仅把第 1) 步的 ANSI 清行序列透传给 xterm 生效。
//
// 注意：故意不写 `PROMPT_COMMAND='PS1='; PS1=`（旧方案）——那会永久把 PS1 改成空字符串，
// 让交互态下的提示符永远看不见，反向劣化体验。此处依赖 sentinelFilter 把哨兵段"无痕"擦掉，
// bash 哨兵后照常输出真实 PS1（保留用户自定义提示符），无需额外吞掉一整行空 PS1。
//
// 本模块把"从数据流中剔除哨兵段"做成无副作用的纯变换：调用方持有 buf
// （跨 chunk 重组不完整尾行），每次传入新数据拿回 { text, buf, detected, consumeLines }。
// consumeLines 是"哨兵吸收模式"剩余吸收行数：哨兵回显命令行命中时设为 1（吸收紧接着的
// echo 输出行），echo 输出被吸收后归零；其后真实 PS1 由正常分支原样透传，绝不被吞掉。

export const SENTINEL_HINT = 'echo "EASYOPS_DONE_';

// 提取 PTY 输出中的 ANSI CSI 序列（形如 `\x1b[<params><cmd>`），
// 让哨兵命令回显行里嵌入的 ANSI 操作（如 `\x1b[2K` 清行）能透传到 xterm 生效。
// eslint-disable-next-line no-control-regex -- \x1b (ESC) 是 ANSI CSI 序列的起始符，必须出现
const ANSI_CSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export function isPrefixOf(a, b) {
  return a.length > 0 && a.length < b.length && b.startsWith(a);
}

/**
 * @param {string} data 本 chunk 的 PTY 输出
 * @param {string|null} token 哨兵 token（无则原样透传）
 * @param {string} buf 上一 chunk 残留的不完整尾行
 * @param {{ consumeLines?: number }} [opts] 哨兵吸收模式状态（跨 chunk 复用）
 * @returns {{ text: string, buf: string, detected: boolean, consumeLines: number }}
 */
export function filterSentinelChunk(data, token, buf, opts = {}) {
  if (!token) return { text: data, buf: '', detected: false, consumeLines: 0 };
  const echoLine = 'echo ' + JSON.stringify(token); // 形如 echo "EASYOPS_DONE_..."
  const acc = (buf || '') + data;
  const parts = acc.split('\n');
  const tail = parts.pop(); // 不含换行符的不完整尾行
  const out = [];
  let detected = false;
  // 哨兵吸收模式剩余吸收完整行数。检测到哨兵回显命令行时设为 1（仅吸收紧接着的
  // echo 输出那一行）——新哨兵方案下 bash 哨兵后输出的是"真实 PS1"（必须保留），
  // 不存在旧方案那种"被 PROMPT_COMMAND 清空、需要再吞一行的空 PS1"。
  let consumeLines = opts.consumeLines || 0;

  for (const line of parts) {
    // 哨兵吸收模式：丢弃哨兵段残余行（echo 输出），不写出到终端
    if (consumeLines > 0) {
      consumeLines--;
      detected = true;
      continue;
    }
    // 哨兵回显行（pty-host 直接写入、由 bash 回显的 `…; echo "EASYOPS_DONE_…"` 命令）
    // 包含 SENTINEL_HINT。整体 drop 可见字符——不输出它前面的 PS1 前缀（bash 已在写入前
    // 显示过该 PS1，若再写一遍会让终端多出一行 "$ " + 一个空行）。
    //
    // 但回显行里嵌入的 ANSI CSI 序列（pty-host 注入的 `\x1b[2K\r\x1b[2K`）必须
    // **透传**到 xterm（让清行操作实际生效）；否则原 PS1 第二行的 "$ " 不会消失，
    // 会出现"多余 PS1 第二行 + 多余换行 + 光标错位"。同时透传 `\r`（回行首，让后续
    // `\x1b[2K` 能清整行）。
    //
    // 进入哨兵吸收模式吸收紧接着的 echo 输出行（bash 执行 echo 后输出的 token 那一行）。
    if (line.includes(SENTINEL_HINT)) {
      const ansiSeqs = line.match(ANSI_CSI_RE);
      if (ansiSeqs) out.push(ansiSeqs.join(''));
      if (line.includes('\r')) out.push('\r');
      consumeLines = 1;
      detected = true;
      continue;
    }
    // 哨兵 echo 输出行：整行丢弃（含 echo 输出 + 行尾换行）。
    if (line.includes(token)) {
      detected = true;
      continue;
    }
    out.push(line + '\n');
  }

  // tail 处理
  let nextBuf = '';
  if (tail.length > 0) {
    if (consumeLines > 0) {
      // 哨兵吸收模式下，tail 是跨 chunk 截断的残余（echo 输出必以 \n 结尾，正常不会出现；
      // 此处兜底直接写出，避免误吞真实 PS1 片段）。consumeLines 随下次调用续传。
      out.push(tail);
    } else {
      // 哨兵片段早期识别（跨 chunk 边界：上一 chunk 在 echo 命令中间结束）——
      // tail 形如 "user@host:~$ echo \""（PS1 第二行 + echo 命令前几字符）。
      // 若 tail 像哨兵片段早期：把已能确认的 PS1 前缀立即写出，仅 echo 命令片段
      // 持到 buf 等下一 chunk 重组（避免 PS1 前缀被截断或丢失）。
      const sentinelHintIdx = tail.indexOf(SENTINEL_HINT);
      const echoIdx = sentinelHintIdx >= 0 ? sentinelHintIdx : tail.indexOf('echo "');
      const looksSentinel =
        tail.includes(token) ||
        tail.includes(SENTINEL_HINT) ||
        isPrefixOf(tail, echoLine) ||
        isPrefixOf(tail, token) ||
        (echoIdx >= 0 && tail.length < 100);
      if (looksSentinel && echoIdx > 0) {
        out.push(tail.slice(0, echoIdx) + '\n');
        nextBuf = tail.slice(echoIdx);
      } else if (looksSentinel) {
        nextBuf = tail;
      } else {
        out.push(tail);
      }
    }
  }

  return { text: out.join(''), buf: nextBuf, detected, consumeLines };
}
