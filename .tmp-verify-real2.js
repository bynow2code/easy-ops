const os = require('os');
const fs = require('fs');
const path = require('path');
const ptyHost = require('./electron/pty-host');

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

async function main() {
  const filterSentinelChunk = await loadFilter();
  const execId = 'verify-' + Date.now();
  const content = [
    'echo "========== mns_pms ==============="',
    'echo "当前分支：master"',
    'echo "开始拉取最新代码……"',
    'echo "Already up to date."',
  ].join('\n');

  process.env.EASY_OPS_USER_DATA = path.join(__dirname, '.tmp-userdata4');
  fs.mkdirSync(process.env.EASY_OPS_USER_DATA, { recursive: true });

  let raw = '';
  let detected = false;

  ptyHost.on('data', ({ execId: eid, data }) => {
    if (eid !== execId) return;
    raw += data;
  });
  ptyHost.on('exit', ({ execId: eid }) => {
    if (eid !== execId) return;
    // 进程退出后再给一点时间收完数据
    setTimeout(() => {
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
      process.exit(0);
    }, 200);
  });

  const { doneToken, sessionId } = ptyHost.openSession({
    execId,
    scriptId: 'mns_pms',
    content,
    shell: 'C:/Windows/System32/bash.exe',
    cwd: os.homedir(),
  });

  // 如果 5s 内没 exit 也结束
  setTimeout(() => {
    ptyHost.killByExec(execId);
  }, 3000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
