// dev-start.js - 启动后端和前端服务，然后退出
const { spawn } = require('child_process');
const path = require('path');

const dir = __dirname;
const isWin = process.platform === 'win32';

console.log('Starting backend...');
spawn(isWin ? 'cmd' : 'node', isWin ? ['/c', 'start', '/b', 'node', 'server\\index.js'] : ['server/index.js'], {
  cwd: dir,
  detached: true,
  stdio: 'ignore',
  shell: false
});

console.log('Starting frontend dev server...');
spawn(isWin ? 'cmd' : 'npm', isWin ? ['/c', 'start', '/b', 'npm', 'run', 'dev'] : ['run', 'dev'], {
  cwd: path.join(dir, 'client'),
  detached: true,
  stdio: 'ignore',
  shell: false
});

console.log('Waiting 8s for services...');
setTimeout(() => {
  console.log('Starting Electron...');
  spawn('electron', ['.'], {
    cwd: dir,
    detached: true,
    stdio: 'inherit',
    shell: false
  });
  process.exit(0);
}, 8000);
