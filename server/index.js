const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { TextDecoder } = require('util');

const app = express();
const DEFAULT_PORT = 3001;
// ⚠️ 不能写 __dirname（打包后在 Program Files\...\resources\server 下，普通用户无写权限会直接崩）
// 改为写到系统临时目录，跨平台可写。
// 该文件仅本应用读取，内容为【本后端】实际监听端口；启动时先清空，避免读到上一次运行的旧端口。
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

// 正确解码外部命令输出。Windows 下不同命令 / 不同机器的代码页差异极大，需分情况：
//   1) 有 BOM → 按 BOM 指示的编码（UTF-16LE / UTF-16BE / UTF-8）。
//   2) 无 BOM 的 UTF-16LE：wsl.exe 在某些系统经管道输出即为「ASCII 以 UTF-16 存放」，
//      表现为奇数下标字节几乎全是 0x00。用强特征（奇数位 NUL 比例 ≥ 0.85）识别，按 UTF-16LE 解。
//      （这是修复「appInfo 里 wsl --version 返回乱码」的关键——它并非 GBK，而是无 BOM 的 UTF-16LE。）
//   3) 其余：在 UTF-8 与 GBK(gb18030) 间二选一，谁产生的替换符（U+FFFD）少用谁；
//      都不含替换符时优先 UTF-8（覆盖「Beta UTF-8 全局开关」开启的系统）。
const decodeShellOutput = (buf) => {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length === 0) return '';

  // 1) BOM 检测
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le').replace(/\0/g, '');
  if (buf[0] === 0xFE && buf[1] === 0xFF) return buf.slice(2).toString('utf16be').replace(/\0/g, '');
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');

  // 2) 无 BOM 的 UTF-16LE：奇数下标字节绝大多数为 0x00
  if (buf.length % 2 === 0) {
    let nullOdd = 0, oddTotal = 0;
    for (let i = 1; i < buf.length; i += 2) { oddTotal++; if (buf[i] === 0) nullOdd++; }
    if (oddTotal > 0 && nullOdd / oddTotal >= 0.85) {
      return buf.toString('utf16le').replace(/\0/g, '').trim();
    }
  }

  // 3) UTF-8 与 GBK(gb18030) 二选一
  //    注意：部分 Node 构建的 Buffer.toString 不支持 'gb18030'，但 util.TextDecoder 支持，
  //    故此处用 TextDecoder 做 GBK 解码。
  const gbkDecoder = new TextDecoder('gb18030');
  const countRep = (s) => { let n = 0; for (const ch of s) if (ch === '�') n++; return n; };
  const u8 = buf.toString('utf8');
  let gb = u8;
  try { gb = gbkDecoder.decode(buf); } catch (e) { gb = u8; }
  if (countRep(u8) === 0 && countRep(gb) === 0) return u8;
  return countRep(gb) <= countRep(u8) ? gb : u8;
};

// 安全取命令首行版本号，统一走 decodeShellOutput（避免 GBK 乱码）
const safeVersion = (cmd, fallback = '') => {
  try {
    const out = decodeShellOutput(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, encoding: 'buffer' }));
    return out.split(/\r?\n/)[0].trim() || fallback;
  } catch (e) {
    return fallback;
  }
};

// 探测【所有】可用 Shell，返回数组。每个 shell 含稳定 id（供前端选择 / 后端记忆），
// 以及真正 spawn 用的 command 与 args。
// 设计目标：把「点击执行后卡在 Waiting for output」这类「看机器」的个体差异，
// 变成用户可在 appInfo 里手动选择正确 shell 的逃生通道——例如避开 WindowsApps 的 0 字节别名壳、
// 改用 System32 真身 wsl.exe，或显式指定某个 WSL 发行版。
const detectShells = () => {
  const isWindows = process.platform === 'win32';
  const shells = [];
  const seen = new Set();

  const addShell = (sh) => {
    if (!sh || !sh.command) return;
    if (seen.has(sh.id)) return;
    seen.add(sh.id);
    shells.push(sh);
  };

  const resolveFullPath = (cmd) => {
    try {
      if (isWindows) {
        const out = decodeShellOutput(execSync(`where ${cmd}`, { timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'buffer' })).trim();
        return out.split(/\r\n/)[0] || out.split(/\n/)[0] || cmd;
      } else {
        const out = decodeShellOutput(execSync(`which ${cmd}`, { timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'buffer' })).trim();
        return out.split(/\n/)[0] || cmd;
      }
    } catch (e) {
      return cmd;
    }
  };

  if (!isWindows) {
    const fullPath = resolveFullPath('bash');
    addShell({
      id: 'bash',
      command: 'bash',
      args: ['-s'],               // -s：从 stdin 读取脚本，非交互式，避免弹终端
      name: 'bash',
      fullPath,
      type: 'bash',
      version: safeVersion('bash --version', 'bash')
    });
    return shells;
  }

  // ---- Windows ----
  // 1) WSL：where wsl.exe 可能返回【多个】路径——System32 真身 + WindowsApps 的 0 字节别名壳。
  //    两者都列出，让用户能避开可能「首次需联网激活」的别名壳，直接选 System32 真身。
  const wslPaths = [];
  try {
    const out = decodeShellOutput(execSync('where wsl.exe', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, encoding: 'buffer' }));
    out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(p => wslPaths.push(p));
  } catch (e) {}

  wslPaths.forEach((p) => {
    const isAlias = /windowsapps[\\/]wsl\.exe$/i.test(p);
    const dir = path.basename(path.dirname(p)).toLowerCase();
    addShell({
      id: `wsl:${p}`,
      command: p,
      args: ['bash', '-s'],       // 经 wsl.exe 非交互式执行，避免弹出 Windows Terminal
      name: isAlias ? `WSL (${dir} 别名壳)` : `WSL (${dir || 'System32'})`,
      fullPath: p,
      type: 'bash',
      // 别名壳未激活时 --version 可能触发联网授权；用 try 兜底，失败则留空，不影响列表展示
      version: safeVersion(`"${p}" --version`, '')
    });
  });

  // 2) WSL 发行版：对每个已安装发行版生成「wsl.exe -d <distro> bash」入口，
  //    让用户能精确指定默认的 WSL 发行版之外的其它发行版（如多发行版 / 指定 Ubuntu / 指定 WSL2 而非 WSL1）。
  //    优先用 System32 真身作为 wsl.exe 命令（避开别名壳在激活阶段的潜在卡顿）。
  const primaryWsl = shells.find(s => s.id.startsWith('wsl:') && !/windowsapps/i.test(s.fullPath)) || shells.find(s => s.id.startsWith('wsl:'));
  if (primaryWsl) {
    try {
      const listOut = decodeShellOutput(execSync(`"${primaryWsl.fullPath}" -l -q`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, encoding: 'buffer' }));
      listOut.split(/\r?\n/)
        .map(s => s.replace(/\0/g, '').trim()) // wsl 输出有时带结尾 NUL
        .filter(Boolean)
        .forEach(distro => {
          // distro 名可能含空格：用 args 数组传递，避免 shell 引号转义问题
          addShell({
            id: `wsl-distro:${distro}`,
            command: primaryWsl.fullPath,
            args: ['-d', distro, 'bash', '-s'],
            name: `WSL: ${distro}`,
            fullPath: primaryWsl.fullPath,
            type: 'bash',
            version: ''
          });
        });
    } catch (e) {}
  }

  // 3) Git Bash：用文件存在性判断（fs.existsSync，毫秒级，不执行任何命令）
  const gitBashCandidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    process.env.ProgramW6432 ? `${process.env.ProgramW6432}\\Git\\bin\\bash.exe` : '',
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Git\\bin\\bash.exe` : '',
  ];
  for (const p of gitBashCandidates) {
    if (p && fs.existsSync(p)) {
      addShell({
        id: `gitbash:${p}`,
        command: p,
        args: ['-s'],              // Git Bash 用 -s 非交互式，避免弹出 MinTTY
        name: 'Git Bash',
        fullPath: p,
        type: 'bash',
        version: safeVersion(`"${p}" --version`, '')
      });
    }
  }

  if (shells.length === 0) {
    // 未找到任何 bash 环境（WSL / Git Bash 均不存在）：无可用 Shell，前端会提示用户安装，
    // 应用继续正常运行（仅脚本执行不可用），绝不崩溃。
    console.log('⚠️  Warning: 未在当前 Windows 环境检测到 WSL / Git Bash，脚本将无法执行（仅支持 bash 语法，须 WSL 或 Git Bash）。');
  }
  return shells;
};

// 探测可用 Shell。任何异常都不应拖垮整个后端：检测失败时降级为「无 Shell」模式，
// 由前端提示用户安装 WSL / Git Bash，应用继续正常运行（仅脚本执行不可用），而非启动即崩溃。
// 同时支持「用户上次选择的 shell」持久化：写在用户数据目录（或临时目录兜底）的 JSON 里，
// 应用重启后仍记住选择，避免每次都要重选。
const SETTINGS_FILE = process.env.SCRIPT_DATA_DIR
  ? path.join(process.env.SCRIPT_DATA_DIR, 'shell-selection.json')
  : path.join(require('os').tmpdir(), 'easyops-shell-selection.json');

let detectedShells = [];
try {
  detectedShells = detectShells();
} catch (e) {
  console.error('[Shell] detection failed, falling back to no-shell mode:', e.message);
}

// 默认选中：优先 System32 真身 wsl（避开别名壳当默认），其次列表首个
const defaultShellId = () => {
  const nonAlias = detectedShells.find(s => s.id.startsWith('wsl:') && !/windowsapps/i.test(s.fullPath));
  return (nonAlias || detectedShells[0] || {}).id || '';
};

const loadSelectedShellId = () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const id = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).selectedShellId;
      if (id && detectedShells.some(s => s.id === id)) return id;
    }
  } catch (e) {}
  return defaultShellId();
};

const saveSelectedShellId = (id) => {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ selectedShellId: id }));
  } catch (e) {}
};

let selectedShellId = loadSelectedShellId();

// 取当前应使用的 shell（用户选中的 > 默认），供执行接口调用——保证「选择后下次执行即时生效」
const getActiveShell = () => {
  if (selectedShellId) {
    const s = detectedShells.find(x => x.id === selectedShellId);
    if (s) return s;
  }
  return detectedShells[0] || { command: '', fullPath: '', type: '', name: '', version: '', args: [] };
};

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
const _activeShell = getActiveShell();
console.log(`[Shell]   Detected: ${detectedShells.length} shell(s)`);
console.log(`[Shell]   Type: ${_activeShell.type.toUpperCase()}`);
console.log(`[Shell]   Command: ${_activeShell.command}`);
if (_activeShell.name) console.log(`[Shell]   Name: ${_activeShell.name}`);
if (_activeShell.version) console.log(`[Shell]   Version: ${_activeShell.version}`);
console.log(`[Shell]   Selected: ${selectedShellId || '(none)'}`);
console.log(`[Locale]  Child env locale: ${CHILD_LOCALE}`);
console.log('========================================');

// API to expose shell info to frontend
app.get('/api/system-info', (req, res) => {
  const active = getActiveShell();
  res.json({
    platform: process.platform,
    arch: process.arch,
    port: serverPort,
    shell: {
      type: active.type,
      command: active.command,
      fullPath: active.fullPath,
      name: active.name,
      version: active.version
    },
    // 所有可用 shell 列表（含稳定 id），供前端在 appInfo 中展示并允许用户选择
    shells: detectedShells,
    // 当前选中的 shell id（用户选择的，或默认）
    selectedShellId: selectedShellId
  });
});

// 选择要使用的 shell：更新内存中的选中项并持久化，下次执行即时生效
app.post('/api/shell/select', (req, res) => {
  const { id } = (req.body || {});
  const target = detectedShells.find(s => s.id === id);
  if (!target) {
    return res.status(404).json({ error: 'Shell not found', id, available: detectedShells.map(s => s.id) });
  }
  selectedShellId = id;
  saveSelectedShellId(id);
  console.log(`[Shell] user selected: ${id}`);
  res.json({
    selectedShellId: id,
    shell: {
      type: target.type,
      command: target.command,
      fullPath: target.fullPath,
      name: target.name,
      version: target.version
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

  // 吞掉底层 socket 已断开（用户提前关掉 SSE）时的 EPIPE 写入错误，
  // 避免未捕获异常导致后端进程崩溃——后端一旦崩溃就无法清理子进程，会留下孤立进程。
  res.on('error', () => {});

  // 取当前选中的 Shell（默认 / 用户在 appInfo 选择的），下次执行即时生效
  const activeShell = getActiveShell();

  // 无可用 Shell（如 Windows 上未安装 WSL / Git Bash）：无法执行，直接返回错误，避免 spawn('') 异常
  if (!activeShell.command) {
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
  const child = spawn(activeShell.command, activeShell.args, { detached: process.platform !== 'win32', windowsHide: true, env: buildChildEnv() });
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

  // 吞掉底层 socket 已断开（用户提前关掉 SSE）时的 EPIPE 写入错误，
  // 避免未捕获异常导致后端进程崩溃——后端一旦崩溃就无法清理子进程，会留下孤立进程。
  res.on('error', () => {});

  // 取当前选中的 Shell（默认 / 用户在 appInfo 选择的），下次执行即时生效
  const activeShell = getActiveShell();

  // 无可用 Shell（如 Windows 上未安装 WSL / Git Bash）：无法执行，逐脚本返回错误后结束
  if (!activeShell.command) {
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
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 15000);

  const scripts = getScripts();

  let completedCount = 0;
  const totalCount = ids.length;
  const children = [];      // 本批次所有子进程：用于「用户提前关闭共享 SSE」时整批强杀
  const batchRunIds = [];   // 本批次每个脚本各自的 runId：用于上面的整批清理时注销 runningProcesses 登记

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
      // 找不到脚本：仍发送三段事件让前端对齐计数，但该脚本无 runId（不会被登记，可被单独跳过）
      res.write(`data: ${JSON.stringify({ type: 'start', runId: '', scriptId, scriptName: 'Unknown' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'error', scriptId, message: 'Script not found' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'close', scriptId, exitCode: -1 })}\n\n`);
      completedCount++;
      tryFinish();
      return;
    }

    // 关键改动：批量里每个脚本使用【独立的 runId】，而非整批共享一个。
    // 这样「单独 Stop 某一个」或「关掉某一个脚本的输出面板」就能只杀它自己的进程树，
    // 不会误伤同批其它仍在跑的脚本（修复「批量进行中关单面板 → 该脚本仍在后台隐藏运行」的泄漏）。
    const scriptRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    batchRunIds.push(scriptRunId);

    res.write(`data: ${JSON.stringify({ type: 'start', runId: scriptRunId, scriptId, scriptName: script.name })}\n\n`);

    const execStartTime = Date.now();

    // detached 仅在非 Windows 平台开启，避免 Windows 上弹出新控制台窗口（见单条执行处注释）
    const child = spawn(activeShell.command, activeShell.args, { detached: process.platform !== 'win32', windowsHide: true, env: buildChildEnv() });
    children.push(child);
    // 以「独立 runId」登记该脚本的子进程：/api/execute/:runId/stop 即可精确命中、只杀这一棵
    runningProcesses.set(scriptRunId, { children: [child], isBatch: true });
    child.stdin.write(script.content);
    child.stdin.end();

    child.stdout.on('data', (data) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'stdout', scriptId, content: data.toString() })}\n\n`);
    });

    child.stderr.on('data', (data) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'stderr', scriptId, content: data.toString() })}\n\n`);
    });

    child.on('close', (code, signal) => {
      // 该脚本自身结束：立刻注销它独立的 runId 登记（自然结束 / 被单独 stop 都会走到这里）
      runningProcesses.delete(scriptRunId);
      if (!res.writableEnded) {
        const durationMs = Date.now() - execStartTime;
        // code 为 null 且 signal 存在，说明是被信号终止的（单独 stop 的 SIGTERM/SIGKILL）
        const terminated = code === null && !!signal;
        res.write(`data: ${JSON.stringify({ type: 'close', scriptId, exitCode: code, signal: signal || null, terminated, durationMs })}\n\n`);
      }
      completedCount++;
      tryFinish();
    });

    child.on('error', (err) => {
      runningProcesses.delete(scriptRunId);
      if (!res.writableEnded) {
        const durationMs = Date.now() - execStartTime;
        res.write(`data: ${JSON.stringify({ type: 'error', scriptId, message: err.message, durationMs })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'close', scriptId, exitCode: -1, durationMs })}\n\n`);
      }
      completedCount++;
      tryFinish();
    });
  });

  // 用户提前关闭整个共享 SSE（关全部 / 关浏览器 / 软件退出）时：
  // 整批强杀所有子进程，并注销本批次全部独立 runId 的登记。
  req.on('close', () => {
    cleanup();
    children.forEach(child => killChild(child));
    batchRunIds.forEach(rid => runningProcesses.delete(rid));
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
  // 端口策略（解决「同时开两个 Electron 应用 → 界面串台」）：
  //   - 主进程传来的 PORT 为 '0'（或 PORT 未设置）→ app.listen(0) 由【操作系统】分配一个
  //     【唯一】的空闲端口，彻底避免与「另一个 Electron 应用」或本机其它服务争抢固定端口
  //     （争抢会导致某一方回退到错误端口 → 渲染进程串台显示别的 App 界面）。
  //   - 不再在固定区间 3001-3100 探测：探测+释放存在 TOCTOU 竞态，且固定区间极易与别的 App 撞车。
  let requestedPort = parseInt(process.env.PORT);
  if (!Number.isInteger(requestedPort) || requestedPort < 0) requestedPort = 0;

  serverPort = requestedPort; // 占位；真正端口以 listen 回调里 server.address().port 为准

  // 清空端口文件里的旧值：避免主进程在超时兜底时读到上一次运行的旧端口（旧端口可能属于已退出的实例）
  try { fs.unlinkSync(PORT_FILE); } catch (e) {}

  const server = app.listen(requestedPort, () => {
    // ⚠️ 关键：requestedPort 为 0 时真实端口由 OS 分配，必须读 server.address().port，不能用 requestedPort
    const actualPort = server.address().port;
    serverPort = actualPort;
    console.log(`Server running on port ${actualPort}` + (requestedPort === 0 ? ' (OS 分配，避免与其它应用争抢)' : ''));

    // 把真实端口写入本应用的端口文件（仅本应用读取，内容为【本后端】真实端口，不会串到别的 App）
    try {
      fs.writeFileSync(PORT_FILE, actualPort.toString());
    } catch (e) {
      console.error('[Server] Warning: could not write port file:', e.message);
    }

    // 通知 Electron 主进程「后端已就绪」并回传【实际】端口，主进程据此加载窗口；
    // 主进程严格使用该端口，避免加载到别的 App 的端口导致界面串台。
    // 仅在作为子进程（fork + ipc）运行时才发送；独立 `npm run server` 时 process.send 不存在，需判空。
    if (typeof process.send === 'function') {
      process.send({ type: 'ready', port: actualPort });
    }
  });

  // 捕获监听失败（端口被占 / 无权限等），把真实错误打到 stderr（会被主进程记入 main.log）
  server.on('error', (err) => {
    console.error(`[Server] 监听端口 ${requestedPort} 失败:`, err.message);
    process.exit(1);
  });
};

startServer();
