const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const net = require('net');

const app = express();
const DEFAULT_PORT = 3001;
const PORT_RANGE_START = 3001;
const PORT_RANGE_END = 3100;
const PORT_FILE = path.join(__dirname, 'port.txt');

// 决定脚本数据文件存储位置：Electron 打包后使用用户数据目录，避免写入只读安装目录
const resolveDataFile = () => {
  const dataDir = process.env.SCRIPT_DATA_DIR;
  if (dataDir) {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {}
    return path.join(dataDir, 'scripts.json');
  }
  return path.join(__dirname, 'scripts.json');
};

app.use(cors());
app.use(express.json());

// 在 Electron 打包模式下，托管前端静态资源（同一端口同时提供 API 和页面）
if (process.env.ELECTRON_MODE === '1') {
  const frontendDistDir = process.env.FRONTEND_DIST_DIR ||
    path.join(__dirname, '..', 'client', 'dist');
  
  console.log('[Server] ELECTRON_MODE:', process.env.ELECTRON_MODE);
  console.log('[Server] FRONTEND_DIST_DIR env:', process.env.FRONTEND_DIST_DIR);
  console.log('[Server] frontendDistDir resolved:', frontendDistDir);
  console.log('[Server] frontendDistDir exists:', fs.existsSync(frontendDistDir));
  if (fs.existsSync(frontendDistDir)) {
    const indexHtmlPath = path.join(frontendDistDir, 'index.html');
    console.log('[Server] index.html exists:', fs.existsSync(indexHtmlPath));
    app.use(express.static(frontendDistDir));
    // SPA 路由回退：非 API 请求返回 index.html
    app.get(/^\/(?!api).*/, (req, res, next) => {
      const indexPath = path.join(frontendDistDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  } else {
    console.error('[Server] ERROR: frontendDistDir does not exist:', frontendDistDir);
  }
}

let SCRIPTS_FILE = resolveDataFile();

const getScripts = () => {
  try {
    if (fs.existsSync(SCRIPTS_FILE)) {
      const scripts = JSON.parse(fs.readFileSync(SCRIPTS_FILE, 'utf8'));
      // 兼容旧数据：补齐 orderNum 和 group
      let maxOrder = -1;
      scripts.forEach(s => {
        if (s.orderNum != null && s.orderNum > maxOrder) {
          maxOrder = s.orderNum;
        }
      });
      let hasMissing = false;
      scripts.forEach(s => {
        if (s.orderNum == null) {
          hasMissing = true;
          maxOrder += 1;
          s.orderNum = maxOrder;
        }
        if (!s.group) {
          hasMissing = true;
          s.group = 'backend';
        }
      });
      if (hasMissing) {
        saveScripts(scripts);
      }
      scripts.sort((a, b) => (a.orderNum || 0) - (b.orderNum || 0));
      return scripts;
    }
  } catch (err) {
    console.error('Error reading scripts file:', err);
  }
  return [];
};

const saveScripts = (scripts) => {
  fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(scripts, null, 2));
};

const isPortAvailable = (port) => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port);
  });
};

const findAvailablePort = async (startPort, endPort) => {
  for (let port = startPort; port <= endPort; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  return null;
};

const detectShell = () => {
  const isWindows = process.platform === 'win32';
  const result = { command: '', fullPath: '', args: [], type: '', name: '', version: '' };

  const resolveFullPath = (cmd) => {
    try {
      if (isWindows) {
        const out = execSync(`where ${cmd}`, { timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
        return out.split('\r\n')[0] || out.split('\n')[0] || cmd;
      } else {
        const out = execSync(`which ${cmd}`, { timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
        return out.split('\n')[0] || cmd;
      }
    } catch (e) {
      return cmd;
    }
  };

  if (!isWindows) {
    result.command = 'bash';
    result.fullPath = resolveFullPath('bash');
    result.args = ['-c'];
    result.type = 'bash';
    result.name = result.fullPath;
    try {
      result.version = execSync('bash --version', { timeout: 1000 }).toString().split('\n')[0].trim();
    } catch (e) {}
    return result;
  }

  const possibleBashPaths = [
    { path: 'bash', name: 'bash (PATH)' },
    { path: 'C:\\Program Files\\Git\\bin\\bash.exe', name: 'Git Bash (C:\\Program Files\\Git)' },
    { path: 'C:\\Program Files (x86)\\Git\\bin\\bash.exe', name: 'Git Bash (C:\\Program Files (x86)\\Git)' },
    { path: process.env.ProgramW6432 ? `${process.env.ProgramW6432}\\Git\\bin\\bash.exe` : '', name: 'Git Bash' },
    { path: process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Git\\bin\\bash.exe` : '', name: 'Git Bash' },
    { path: 'C:\\Windows\\System32\\bash.exe', name: 'WSL bash' },
    { path: 'git\\bash', name: 'Git bash (relative)' }
  ];

  for (const { path: bashPath, name } of possibleBashPaths) {
    if (!bashPath) continue;
    try {
      execSync(`"${bashPath}" -c "echo test"`, { stdio: 'ignore', timeout: 1000 });
      result.command = bashPath;
      // 如果是简单的 'bash' 命令，解析其完整路径
      if (bashPath === 'bash' || !bashPath.includes('\\')) {
        result.fullPath = resolveFullPath(bashPath);
      } else {
        result.fullPath = bashPath;
      }
      result.args = ['-c'];
      result.type = 'bash';
      result.name = name;
      try {
        result.version = execSync(`"${bashPath}" --version`, { timeout: 1000 }).toString().split('\n')[0].trim();
      } catch (e) {}
      return result;
    } catch (e) {}
  }

  result.command = 'cmd.exe';
  result.fullPath = resolveFullPath('cmd.exe');
  result.args = ['/c'];
  result.type = 'cmd';
  result.name = 'Windows cmd.exe';
  try {
    result.version = execSync('cmd /c "echo cmd.exe"', { timeout: 1000 }).toString().trim();
  } catch (e) {}
  console.log('⚠️  Warning: bash not found, falling back to cmd.exe (bash scripts may not work correctly)');
  return result;
};

const shell = detectShell();

console.log('========================================');
console.log('[EasyOps] Script Manager - Backend starting...');
console.log('========================================');
console.log(`[Platform] ${process.platform} (${process.arch})`);
console.log(`[Shell]   Type: ${shell.type.toUpperCase()}`);
console.log(`[Shell]   Command: ${shell.command} ${shell.args.join(' ')}`);
if (shell.name) console.log(`[Shell]   Name: ${shell.name}`);
if (shell.version) console.log(`[Shell]   Version: ${shell.version}`);
console.log('========================================');

// API to expose shell info to frontend
app.get('/api/system-info', (req, res) => {
  res.json({
    platform: process.platform,
    arch: process.arch,
    shell: {
      type: shell.type,
      command: shell.command,
      fullPath: shell.fullPath,
      args: shell.args,
      name: shell.name,
      version: shell.version
    }
  });
});

// ==================== CRUD ====================

app.get('/api/scripts', (req, res) => {
  const scripts = getScripts();
  res.json(scripts);
});

app.post('/api/scripts', (req, res) => {
  const { name, content, group } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: 'Name and content are required' });
  }

  const scripts = getScripts();
  const maxOrder = scripts.reduce((max, s) => Math.max(max, s.orderNum != null ? s.orderNum : -1), -1);
  const newScript = {
    id: Date.now().toString(),
    name,
    content,
    group: group || 'backend',
    orderNum: maxOrder + 1,
    createdAt: new Date().toISOString()
  };

  scripts.push(newScript);
  saveScripts(scripts);
  res.json(newScript);
});

app.put('/api/scripts/:id', (req, res) => {
  const { id } = req.params;
  const { name, content, group } = req.body;

  const scripts = getScripts();
  const index = scripts.findIndex(s => s.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Script not found' });
  }

  scripts[index] = { ...scripts[index], name, content };
  if (group) scripts[index].group = group;
  saveScripts(scripts);
  res.json(scripts[index]);
});

app.delete('/api/scripts/:id', (req, res) => {
  const { id } = req.params;
  let scripts = getScripts();
  const initialLength = scripts.length;

  scripts = scripts.filter(s => s.id !== id);

  if (scripts.length === initialLength) {
    return res.status(404).json({ error: 'Script not found' });
  }

  saveScripts(scripts);
  res.json({ success: true });
});

// 批量重排序（支持分组切换）：body 传 { order: ['id1','id2',...], groups?: { id: 'backend'|'frontend' } }
app.post('/api/scripts/reorder', (req, res) => {
  try {
    const { order, groups } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array of script ids' });
    }

    const scripts = getScripts();
    const idToScript = new Map(scripts.map(s => [s.id, s]));

    // 先应用分组变更
    if (groups && typeof groups === 'object') {
      Object.entries(groups).forEach(([id, group]) => {
        const s = idToScript.get(id);
        if (s) s.group = group;
      });
    }

    // 应用排序
    order.forEach((id, idx) => {
      const s = idToScript.get(id);
      if (s) s.orderNum = idx;
    });

    let nextOrder = order.length;
    scripts.forEach(s => {
      if (!order.includes(s.id)) {
        s.orderNum = nextOrder;
        nextOrder += 1;
      }
    });

    saveScripts(scripts);
    res.json({ success: true });
  } catch (err) {
    console.error('[reorder] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 兼容旧 PUT 请求
app.put('/api/scripts/reorder', (req, res) => {
  try {
    const { order } = req.body;
    console.log('[reorder PUT] order:', JSON.stringify(order));
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array of script ids' });
    }
    const scripts = getScripts();
    const idToScript = new Map(scripts.map(s => [s.id, s]));
    order.forEach((id, idx) => {
      const s = idToScript.get(id);
      if (s) s.orderNum = idx;
    });
    let nextOrder = order.length;
    scripts.forEach(s => {
      if (!order.includes(s.id)) {
        s.orderNum = nextOrder;
        nextOrder += 1;
      }
    });
    saveScripts(scripts);
    res.json({ success: true });
  } catch (err) {
    console.error('[reorder PUT] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==================== 实时流式执行 (SSE) ====================

app.get('/api/scripts/:id/execute-stream', (req, res) => {
  const { id } = req.params;
  const scripts = getScripts();
  const script = scripts.find(s => s.id === id);

  if (!script) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Script not found' })}\n\n`);
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 禁用超时，防止长命令执行时断连
  req.socket.setTimeout(0);
  req.setTimeout(0);

  res.write(`data: ${JSON.stringify({ type: 'start', scriptId: script.id, scriptName: script.name })}\n\n`);

  const execStartTime = Date.now();

  // 心跳保活：每 15 秒发送 SSE 注释，防止代理/浏览器断连
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  // 通过 stdin 原样传入脚本，不做任何转义处理
  const child = spawn(shell.command, []);
  child.stdin.write(script.content);
  child.stdin.end();

  child.stdout.on('data', (data) => {
    res.write(`data: ${JSON.stringify({ type: 'stdout', content: data.toString() })}\n\n`);
  });

  child.stderr.on('data', (data) => {
    res.write(`data: ${JSON.stringify({ type: 'stderr', content: data.toString() })}\n\n`);
  });

  const cleanup = () => {
    clearInterval(heartbeat);
  };

  child.on('close', (code) => {
    cleanup();
    const durationMs = Date.now() - execStartTime;
    res.write(`data: ${JSON.stringify({ type: 'close', exitCode: code, durationMs })}\n\n`);
    res.end();
  });

  child.on('error', (err) => {
    cleanup();
    const durationMs = Date.now() - execStartTime;
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message, durationMs })}\n\n`);
    res.end();
  });

  req.on('close', () => {
    cleanup();
    child.kill('SIGTERM');
  });
});

app.get('/api/scripts/batch-execute-stream', (req, res) => {
  const ids = req.query.ids ? req.query.ids.split(',') : [];

  if (!Array.isArray(ids) || ids.length === 0) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'No script IDs provided' })}\n\n`);
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 禁用超时，防止长命令执行时断连
  req.socket.setTimeout(0);
  req.setTimeout(0);

  // 心跳保活
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  const scripts = getScripts();

  // 并发执行所有脚本
  const children = [];    // 跟踪所有子进程
  let completedCount = 0;
  const totalCount = ids.length;

  const cleanup = () => {
    clearInterval(heartbeat);
  };

  const tryFinish = () => {
    if (completedCount >= totalCount) {
      cleanup();
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  };

  ids.forEach((scriptId) => {
    const script = scripts.find(s => s.id === scriptId);

    if (!script) {
      res.write(`data: ${JSON.stringify({ type: 'start', scriptId, scriptName: 'Unknown' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'error', scriptId, message: 'Script not found' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId, exitCode: -1 })}\n\n`);
      completedCount++;
      tryFinish();
      return;
    }

    const currentId = script.id;
    res.write(`data: ${JSON.stringify({ type: 'start', scriptId: currentId, scriptName: script.name })}\n\n`);

    const execStartTime = Date.now();

    const child = spawn(shell.command, []);
    children.push(child);
    child.stdin.write(script.content);
    child.stdin.end();

    child.stdout.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stdout', scriptId: currentId, content: data.toString() })}\n\n`);
    });

    child.stderr.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stderr', scriptId: currentId, content: data.toString() })}\n\n`);
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - execStartTime;
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId: currentId, exitCode: code, durationMs })}\n\n`);
      completedCount++;
      tryFinish();
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - execStartTime;
      res.write(`data: ${JSON.stringify({ type: 'error', scriptId: currentId, message: err.message, durationMs })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId: currentId, exitCode: -1, durationMs })}\n\n`);
      completedCount++;
      tryFinish();
    });
  });

  req.on('close', () => {
    cleanup();
    children.forEach(child => child.kill('SIGTERM'));
  });
});

// ==================== 启动服务 ====================

const startServer = async () => {
  // 优先使用环境变量 PORT（由 Electron 主进程设置）
  let port = parseInt(process.env.PORT);
  
  if (!port || isNaN(port)) {
    // 如果没有设置 PORT，则动态查找可用端口
    port = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
  } else {
    // 验证指定的端口是否可用
    const isAvailable = await isPortAvailable(port);
    if (!isAvailable) {
      console.log(`Port ${port} is in use, finding alternative...`);
      port = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
    }
  }
  
  if (!port) {
    console.error('Error: No available port found in range', PORT_RANGE_START, '-', PORT_RANGE_END);
    process.exit(1);
  }

  if (port !== DEFAULT_PORT) {
    console.log(`Warning: Port ${DEFAULT_PORT} is in use, using port ${port} instead`);
  }

  fs.writeFileSync(PORT_FILE, port.toString());

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
};

startServer();
