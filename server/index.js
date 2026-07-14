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
// ⚠️ 不能写 __dirname（打包后在 Program Files\...\resources\server 下，普通用户无写权限会直接崩）
// 改为写到系统临时目录，跨平台可写
const PORT_FILE = path.join(require('os').tmpdir(), 'easyops-port.txt');

// 实际监听的端口，供 /api/system-info 暴露给前端（启动后填充）
let serverPort = DEFAULT_PORT;

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
  const result = { command: '', fullPath: '', type: '', name: '', version: '', args: [] };

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
    result.type = 'bash';
    // -s：让 bash 从 stdin 读取并执行脚本，不启动交互式 shell，
    // 在 Windows 上可避免 WSL/Git Bash 弹出终端窗口。
    result.args = ['-s'];
    result.name = result.fullPath;
    try {
      result.version = execSync('bash --version', { timeout: 1000 }).toString().split('\n')[0].trim();
    } catch (e) {}
    return result;
  }

  // ---- Windows：仅检测 WSL / Git Bash（bash 语法脚本） ----
  // 不再支持 cmd.exe 与 PowerShell。脚本使用 bash 语法，须由 WSL 或 Git Bash 执行。
  const possibleBashPaths = [
    // WSL：通过 wsl.exe 非交互式执行 bash，避免弹出 Windows Terminal
    { path: 'C:\\Windows\\System32\\bash.exe', name: 'WSL bash' },
    { path: 'bash', name: 'bash (PATH)' },
    { path: 'C:\\Program Files\\Git\\bin\\bash.exe', name: 'Git Bash (C:\\Program Files\\Git)' },
    { path: 'C:\\Program Files (x86)\\Git\\bin\\bash.exe', name: 'Git Bash (C:\\Program Files (x86)\\Git)' },
    { path: process.env.ProgramW6432 ? `${process.env.ProgramW6432}\\Git\\bin\\bash.exe` : '', name: 'Git Bash' },
    { path: process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Git\\bin\\bash.exe` : '', name: 'Git Bash' },
  ];

  for (const { path: bashPath, name } of possibleBashPaths) {
    if (!bashPath) continue;
    try {
      execSync(`"${bashPath}" -c "echo test"`, { stdio: 'ignore', timeout: 1000 });
      // 解析完整路径，用于判断是否为 WSL 启动器
      let fullPath;
      if (bashPath === 'bash' || !bashPath.includes('\\')) {
        fullPath = resolveFullPath(bashPath);
      } else {
        fullPath = bashPath;
      }
      result.type = 'bash';
      // 判断是否为 WSL 启动器（System32\bash.exe 或 wsl.exe）。
      // 在 Windows 11 上，WSL 的交互式 shell 默认通过 Windows Terminal 启动，
      // 即使 bash.exe 带 -s 也可能弹出终端；改用 wsl.exe 显式执行 "bash -s"
      // 可确保命令在后台直接运行，不触发 Windows Terminal。
      const isWslLauncher =
        /[\\/](System32|SysWOW64)[\\/]bash\.exe$/i.test(fullPath) ||
        /[\\/]wsl\.exe$/i.test(fullPath);
      if (isWslLauncher) {
        result.command = 'wsl.exe';
        // 注意：执行命令用 wsl.exe（避免弹出 Windows Terminal），
        // 但【显示用】的 fullPath 保留真实检测到的 bash 启动器路径
        // （如 C:\Windows\System32\bash.exe），不要写成 'wsl.exe'，否则弹窗里只剩一个无意义的 wsl.exe。
        result.fullPath = fullPath;
        // 通过 wsl.exe 启动 bash，并从 stdin 读取脚本，非交互式、不弹窗
        result.args = ['bash', '-s'];
        result.name = name + ' (via wsl.exe)';
      } else {
        result.command = fullPath;
        result.fullPath = fullPath;
        // 其他 bash（如 Git Bash）也用 -s 非交互式从 stdin 读取，避免弹出 MinTTY
        result.args = ['-s'];
        result.name = name;
      }
      try {
        result.version = execSync(`"${bashPath}" --version`, { timeout: 1000 }).toString().split('\n')[0].trim();
      } catch (e) {}
      return result;
    } catch (e) {}
  }

  // 未找到任何 bash 环境（WSL / Git Bash 均不存在）。
  // 此时无可用 Shell，脚本将无法正常执行；前端 App Info 会显示「未检测到 Shell」。
  console.log('⚠️  Warning: 未在当前 Windows 环境检测到 WSL / Git Bash，脚本将无法执行（仅支持 bash 语法，须 WSL 或 Git Bash）。');
  return result;
};

const shell = detectShell();

// ==================== 子进程 locale 注入 ====================
// GUI（Electron）启动的服务进程往往没有继承终端的 LANG/LC_* 设置，
// 当脚本内部调用 man/manpath 等依赖 locale 的命令时会报
// "can't set the locale; make sure $LC_* and $LANG are correct"。
// 这里检测系统可用的 UTF-8 locale，并在子进程环境缺失/无效时注入。
const AVAILABLE_LOCALES = (() => {
  try {
    return execSync('locale -a 2>/dev/null', { timeout: 1000 })
      .toString().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
})();

const normalizeLocale = (l) => (l || '').trim().toLowerCase();
const isLocaleAvailable = (l) => {
  if (!l) return false;
  const n = normalizeLocale(l);
  const base = n.split('.')[0];
  return AVAILABLE_LOCALES.some(a => {
    const na = normalizeLocale(a);
    return na === n || na.startsWith(base + '.');
  });
};

const CHILD_LOCALE = (() => {
  const utf8 = AVAILABLE_LOCALES.filter(l => /utf-?8/i.test(l));
  const pref = (process.env.LANG || process.env.LC_ALL || '').split('.')[0];
  const pick = (cands) => {
    for (const c of cands) {
      const hit = utf8.find(l => {
        const nl = normalizeLocale(l);
        return nl.startsWith(normalizeLocale(c) + '.') || nl === normalizeLocale(c);
      });
      if (hit) return hit;
    }
    return null;
  };
  return pick(pref ? [pref, 'en_US', 'en'] : ['en_US', 'en']) || utf8[0] || 'C.UTF-8';
})();

// 构造子进程环境：仅当没有有效 locale 时才覆盖，尽量保留用户原有设置
const buildChildEnv = () => {
  const env = { ...process.env };
  const current = env.LANG || env.LC_ALL;
  if (!isLocaleAvailable(current)) {
    env.LANG = CHILD_LOCALE;
    env.LC_ALL = CHILD_LOCALE;
  }
  return env;
};

// 正在执行中的子进程登记表：runId -> { children: [childProcess], isBatch: bool }
// 用于「强制中断」功能：前端拿到 runId 后调用 /api/execute/:runId/stop 整组杀死对应进程
const runningProcesses = new Map();

// 强制杀死一个子进程（含其派生的子命令）：
//  - Windows：taskkill /T /F 按 PID 杀整棵进程树（不可忽略，必定生效）
//  - POSIX：detached 模式下子进程是进程组 leader，用 -pid 向整组发 SIGTERM；
//           SIGTERM 可能被进程忽略，故 500ms 后升级为不可忽略的 SIGKILL，确保彻底中断。
//    该 SIGTERM→SIGKILL 升级内置在此函数内，因此所有调用方（手动「停止」按钮、
//    浏览器中途关闭导致的 req.on('close')）都能得到真正强制的中断，无需各自兜底。
const killChild = (child) => {
  if (!child || child.killed) return false;
  try {
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      } catch (e) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (e) {}
      setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {}
      }, 500);
    }
    return true;
  } catch (e) {
    try { child.kill('SIGKILL'); } catch (_) {}
    return true;
  }
};

// ==================== 退出清理（防孤立进程） ====================
// 软件退出、被中断或崩溃时，必须把仍在运行的脚本子进程一并杀掉，
// 否则 POSIX 上 detached 的脚本进程会成为「孤立进程」继续在后台运行
// （用户担心的「僵尸进程」现象）。
// 注意：exit 事件不允许异步操作，故这里用 SIGKILL 立即终止，
// 不再走 killChild 里「SIGTERM→500ms→SIGKILL」的延迟升级。
const killAllRunning = () => {
  for (const entry of runningProcesses.values()) {
    for (const child of entry.children) {
      if (!child || child.killed) continue;
      try {
        if (process.platform === 'win32') {
          try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); }
          catch (e) { try { child.kill('SIGKILL'); } catch (_) {} }
        } else {
          // 脚本以 detached 启动，是独立的进程组 leader，向整组发 SIGKILL 一锅端
          try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {}
        }
      } catch (e) {}
    }
  }
  runningProcesses.clear();
};

// 信号/退出钩子：Electron 主进程退出时会向本后端发 SIGTERM（fork 的 child.kill('SIGTERM')），
// 这里拦截后先杀干净脚本子进程再退出；process.on('exit') 兜底覆盖其它退出路径
// （如端口冲突导致的 process.exit(1)）。
process.on('SIGTERM', () => { killAllRunning(); process.exit(0); });
process.on('SIGINT', () => { killAllRunning(); process.exit(0); });
process.on('exit', killAllRunning);

console.log('========================================');
console.log('[EasyOps] Script Manager - Backend starting...');
console.log('========================================');
console.log(`[Platform] ${process.platform} (${process.arch})`);
console.log(`[Shell]   Type: ${shell.type.toUpperCase()}`);
console.log(`[Shell]   Command: ${shell.command}`);
if (shell.name) console.log(`[Shell]   Name: ${shell.name}`);
if (shell.version) console.log(`[Shell]   Version: ${shell.version}`);
console.log(`[Locale]  Child env locale: ${CHILD_LOCALE}`);
console.log('========================================');

// API to expose shell info to frontend
app.get('/api/system-info', (req, res) => {
  res.json({
    platform: process.platform,
    arch: process.arch,
    port: serverPort,
    shell: {
      type: shell.type,
      command: shell.command,
      fullPath: shell.fullPath,

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

  const scripts = getScripts();
  const maxOrder = scripts.reduce((max, s) => Math.max(max, s.orderNum != null ? s.orderNum : -1), -1);
  const newScript = {
    id: Date.now().toString(),
    name: name || '',
    content: content || '',
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

  // 无可用 Shell（如 Windows 上未安装 WSL / Git Bash）：无法执行，直接返回错误，避免 spawn('') 异常
  if (!shell.command) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'No available shell detected. On Windows, WSL or Git Bash is required to run bash scripts.' })}\n\n`);
    res.end();
    return;
  }

  // 禁用超时，防止长命令执行时断连
  req.socket.setTimeout(0);
  req.setTimeout(0);

  // 生成本次执行的 runId，供前端「强制中断」使用（必须在使用前定义，避免 TDZ 报错）
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  res.write(`data: ${JSON.stringify({ type: 'start', runId, scriptId: script.id, scriptName: script.name })}\n\n`);

  const execStartTime = Date.now();

  // 心跳保活：每 15 秒发送 SSE 注释，防止代理/浏览器断连
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  // 通过 stdin 原样传入脚本，不做任何转义处理；
  // detached：仅在非 Windows 平台开启，使子进程成为进程组 leader，便于 killChild 用 -pid 整组杀死。
  //   ⚠️ Windows 上 detached: true 的语义是「给子进程分配全新控制台窗口」，会导致弹出终端（含 WSL 的 Windows Terminal），
  //   且 windowsHide 无法覆盖 wsl.exe 拉起的独立终端；Windows 的 killChild 用 taskkill /T /F，本就不依赖 detached，故此处关闭。
  // windowsHide: true 隐藏子进程控制台窗口（非 Windows 平台自动忽略）；
  // shell.args 对 bash 传 '-s'，使其非交互式地从 stdin 读取脚本，避免 WSL/Git Bash 弹出终端。
  const child = spawn(shell.command, shell.args, { detached: process.platform !== 'win32', windowsHide: true, env: buildChildEnv() });
  runningProcesses.set(runId, { children: [child], isBatch: false });
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
    runningProcesses.delete(runId);
  };

  child.on('close', (code, signal) => {
    cleanup();
    const durationMs = Date.now() - execStartTime;
    // code 为 null 且 signal 存在，说明进程是被信号终止的（强制中断的 SIGTERM/SIGKILL）
    const terminated = code === null && !!signal;
    res.write(`data: ${JSON.stringify({ type: 'close', exitCode: code, signal: signal || null, terminated, durationMs })}\n\n`);
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
    killChild(child);
  });
});

app.get('/api/scripts/batch-execute-stream', (req, res) => {
  const ids = req.query.ids ? req.query.ids.split(',') : [];

  if (ids.length === 0) {
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

  // 无可用 Shell（如 Windows 上未安装 WSL / Git Bash）：无法执行，逐脚本返回错误后结束
  if (!shell.command) {
    ids.forEach((scriptId) => {
      res.write(`data: ${JSON.stringify({ type: 'start', runId: '', scriptId, scriptName: 'Unknown' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'error', scriptId, message: 'No available shell detected. On Windows, WSL or Git Bash is required to run bash scripts.' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId, exitCode: -1 })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    return;
  }

  // 禁用超时，防止长命令执行时断连
  req.socket.setTimeout(0);
  req.setTimeout(0);

  // 心跳保活
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  const scripts = getScripts();

  // 并发执行所有脚本（同一批次共享一个 runId，便于「中断」时整批停止）
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const children = [];    // 跟踪所有子进程
  let completedCount = 0;
  const totalCount = ids.length;

  const cleanup = () => {
    clearInterval(heartbeat);
    runningProcesses.delete(runId);
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
      res.write(`data: ${JSON.stringify({ type: 'start', runId, scriptId, scriptName: 'Unknown' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'error', scriptId, message: 'Script not found' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId, exitCode: -1 })}\n\n`);
      completedCount++;
      tryFinish();
      return;
    }

    const currentId = script.id;
    res.write(`data: ${JSON.stringify({ type: 'start', runId, scriptId: currentId, scriptName: script.name })}\n\n`);

    const execStartTime = Date.now();

    // detached 仅在非 Windows 平台开启，避免 Windows 上弹出新控制台窗口（见单条执行处注释）
    const child = spawn(shell.command, shell.args, { detached: process.platform !== 'win32', windowsHide: true, env: buildChildEnv() });
    children.push(child);
    child.stdin.write(script.content);
    child.stdin.end();

    child.stdout.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stdout', scriptId: currentId, content: data.toString() })}\n\n`);
    });

    child.stderr.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stderr', scriptId: currentId, content: data.toString() })}\n\n`);
    });

    child.on('close', (code, signal) => {
      const durationMs = Date.now() - execStartTime;
      const terminated = code === null && !!signal;
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId: currentId, exitCode: code, signal: signal || null, terminated, durationMs })}\n\n`);
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

  // 所有子进程已创建，登记本次批量运行的 runId
  runningProcesses.set(runId, { children, isBatch: true });

  req.on('close', () => {
    cleanup();
    children.forEach(child => killChild(child));
  });
});

// ==================== 强制中断执行 ====================
// 前端拿到执行时的 runId 后，调用此接口杀死对应进程（组）
app.post('/api/execute/:runId/stop', (req, res) => {
  const { runId } = req.params;
  const entry = runningProcesses.get(runId);
  if (!entry) {
    return res.status(404).json({ error: 'No running process for this run', runId });
  }
  let killed = 0;
  entry.children.forEach(child => {
    if (killChild(child)) killed++;
  });
  runningProcesses.delete(runId);
  res.json({ success: true, killed, runId });
});

// ==================== 启动服务 ====================

const startServer = async () => {
  // 优先使用环境变量 PORT（由 Electron 主进程设置）
  let port = parseInt(process.env.PORT);

  if (!port) {
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

  serverPort = port;

  if (port !== DEFAULT_PORT) {
    console.log(`Warning: Port ${DEFAULT_PORT} is in use, using port ${port} instead`);
  }

  try {
    fs.writeFileSync(PORT_FILE, port.toString());
  } catch (e) {
    console.error('[Server] Warning: could not write port file:', e.message);
  }

  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  // 捕获监听失败（端口被占 / 无权限等），把真实错误打到 stderr（会被主进程记入 main.log）
  server.on('error', (err) => {
    console.error(`[Server] 监听端口 ${port} 失败:`, err.message);
    process.exit(1);
  });
};

startServer();
