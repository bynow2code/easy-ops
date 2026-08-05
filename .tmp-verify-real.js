'use strict';
// 端到端验证：直接调用真实 pty-host.openSession，跑脚本，看过滤后可见文本
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'easyops-ud-'));
process.env.EASY_OPS_USER_DATA = tmpUserData;

const ptyHost = require('./electron/pty-host.js');
const { filterSentinelChunk } = require('./client/src/sentinelFilter.js');

const interpreter = 'C:\\Windows\\System32\\bash.exe'; // 本机真实默认
const content = process.env.SCRIPT || 'echo hello';

const { sessionId, doneToken } = ptyHost.openSession({
  execId: 'test-exec',
  scriptId: 'test-script',
  content,
  shell: interpreter,
  cwd: os.homedir(),
});

console.log('sessionId =', sessionId);
console.log('doneToken =', doneToken);
console.log('init file exists =', fs.existsSync(path.join(tmpUserData, 'easyops-shell-init.sh')));

let raw = '';
let buf = '';
let consumeLines = 0;
let filtered = '';

ptyHost.on('data', ({ execId, data }) => {
  if (execId !== 'test-exec') return;
  raw += data;
  const r = filterSentinelChunk(data, doneToken, buf, { consumeLines });
  buf = r.buf;
  consumeLines = r.consumeLines;
  filtered += r.text;
});

ptyHost.on('exit', () => setTimeout(finish, 250));

function finish() {
  const stripAnsi = (s) =>
    s
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '') // OSC 标题序列
      .replace(/\x1b[()][AB0-2]/g, '')
      .replace(/\x1b[=>]/g, '')
      .replace(/\x1b[78]/g, '')
      .replace(/\x0f/g, '')
      .replace(/\x0e/g, '');
  const visFiltered = stripAnsi(filtered);
  console.log('===== FILTERED 可见文本逐行 =====');
  console.log(
    visFiltered
      .split('\n')
      .map((l, i) => `${String(i).padStart(2)}|${JSON.stringify(l)}`)
      .join('\n'),
  );
  console.log('===== 是否含 TOKEN（应为 false）=====');
  console.log(visFiltered.includes(doneToken));
  process.exit(0);
}

setTimeout(() => {
  console.log('TIMEOUT');
  finish();
}, 5000);
