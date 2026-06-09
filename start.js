const { spawn, exec } = require('child_process');
const path = require('path');

const backendDir = path.join(__dirname, 'backend');
const frontendDir = path.join(__dirname, 'frontend');

console.log('========================================');
console.log('  Script Manager - 启动脚本');
console.log('========================================\n');

const backend = spawn('node', ['server.js'], {
  cwd: backendDir,
  stdio: 'inherit'
});

backend.on('close', (code) => {
  console.log(`\n后端服务已停止 (代码: ${code})`);
});

const waitForBackend = (callback) => {
  const checkPort = () => {
    exec('powershell -Command "Test-NetConnection localhost -Port 3001"', (error, stdout, stderr) => {
      if (stdout.includes('TcpTestSucceeded : True')) {
        callback();
      } else {
        setTimeout(checkPort, 500);
      }
    });
  };
  checkPort();
};

waitForBackend(() => {
  console.log('\n[后端] 服务已就绪');
  
  const frontend = spawn('npm', ['run', 'dev'], {
    cwd: frontendDir,
    stdio: 'inherit'
  });

  frontend.on('close', (code) => {
    console.log(`\n前端服务已停止 (代码: ${code})`);
  });
});

process.on('SIGINT', () => {
  console.log('\n正在停止服务...');
  backend.kill();
  process.exit(0);
});
