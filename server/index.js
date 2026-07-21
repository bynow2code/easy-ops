const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');

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

// ==================== Shell 探测（列出本机所有受支持的 Shell） ====================
// 旧实现只挑「最优一个」Shell；现改为「列出全部可用 Shell」，
// 供前端 App Info 弹窗展示并支持一键切换、持久化。
// 每个 Shell 描述符含：id（稳定标识，用于持久化选中）、type（统一为 'bash'，因本软件只跑 bash 脚本）、
//   name（展示名）、command（spawn 命令）、fullPath（展示用真实路径）、args（spawn 参数，均支持从 stdin 读脚本）、version。
// ⚠️ 只探测「能运行本软件 bash 脚本」的 Shell：POSIX 仅 bash；Windows 仅 WSL / Git Bash。
//   cmd / PowerShell / pwsh / fish / zsh / sh 等非 bash 解释器无法保证兼容下发的 bash 脚本，不列入可切换项。

// 取命令的真实路径（which / where），失败回落到命令名本身
const resolveShellPath = (cmd) => {
  const isWin = process.platform === 'win32';
  try {
    const out = execSync(isWin ? `where ${cmd}` : `which ${cmd}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).toString().trim();
    const first = (isWin ? out.split(/\r?\n/) : out.split('\n'))[0].trim();
    return first || cmd;
  } catch (e) {
    return cmd;
  }
};

// 安全取版本首行（失败返回 ''，绝不抛错拖垮后端）
const detectShellVersion = (command, versionArg = '--version') => {
  try {
    return execSync(`"${command}" ${versionArg}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).toString().split('\n')[0].trim();
  } catch (e) {
    return '';
  }
};

const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  process.env.ProgramW6432 ? `${process.env.ProgramW6432}\\Git\\bin\\bash.exe` : '',
  process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Git\\bin\\bash.exe` : '',
];

const detectAllShells = () => {
  const isWin = process.platform === 'win32';
  const found = [];

  if (!isWin) {
    // POSIX（macOS / Linux）：本软件只跑 bash 脚本，故仅探测 bash 这一种受支持的 Shell。
    // （zsh/sh/fish 等非 bash 解释器无法保证兼容本软件下发的 bash 脚本，不列入可切换项。）
    const fullPath = resolveShellPath('bash');
    // resolveShellPath 失败时回落为命令名本身（未命中 PATH），即本机没装 bash，跳过。
    if (fullPath !== 'bash') {
      found.push({
        id: 'bash',
        type: 'bash',
        name: 'Bash',
        command: 'bash',
        fullPath,
        args: ['-s'],   // -s：非交互式从 stdin 读取脚本，与 Windows 端一致
        version: detectShellVersion('bash'),
      });
    }
    return found;
  }

  // ---- Windows：仅探测受支持的 bash 环境（WSL / Git Bash）----
  // 本软件只执行 bash 脚本，cmd / PowerShell / pwsh 均非 bash 解释器，无法运行下发的脚本，故不列入。
  // 判定均用「存在性 / where」（毫秒级），不实际启动 Shell，避免 WSL 冷启动超时。

  // 1) WSL：where wsl.exe 命中即说明已安装（不拉起 WSL 虚拟机，几乎瞬时）
  let wslPath = '';
  try {
    wslPath = execSync('where wsl.exe', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 })
      .toString().trim().split(/\r?\n/)[0] || '';
  } catch (e) {}
  if (wslPath) {
    found.push({
      id: 'wsl',
      type: 'bash',            // 仍走 bash 语法，便于脚本兼容
      name: 'WSL (bash)',
      command: 'wsl.exe',
      fullPath: wslPath,
      args: ['bash', '-s'],  // 经 wsl.exe 非交互式执行，避免弹出 Windows Terminal
      version: detectShellVersion('wsl.exe', '--version'),
    });
  }

  // 2) Git Bash：文件存在性判断（fs.existsSync，毫秒级，不执行任何命令）
  for (const p of GIT_BASH_CANDIDATES) {
    if (p && fs.existsSync(p)) {
      found.push({
        id: `gitbash:${p}`,
        type: 'bash',
        name: 'Git Bash',
        command: p,
        fullPath: p,
        args: ['-s'],        // Git Bash 用 -s 非交互式，避免弹出 MinTTY
        version: detectShellVersion(p),
      });
    }
  }

  return found;
};

// ==================== 自定义 bash 路径（用户手动添加） ====================
// 有些 bash 装在非标准路径，自动探测扫不到。允许用户手动填路径，
// 我们识别：只有真正是 bash 的才允许添加/使用，否则返回原因，前端提示「不支持，不能添加」。
//
// ⚠️ 安全底线：绝对不能「为了校验就去执行」用户选中的任意文件。
//   图形界面(GUI)子系统程序（如安装包 exe、启动器）在收到 --version 时往往会直接弹出界面，
//   而不是安静退出。因此先静态解析 PE 头读取 Subsystem 字段：
//   若为 GUI(=2) 直接拒绝，绝不执行——从根本上杜绝「点了添加却把安装程序打开了」这类事故。

// 解析 PE 可执行文件的 Subsystem 字段，全程只读文件头、绝不执行。
// 返回：2=GUI(图形界面) / 3=Console(控制台) / 其它子系统编号 / null(非 PE 或不支持读取)。
const getPeSubsystem = (filePath) => {
  let buf;
  try {
    const fd = fs.openSync(filePath, 'r');
    buf = Buffer.alloc(4096);
    fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
  } catch (e) {
    return null; // 读不了就跳过这层检查，交由后续 --version 兜底
  }
  try {
    if (buf.toString('ascii', 0, 2) !== 'MZ') return null;            // 不是 DOS/PE 头
    const peOffset = buf.readUInt32LE(0x3c);                          // PE 头偏移
    if (buf.toString('ascii', peOffset, peOffset + 4) !== 'PE\x00\x00') return null;
    // Subsystem 位于 PE 可选头的 0x44 偏移处（2 字节，小端）
    return buf.readUInt16LE(peOffset + 24 + 0x44);
  } catch (e) {
    return null;
  }
};

// 校验一个可执行文件路径是否为可用的 bash。
// 返回 { ok:true, version, name } 或 { ok:false, reason }。
const validateBashPath = (rawPath) => {
  const p = (rawPath || '').trim().replace(/^["']|["']$/g, ''); // 去掉首尾引号
  if (!p) return { ok: false, reason: 'Path is empty' };

  const isWin = process.platform === 'win32';

  // Windows 上对「文件路径」先做存在性检查（命令名跳过，靠 --version 兜底）。
  const looksLikePath = p.includes('/') || p.includes('\\') || (isWin && /^[a-zA-Z]:/.test(p));
  if (looksLikePath && !fs.existsSync(p)) {
    return { ok: false, reason: 'File not found: ' + p };
  }

  // 🔒 安全守卫：GUI 子系统程序直接拒绝，绝不执行（避免弹出安装界面）。
  if (isWin) {
    const subsystem = getPeSubsystem(p);
    if (subsystem === 2) {
      return {
        ok: false,
        reason: 'This looks like a GUI installer or launcher, not a bash shell. ' +
                'Please select a bash executable (e.g. bash.exe, wsl.exe or Git Bash).',
      };
    }
  }

  // 用 execFileSync（不经 shell，无命令注入风险）运行 --version，并设超时强杀，
  // 确保即便误判，也绝不会留下常驻进程 / 弹窗。
  let out = '';
  try {
    out = execFileSync(p, ['--version'], {
      windowsHide: true,
      timeout: 4000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  } catch (e) {
    // 有的 shell 不认 --version 会非零退出；尝试读取其输出再判定
    out = (e && (e.stdout || e.stderr)) ? (e.stdout || e.stderr).toString() : '';
    if (!out) {
      return { ok: false, reason: 'Failed to execute the file or it returned no version info (it may not be a usable shell)' };
    }
  }

  const firstLine = out.split(/\r?\n/)[0].trim();
  // bash --version 首行形如 "GNU bash, version 5.2.15(1)-release ..."
  if (/\bbash\b/i.test(out)) {
    return { ok: true, version: firstLine, name: firstLine };
  }

  // 识别出是别的 shell（zsh/fish/pwsh/cmd 等）——明确告诉用户不支持
  let kind = 'unknown type';
  if (/\bzsh\b/i.test(out)) kind = 'zsh';
  else if (/\bfish\b/i.test(out)) kind = 'fish';
  else if (/powershell|pwsh/i.test(out)) kind = 'PowerShell';
  else if (firstLine) kind = firstLine;
  return { ok: false, reason: `This path is not bash (detected as ${kind}). EasyOps only runs bash scripts, so it cannot be added` };
};

// 依据一个已校验通过的 bash 路径，构造自定义 Shell 描述符。
// 每次启动/添加时重新校验：路径失效或已不是 bash 则返回 null（自动剔除）。
const buildCustomShell = (rawPath) => {
  const p = (rawPath || '').trim().replace(/^["']|["']$/g, '');
  if (!p) return null;
  const v = validateBashPath(p);
  if (!v.ok) return null;
  return {
    id: `custom:${p}`,
    type: 'bash',
    name: 'Custom Bash',
    command: p,
    fullPath: p,
    args: ['-s'],           // 与其它 bash 一致：非交互式从 stdin 读脚本
    version: v.version || '',
    custom: true,           // 标记为用户自定义，前端可显示「移除」
  };
};

// ==================== Shell 配置（持久化选中 + 自定义路径） ====================
// 持久化文件位于用户数据目录（SCRIPT_DATA_DIR，Electron 下即 userData），
// 保存 { selectedId, customPaths: [] } —— selectedId 只存 id，Shell 真实路径每次启动重探测，
// 避免「Shell 被卸载后配置里还残留无效绝对路径」；customPaths 存用户手动添加的 bash 绝对路径，
// 每次启动重新校验（仍存在且仍是 bash 才保留）。
const SHELL_CONFIG_PATH = process.env.SCRIPT_DATA_DIR
  ? path.join(process.env.SCRIPT_DATA_DIR, 'shell-config.json')
  : path.join(__dirname, 'shell-config.json');

const loadShellConfig = () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(SHELL_CONFIG_PATH, 'utf8'));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (e) {
    return {};
  }
};

const saveShellConfig = (cfg) => {
  try {
    fs.writeFileSync(SHELL_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[Shell] Failed to save shell config:', e.message);
  }
};

// 默认 Shell：保持旧行为——POSIX 用 bash；Windows 优先 WSL，其次 Git Bash，
// 都没有则降级为「无 Shell」（即本机无任何 bash 环境，bash 脚本无法执行）。
// 探测到的全部都是 bash 系，默认自动选第一个 bash（WSL 优先于 Git Bash）。
const pickDefaultShell = (all) => {
  const bash = all.find(s => s.type === 'bash'); // wsl / gitbash 都是 type 'bash'
  if (bash) return bash;
  return { command: '', fullPath: '', type: '', name: '', version: '', args: [] };
};

let shellConfig = loadShellConfig();

// 汇总可用 Shell = 自动探测 + 用户自定义路径（去重、剔除失效项）。
// 自定义路径每次调用都重新校验（buildCustomShell 内部跑 --version），
// 失效或已不是 bash 的自动丢弃，避免列表里出现不可用项。
const buildDetectedShells = () => {
  // 🧪 无 Shell 模式（测试用，持久化在 shell-config.json.noShellMode）：
  // 直接返回空，模拟「本机探测不到任何 bash 解释器」，用于验证无 Shell 时的启动与执行行为。
  if (shellConfig.noShellMode) return [];

  let auto = [];
  try {
    auto = detectAllShells();
  } catch (e) {
    console.error('[Shell] Detection failed, falling back to no-shell mode:', e.message);
  }
  const seen = new Set(auto.map(s => (s.fullPath || s.command).toLowerCase()));
  const custom = [];
  for (const p of (shellConfig.customPaths || [])) {
    const desc = buildCustomShell(p);
    if (!desc) continue;                         // 失效/非 bash：丢弃
    const key = (desc.fullPath || desc.command).toLowerCase();
    if (seen.has(key)) continue;                 // 与自动探测项重复：跳过
    seen.add(key);
    custom.push(desc);
  }
  return [...auto, ...custom];
};

// 汇总全部 Shell（启动时一次；add/remove 后会重建）
let detectedShells = buildDetectedShells();

// 有效 Shell = 持久化选中（若存在且仍可用）优先，否则默认；
// 这是「后续脚本执行」实际使用的 Shell，spawn 处直接读全局 shell。
const resolveEffectiveShell = () => {
  if (shellConfig.selectedId) {
    const picked = detectedShells.find(s => s.id === shellConfig.selectedId);
    if (picked) return picked;
  }
  return pickDefaultShell(detectedShells);
};

let shell = resolveEffectiveShell();

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

// 列出本机所有受支持 Shell + 当前生效 Shell（含持久化的选中项）
// 前端 App Info 弹窗据此展示可切换列表并标记当前项。
app.get('/api/shells', (req, res) => {
  res.json(shellsResponse());
});

// 切换生效 Shell（一键切换 + 持久化）；后续脚本执行均在该 Shell 上进行。
app.post('/api/shells/select', (req, res) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'Missing shell id' });
  }
  const target = detectedShells.find(s => s.id === id);
  if (!target) {
    return res.status(400).json({ error: `Shell not found: ${id}` });
  }
  // 持久化选中（只存 id，路径每次启动重新探测）；保留 customPaths 不被覆盖
  shellConfig = { ...shellConfig, selectedId: id };
  saveShellConfig(shellConfig);
  // 立即生效：后续 spawn 直接读全局 shell
  shell = target;
  console.log(`[Shell] Switched to: ${target.name} (${target.fullPath || target.command})`);
  res.json({
    shells: detectedShells,
    current: {
      id: shell.id,
      type: shell.type,
      name: shell.name,
      command: shell.command,
      fullPath: shell.fullPath,
      version: shell.version,
    },
    selectedId: id,
  });
});

// 统一构造 /api/shells 风格的响应体
const shellsResponse = () => ({
  shells: detectedShells,
  current: {
    id: shell.id,
    type: shell.type,
    name: shell.name,
    command: shell.command,
    fullPath: shell.fullPath,
    version: shell.version,
  },
  selectedId: shellConfig.selectedId || null,
  // 🧪 无 Shell 模式（测试用，持久化在 shell-config.json.noShellMode）
  noShellMode: !!shellConfig.noShellMode,
});

// 添加用户自定义 bash 路径：先校验是否为可用 bash，是则持久化并加入列表，否则返回原因。
app.post('/api/shells/add', (req, res) => {
  const raw = (req.body && req.body.path) || '';
  const p = String(raw).trim().replace(/^["']|["']$/g, '');
  if (!p) {
    return res.status(400).json({ error: 'Please enter the path to a bash executable' });
  }
  // 校验是否为 bash
  const v = validateBashPath(p);
  if (!v.ok) {
    // 不支持：明确告诉用户不能添加，前端弹提示
    return res.status(400).json({ error: v.reason });
  }
  // 去重：与已有（自动探测或已添加）路径相同则不重复添加
  const key = p.toLowerCase();
  const exists = detectedShells.some(s => (s.fullPath || s.command).toLowerCase() === key);
  const customPaths = shellConfig.customPaths || [];
  if (!exists && !customPaths.some(x => x.toLowerCase() === key)) {
    shellConfig = { ...shellConfig, customPaths: [...customPaths, p] };
    saveShellConfig(shellConfig);
  }
  // 重建列表（会重新校验全部自定义路径）
  detectedShells = buildDetectedShells();
  const added = detectedShells.find(s => (s.fullPath || s.command).toLowerCase() === key);
  console.log(`[Shell] Added custom bash: ${p} (${v.version})`);
  res.json({ ...shellsResponse(), added: added ? added.id : null });
});

// 移除用户自定义 bash 路径（仅允许移除 custom 项）。若移除的是当前选中项，回落到默认。
app.post('/api/shells/remove', (req, res) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'Missing shell id' });
  }
  const target = detectedShells.find(s => s.id === id);
  if (!target || !target.custom) {
    return res.status(400).json({ error: 'Only user-added custom paths can be removed' });
  }
  const key = (target.fullPath || target.command).toLowerCase();
  const customPaths = (shellConfig.customPaths || []).filter(x => x.toLowerCase() !== key);
  const wasSelected = shellConfig.selectedId === id;
  shellConfig = { ...shellConfig, customPaths };
  if (wasSelected) delete shellConfig.selectedId; // 移除的是选中项：清除选中，回落默认
  saveShellConfig(shellConfig);
  detectedShells = buildDetectedShells();
  // 若移除了当前生效 Shell，需要重新解析有效 Shell
  if (wasSelected || shell.id === id) {
    shell = resolveEffectiveShell();
    console.log(`[Shell] Removed custom bash, now falling back to: ${shell.name || '(no available shell)'}`);
  }
  res.json(shellsResponse());
});

// 🧪 无 Shell 模式开关（测试用，持久化）：开启后模拟「本机没有任何 bash 解释器」，
// 用于验证无 Shell 时程序的启动与执行行为；关闭则恢复真实探测。
app.post('/api/shells/no-shell-mode', (req, res) => {
  const enabled = !!(req.body && req.body.enabled);
  shellConfig = { ...shellConfig, noShellMode: enabled };
  saveShellConfig(shellConfig);
  detectedShells = buildDetectedShells(); // 开启时短路返回 []；关闭时重新探测
  shell = resolveEffectiveShell();          // 同步全局生效 Shell（开启后变空，关闭后恢复）
  console.log(`[Shell] No-Shell mode: ${enabled ? 'ON' : 'OFF'}`);
  res.json(shellsResponse());
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

  // 吞掉底层 socket 已断开（用户提前关掉 SSE）时的 EPIPE 写入错误，
  // 避免未捕获异常导致后端进程崩溃——后端一旦崩溃就无法清理子进程，会留下孤立进程。
  res.on('error', () => {});

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
    const child = spawn(shell.command, shell.args, { detached: process.platform !== 'win32', windowsHide: true, env: buildChildEnv() });
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
    console.error(`[Server] Failed to listen on port ${requestedPort}:`, err.message);
    process.exit(1);
  });
};

startServer();
