'use strict';
// 仿真：真实 pty 跑 `echo hello`，把原始流跑过 sentinelFilter，剥 ANSI 后看可见文本
const pty = require('node-pty');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const SCRIPT = 'echo hello';
const doneToken = 'EASYOPS_DONE_' + crypto.randomBytes(16).toString('hex');
const doneMarker = `\x1b[2K\r\x1b[2K; echo "${doneToken}"`;

(async () => {
  const { filterSentinelChunk } = await import(
    require('url').pathToFileURL(path.join(__dirname, 'client/src/sentinelFilter.js')).href
  );

  const shell = process.env.TEST_SHELL || 'C:\\Windows\\System32\\bash.exe';
  const term = pty.spawn(shell, [], {
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
    const visRaw = stripAnsi(raw);
    const visFiltered = stripAnsi(filtered);

    console.log('===== RAW (含所有 PS1 / 命令回显 / 哨兵) =====');
    console.log('----- RAW 可见文本逐行 -----');
    console.log(visRaw.split('\n').map((l, i) => `${String(i).padStart(2)}|${l}`).join('\n'));

    console.log('');
    console.log('===== FILTERED (写入 xterm 的) =====');
    console.log('----- FILTERED 可见文本逐行 -----');
    console.log(visFiltered.split('\n').map((l, i) => `${String(i).padStart(2)}|${l}`).join('\n'));

    process.exit(0);
  }

  setTimeout(() => {
    try {
      term.write(SCRIPT + '\n');
    } catch {}
    setTimeout(() => {
      try {
        term.write(doneMarker + '\n');
      } catch {}
    }, 300);
  }, 500);

  setTimeout(() => {
    console.log('TIMEOUT — 强制结束');
    finish();
  }, 4000);
})();
