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

app.use(cors());
app.use(express.json());

const SCRIPTS_FILE = path.join(__dirname, 'scripts.json');

const getScripts = () => {
  try {
    if (fs.existsSync(SCRIPTS_FILE)) {
      return JSON.parse(fs.readFileSync(SCRIPTS_FILE, 'utf8'));
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
console.log('🚀 Script Manager - Backend starting...');
console.log('========================================');
console.log(`📍 Platform: ${process.platform} (${process.arch})`);
console.log(`🐚 Shell Type: ${shell.type.toUpperCase()}`);
console.log(`🔧 Shell Command: ${shell.command} ${shell.args.join(' ')}`);
if (shell.name) console.log(`📛 Shell Name: ${shell.name}`);
if (shell.version) console.log(`📦 Shell Version: ${shell.version}`);
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
  const { name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: 'Name and content are required' });
  }

  const scripts = getScripts();
  const newScript = {
    id: Date.now().toString(),
    name,
    content,
    createdAt: new Date().toISOString()
  };

  scripts.push(newScript);
  saveScripts(scripts);
  res.json(newScript);
});

app.put('/api/scripts/:id', (req, res) => {
  const { id } = req.params;
  const { name, content } = req.body;

  const scripts = getScripts();
  const index = scripts.findIndex(s => s.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Script not found' });
  }

  scripts[index] = { ...scripts[index], name, content };
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

  res.write(`data: ${JSON.stringify({ type: 'start', scriptId: script.id, scriptName: script.name })}\n\n`);

  const child = spawn(shell.command, [...shell.args, script.content]);

  child.stdout.on('data', (data) => {
    res.write(`data: ${JSON.stringify({ type: 'stdout', content: data.toString() })}\n\n`);
  });

  child.stderr.on('data', (data) => {
    res.write(`data: ${JSON.stringify({ type: 'stderr', content: data.toString() })}\n\n`);
  });

  child.on('close', (code) => {
    res.write(`data: ${JSON.stringify({ type: 'close', exitCode: code })}\n\n`);
    res.end();
  });

  child.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  });

  req.on('close', () => {
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

  const scripts = getScripts();
  let childProcess = null;

  const executeNext = async (index) => {
    if (index >= ids.length) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    const scriptId = ids[index];
    const script = scripts.find(s => s.id === scriptId);

    if (!script) {
      res.write(`data: ${JSON.stringify({ type: 'start', scriptId, scriptName: 'Unknown' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'error', scriptId, message: 'Script not found' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId, exitCode: -1 })}\n\n`);
      executeNext(index + 1);
      return;
    }

    const currentId = script.id;
    res.write(`data: ${JSON.stringify({ type: 'start', scriptId: currentId, scriptName: script.name })}\n\n`);

    childProcess = spawn(shell.command, [...shell.args, script.content]);

    childProcess.stdout.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stdout', scriptId: currentId, content: data.toString() })}\n\n`);
    });

    childProcess.stderr.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stderr', scriptId: currentId, content: data.toString() })}\n\n`);
    });

    childProcess.on('close', (code) => {
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId: currentId, exitCode: code })}\n\n`);
      setTimeout(() => executeNext(index + 1), 50);
    });

    childProcess.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', scriptId: currentId, message: err.message })}\n\n`);
      setTimeout(() => executeNext(index + 1), 50);
    });
  };

  executeNext(0);

  req.on('close', () => {
    if (childProcess) {
      childProcess.kill('SIGTERM');
    }
  });
});

// ==================== 启动服务 ====================

const startServer = async () => {
  const port = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
  
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
