'use strict';

/**
 * 日志模块自检脚本（scripts/verify-logger.js）
 * 运行：node scripts/verify-logger.js
 * 目的：分别验证开发模式（终端输出）与生产模式（文件输出）的行为。
 */

(async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { createLogger } = require('../shared/logger');

  console.log('=== 开发模式（isDev=true，输出到终端，level=info 过滤掉 debug）===');
  const dev = createLogger({ isDev: true, level: 'info' });
  dev.debug('调试信息（level=info 时应被过滤，不出现）', { module: 'verify' });
  dev.info('启动完成', { pid: process.pid });
  dev.warn('磁盘空间偏低', { used: '92%' });
  dev.error('启动失败', { step: 'pty' }, new Error('node-pty 初始化异常'));

  console.log('\n=== 生产模式（isDev=false，应写入文件）===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyops-log-'));
  const prod = createLogger({
    isDev: false,
    level: 'info',
    dir: tmpDir,
    filename: 'app.log',
  });
  prod.info('服务已启动', { port: 4521 });
  prod.error('脚本执行异常', { scriptId: 'abc' }, new Error('command not found'));
  await prod.close(); // 等待数据真正落盘，避免读文件竞态

  const file = path.join(tmpDir, 'app.log');
  const content = fs.readFileSync(file, 'utf8');
  console.log(`\n日志文件: ${file}`);
  console.log('内容（JSON Lines）：');
  console.log(content);

  // 简单断言：文件应包含两条记录，且含 error 的 stack
  const lines = content.trim().split('\n');
  if (lines.length !== 2) {
    console.error(`\n[FAIL] 期望 2 行，实际 ${lines.length} 行`);
    process.exit(1);
  }
  const parsed = lines.map((l) => JSON.parse(l));
  if (!parsed.some((e) => e.level === 'error' && e.error && e.error.stack)) {
    console.error('\n[FAIL] 未正确记录 error 的 stack');
    process.exit(1);
  }
  console.log('\n[PASS] 日志模块行为符合预期');
})();
