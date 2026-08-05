const os = require('os');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');

// 复用项目里的 sentinelFilter（ESM）
async function loadFilter() {
  const mod = await import(
    'file:///' + path.join(__dirname, 'client/src/sentinelFilter.js').replace(/\\/g, '/')
  );
  return mod.filterSentinelChunk;
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function toBashPath(winPath, interpreter) {
  const normalized = winPath.replace(/\\/g, '/');
  const m = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!m) return normalized;
  const drive = m[1].toLowerCase();
  const rest = m[2];
  if (/Git[\\/]bin[\\/]bash\.exe$/i.test(interpreter)) return `/${drive}/${rest}`;
  return `/mnt/${drive}/${rest}`;
}

async function main() {
  const filterSentinelChunk = await loadFilter();
  const interpreter = 'C:/Windows/System32/bash.exe'; // WSL bash
  const userData = path.join(__dirname, '.tmp-userdata3');
  fs.mkdirSync(userData, { recursive: true });

  // 临时脚本文件
  const scriptWin = path.join(userData, 'script.sh');
  const scriptContent = [
    '#!/bin/bash',
    'echo "========== mns_pms ==============="',
    'echo "当前分支：master"',
    'echo "开始拉取最新代码……"',
    'echo "Already up to date."',
  ].join('\n');
  fs.writeFileSync(scriptWin, scriptContent, { mode: 0o644 });
  const scriptBash = toBashPath(scriptWin, interpreter);

  // init 文件：关回显 + 极简提示符
  const initWin = path.join(userData, 'easyops-shell-init.sh');
  const initContent = [
    '# EasyOps runtime init',
    'stty -echo 2>/dev/null || true',
    "PS1='$ '",
    '',
  ].join('\n');
  fs.writeFileSync(initWin, initContent, { mode: 0o644 });
  const initBash = toBashPath(initWin, interpreter);

  const doneToken = 'EASYOPS_DONE_' + require('crypto').randomBytes(16).toString('hex');

  const term = pty.spawn(interpreter, ['--init-file', initBash], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: os.homedir(),
  });

  let raw = '';
  term.onData((data) => {
    raw += data;
  });

  // 给 bash 一点启动时间
  await new Promise((r) => setTimeout(r, 600));

  // 发送单行 source 命令
  const cmd = `source "${scriptBash}"; echo "${doneToken}"; stty echo\n`;
  term.write(cmd);

  // 等待脚本执行完成
  await new Promise((r) => setTimeout(r, 1500));

  term.kill();

  // 用项目 filter 过滤哨兵
  let visible = '';
  let buf = '';
  let consume = 0;
  const chunks = raw.match(/[\s\S]{1,256}/g) || [raw];
  for (const chunk of chunks) {
    const { text, buf: nextBuf, consumeLines } = filterSentinelChunk(chunk, doneToken, buf, {
      consumeLines: consume,
    });
    visible += text;
    buf = nextBuf;
    consume = consumeLines;
  }

  console.log('===== RAW (ANSI stripped) =====');
  console.log(stripAnsi(raw));
  console.log('===== FILTERED visible =====');
  console.log(stripAnsi(visible));

  // 清理
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
