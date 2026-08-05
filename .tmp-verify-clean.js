'use strict';
// 验证新方案：--init-file 关回显 + 哨兵并入脚本末尾，看可见文本是否干净
const pty = require('node-pty');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const SCRIPT = process.env.SCRIPT || 'echo hello';
const interpreter = 'C:\\Windows\\System32\\bash.exe'; // WSL bash（本机真实默认）
const doneToken = 'EASYOPS_DONE_' + crypto.randomBytes(16).toString('hex');

// init 文件：关回显 + 干净提示符
const initWin = path.join(os.tmpdir(), 'easyops-verify-init.sh');
fs.writeFileSync(initWin, 'stty -echo 2>/dev/null || true\nPS1=\'$ \'\n');
// WSL 路径转换
const initBash = '/mnt/' + initWin.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_, d) => d.toLowerCase() + '/');

console.log('initBashPath =', initBash);

(async () => {
  const { filterSentinelChunk } = await import(
    require('url').pathToFileURL(path.join(__dirname, 'client/src/sentinelFilter.js')).href
  );

  const term = pty.spawn(interpreter, ['--init-file', initBash], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: os.homedir(),
  });

  let raw = '';
  let buf = '';
  let consumeLines = 0;
  let filtered = '';

  term.onData((data) => {
    raw += data;
    const r = filterSentinelChunk(data, doneToken, buf, { consumeLines });
    buf = r.buf;
    consumeLines = r.consumeLines;
    filtered += r.text;
  });

  term.onExit(() => setTimeout(finish, 200));

  function finish() {
    const stripAnsi = (s) =>
      s
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
        .replace(/\x1b[()][AB0-2]/g, '')
        .replace(/\x1b[=>]/g, '')
        .replace(/\x1b[78]/g, '')
        .replace(/\x0f/g, '')
        .replace(/\x0e/g, '');
    const visFiltered = stripAnsi(filtered);
    console.log('===== FILTERED 可见文本逐行 =====');
    console.log(visFiltered.split('\n').map((l, i) => `${String(i).padStart(2)}|${JSON.stringify(l)}`).join('\n'));
    console.log('===== 末尾 200 字符原始 filtered =====');
    console.log(JSON.stringify(filtered.slice(-200)));
    process.exit(0);
  }

  setTimeout(() => {
    const injected = SCRIPT.replace(/\s+$/, '') + '; echo "' + doneToken + '"; stty echo\n';
    try {
      term.write(injected);
    } catch (e) {
      console.log('write err', e.message);
    }
  }, 600);

  setTimeout(() => {
    console.log('TIMEOUT');
    finish();
  }, 4000);
})();
