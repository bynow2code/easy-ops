const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const app = express();
const PORT = 3001;

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

// 检测可用的 shell
const detectShell = () => {
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    return { command: 'bash', args: ['-c'] };
  }

  const possibleBashPaths = ['bash', 'git\\bash', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];

  for (const bashPath of possibleBashPaths) {
    try {
      execSync(`"${bashPath}" -c "echo test"`, { stdio: 'ignore', timeout: 1000 });
      return { command: bashPath, args: ['-c'] };
    } catch (e) {}
  }

  console.log('Warning: bash not found, using cmd.exe (bash scripts may not work)');
  return { command: 'cmd.exe', args: ['/c'] };
};

const shell = detectShell();

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

// 单脚本流式执行
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

  let output = '';
  let error = '';

  child.stdout.on('data', (data) => {
    const chunk = data.toString();
    output += chunk;
    res.write(`data: ${JSON.stringify({ type: 'stdout', content: chunk })}\n\n`);
  });

  child.stderr.on('data', (data) => {
    const chunk = data.toString();
    error += chunk;
    res.write(`data: ${JSON.stringify({ type: 'stderr', content: chunk })}\n\n`);
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

// 批量流式执行
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
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Script not found' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'close', exitCode: -1 })}\n\n`);
      executeNext(index + 1);
      return;
    }

    res.write(`data: ${JSON.stringify({ type: 'start', scriptId: script.id, scriptName: script.name })}\n\n`);

    childProcess = spawn(shell.command, [...shell.args, script.content]);

    childProcess.stdout.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stdout', content: data.toString() })}\n\n`);
    });

    childProcess.stderr.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stderr', content: data.toString() })}\n\n`);
    });

    childProcess.on('close', (code) => {
      res.write(`data: ${JSON.stringify({ type: 'close', exitCode: code })}\n\n`);
      executeNext(index + 1);
    });

    childProcess.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      executeNext(index + 1);
    });
  };

  executeNext(0);

  req.on('close', () => {
    if (childProcess) {
      childProcess.kill('SIGTERM');
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
