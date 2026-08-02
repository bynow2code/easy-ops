'use strict';

/**
 * 开发一键启动器（dev:all / electron:dev 共用）
 *
 * 问题背景：electron:dev 若只启动 Electron，它会立即去加载 http://localhost:5173
 * （Vite dev server）。若 Vite 未先启动，就会报 ERR_CONNECTION_REFUSED。
 *
 * 本脚本：
 *   1. 先启动 Vite dev server（npm run dev）；
 *   2. 轮询直到 5173 就绪；
 *   3. 再直接启动 Electron 二进制（electron . —— 它会在主进程内拉起 Express 后端）。
 * 这样只需一条命令，且前端/后端/窗口三者时序正确。
 *
 * 注意：Electron 必须直接 spawn 二进制，不能 spawn `npm run electron:dev`，
 * 否则会递归调用本脚本；Vite 侧仍可用 `npm run dev`。
 *
 * 无第三方依赖，纯 Node 子进程编排。
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VITE_URL = 'http://localhost:5173';
const VITE_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 400;
const IS_WIN = process.platform === 'win32';

function log(msg) {
  console.log(`[dev:all] ${msg}`);
}

function waitForVite() {
  const deadline = Date.now() + VITE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(VITE_URL, (res) => {
        res.destroy();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Vite dev server 在 ${VITE_TIMEOUT_MS}ms 内未就绪`));
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      });
    };
    tick();
  });
}

// 启动一个 npm 脚本子进程；posix 下 detached 以便按进程组整体回收
function startNpm(scriptName) {
  const child = spawn('npm', ['run', scriptName], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WIN,
    ...(IS_WIN ? {} : { detached: true }),
  });
  child.on('exit', (code, signal) => {
    log(`${scriptName} 退出 (code=${code}, signal=${signal})`);
  });
  return child;
}

// 直接 spawn Electron 二进制（避免递归调用 npm run electron:dev）
function electronBin() {
  const base = path.join(ROOT, 'node_modules', '.bin', 'electron');
  return IS_WIN ? `${base}.cmd` : base;
}

function startElectron() {
  const child = spawn(electronBin(), ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
    ...(IS_WIN ? { shell: true } : { detached: true }),
  });
  child.on('exit', (code, signal) => {
    log(`electron 退出 (code=${code}, signal=${signal})`);
  });
  return child;
}

function killTree(child) {
  if (!child || child.killed) return;
  if (!IS_WIN && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM'); // 杀掉整个进程组
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
}

const vite = startNpm('dev');
let electron = null;

waitForVite()
  .then(() => {
    log('Vite 已就绪，启动 Electron...');
    electron = startElectron();
  })
  .catch((err) => {
    console.error(`[dev:all] ${err.message}`);
    cleanup(1);
  });

function cleanup(exitCode = 0) {
  killTree(vite);
  killTree(electron);
  process.exit(exitCode);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
