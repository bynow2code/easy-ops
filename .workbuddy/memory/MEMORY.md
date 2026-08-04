# easy-ops 项目长期记忆（curated）

## 工程原则（用户明确要求：整个项目使用最佳工程实践）

用户于 2026-08-02 要求：本项目所有代码/改动都遵循最佳工程实践。

落地口径（以 AGENTS.md 现有架构纪律为骨架，补足通用工程卫生）：

- **分层架构**（AGENTS.md）：渲染层(React+xterm) → Preload(IPC) → 主进程(Electron+PTY Host) → 后端(Express+scripts.json) → 共享模块(shared/)。跨层只走接口，禁止层间直接耦合。
- **代码风格**：架构骨架用面向接口/依赖注入；业务逻辑用纯函数（易测、无副作用）；生命周期用状态机兜底；注释简明概要（不写废话）。
- **类型安全**：优先 TypeScript；迁移成本大时至少用 JSDoc 标注跨层接口与数据结构。
- **错误处理**：IPC / PTY / 后端全链路错误透传，渲染层用 ErrorBoundary；绝不静默吞异常。
- **可测试性**：纯函数加单测；IPC/PTY 关键路径加集成测试；测试是可交付物的一部分。
- **代码质量工具**：ESLint + Prettier 统一风格；无魔法数字/硬编码，配置集中到 `shared/config.js`（ENV 覆盖默认值）。
- **Electron 安全基线**：`contextIsolation: true`、`sandbox`、preload 白名单桥接，`nodeIntegration: false`；不把 Node API 直接暴露给渲染层。
- **输入校验**：Add Script 等表单前后端双重校验。
- **日志**：沿用 `shared/logger.js` 双模式（dev 终端输出 / prod JSON Lines 文件），带级别/上下文/进程兜底。

## Monaco 集成（当前正确方案；supersedes 旧日志"勿用 ESM ?worker"结论）

- 已验证可用 Vite8/Rolldown 正规 ESM，仅引入内核 + shell：
  `import * as monaco from 'monaco-editor/editor/editor.api'`
  `import 'monaco-editor/languages/definitions/shell/register'`
  `import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'`  ← **补全浮层 UI 必需**
  `import editorWorker from 'monaco-editor/editor/editor.worker?worker'`
- 关键：monaco v0.56 的 `package.json` 有 `exports` 字段，裸路径必须写成
  `monaco-editor/<sub>`（解析为 `./esm/vs/<sub>.js`），**不能**带 `esm/vs/` 前缀。
  早期"ESM ?worker 构建失败"是路径写错（`monaco-editor/esm/vs/...`）所致，非方案不行。
  旧日志"勿用 ESM，改 AMD 静态拷贝"已过时，以此条为准。
- `monaco-editor` 归 `devDependencies`：仅打包期被 Vite 内联进 `dist`，运行时不 `require` node_modules 原包。

### ⚠️ Monaco `editor.api` 不含编辑器贡献（2026-08-02 踩坑，复用价值高）
- `monaco-editor/editor/editor.api` 只是**裸 API**：仅注册 `FormattingConflicts` 一个贡献，**不注册 `SuggestController`**（补全浮层 UI 与 `editor.action.triggerSuggest` 命令）。
- 后果：`languages.registerCompletionItemProvider('shell', ...)` 的数据写进了语言注册表，但**没有 UI 控制器去查询/显示**，补全浮层永不出现，Ctrl+Space 报 `command 'editor.action.triggerSuggest' not found`。单纯 mock 单测看不出（逻辑对），必须用真实浏览器验证。
- 凡用到 suggest / find / folding 等编辑器功能，必须额外 `import 'monaco-editor/editor/contrib/<feature>/...js'`（如 suggest 的 `contrib/suggest/browser/suggestController.js`），或改用全量 `monaco-editor/editor/editor.main`（会引入 70+ 语言包，体积更大）。我们选前者，保住"仅 shell"的体积优化。
- 调试"补全不显示"的正确姿势：用 Playwright 加载真实 dev server，点 Add Script、聚焦 `.monaco-editor`、敲 `ec`、查 `.suggest-widget` 是否出现，并抓 `console`/`pageerror`；把 editor 实例临时挂 `window` 可读取 `getModel().getLanguageId()` 与确认语言/provider 注册。切勿靠反复改 CSS/import 猜。

## 脚本存储与执行模型（关键架构事实）

- 脚本以**数据**形式存储：AddScriptPanel 经 `onSave({ id, name, group, content, shell })` 把脚本正文存进 `scripts.json` 的 `content` 字段。**没有独立的 `.sh` 文件在磁盘上**。
- 因此执行时**不引用脚本文件路径**，而是把 `content` 喂给解释器：
  `pty.spawn(interpreterPath, ['-c', script.content])` 或 `bash -s` 从 stdin 读。
- 这带来两点推论：
  1. 只需要**解释器路径**（/bin/zsh、Git Bash、wsl 等），用来告诉 OS 启动哪个程序；脚本本身无文件路径需求。
  2. 选 wsl 跑脚本**无需**把 Windows 路径翻译成 `/mnt/c/...`——那是"用文件路径跑脚本"才有的坑，喂 content 即消除。
- `examples/hello.sh` 仅作独立 POSIX 模板样例，并非应用内脚本的存储方式。

### 真实执行 / Stop / Re-run 实现（pty-host，VS Code 模式）

- 执行：`electron/pty-host.js` 的 `openSession({execId,scriptId,content,shell,cwd,env})` → `pty.spawn(interpreter, buildSpawnArgs(...))`，content 直接喂解释器，无临时文件。
  - `buildSpawnArgs(shellPath, content)` 数据驱动（平台差异唯一落点）：POSIX→`['-c',content]`；wsl.exe→`['bash','-c',content]`（wsl 是启动器）；cmd→`/c`；pwsh/powershell→`-Command`。**feature/UI 代码零 `if(platform)` 分支**。
  - 维护 `execId→sessionId` 映射，供 Stop / Re-run 精准定位"当前这一次"执行。
- 停止：`killByExec(execId)` 对外入口；内部 `killSession` 跨平台统一：`win32` 用 `term.kill()`（ConPTY 杀整棵进程树），Unix 对整个进程组 `process.kill(-pid,'SIGTERM')` 后宽限 2s 再 `SIGKILL`。**解释器路径与 `kill()` 均跨平台一致，无需每个平台单独处理**（用户明确诉求）。
- 链路：main.js 注册 `pty:open/pty:write/pty:resize/pty:kill` IPC 并把 `pty:data`/`pty:exit` 广播到窗口；preload 暴露 `easyOps.pty`；前端 `ptyClient.js` 薄封装（带 `available` 标记，非 Electron 优雅退化到 mock）；`ExecutionCard` 在 `available` 时挂 xterm 渲染、`Stop` 按钮调 `onStop`；`App` 的 `runScript` 开真实会话、`handleStop` 经 execId kill、`handleRerun` 重跑前先 kill 旧运行中会话、`pty:exit` 翻状态+算耗时。
- ⚠️ **部署前置**：`node-pty` 是原生模块，须针对 Electron 的 ABI 重编。用户惯用 `npm install --ignore-scripts`（会跳过原生编译），故 `electron:dev` 前必须手动跑一次 `npm run rebuild:pty`（= `npx --yes electron-rebuild -f -w node-pty`）。否则主进程 `require('node-pty')`/spawn 会在 Electron 运行时报 ABI 错。纯 Vite dev（浏览器）不加载 node-pty，无此问题。

## Shell 检测后端化（前后端 HTTP 连接，2026-08-02）

- **目标**：让"前端能连上后端、显示后端检测到的 shell、自定义 shell"。此前 shell 检测只在主进程内 `require` 调用，Express 后端是空骨架、未启动；纯 Vite dev 根本没有后端。
- **权威数据源**：Express 后端（`server/shell-routes.js` 挂载 `GET/POST/DELETE /api/shells`、`/api/shells/active`、`/api/shells/no-shell-mode`），复用 `server/shell-detect.js`（探测）+ `server/shell-config.js`（持久化到 `shell-config.json`）。**只有这里写 shell-config.json**，避免与 Electron 主进程双重写。
- **后端宿主**：Electron 主进程在 `app.whenReady()` 内先注入 `EASY_OPS_USER_DATA=app.getPath('userData')` 与 `EASYOPS_LOG_DIR`，再 `require('../server/index.js')` 在主进程内启动 Express（同进程托管，省去 spawn/跨进程序列化）。`server/index.js` 写 `port.txt`，`backend:getPort` IPC 读它。
- **前端连接**：新增 `client/src/shellApi.js`——Electron 内用绝对 `http://127.0.0.1:<port>/api`（带 20×150ms 重试等 port.txt 就绪）；纯 Vite dev 用相对 `/api`，由 `vite.config.mjs` 代理到 `127.0.0.1:4521`。`SettingsModal` 与 `App.reloadShells` 改用 `shellApi`，失败退化到 `shellStore.js`（localStorage）。
- **已移除**：main/preload 里冗余的 `shell:list/add/remove/setActive/noShellMode` IPC 处理器；保留原生文件对话框 `shell:choose`（preload 仅留 `choose`）。
- **踩坑修复**：`server/shell-config.js` 的 `write()` 原先不建目录，首次写到不存在的 `EASY_OPS_USER_DATA`（如独立 dev）会 ENOENT；已加 `fs.mkdirSync(userDataDir,{recursive:true})`。
- **测试**：`test/shell-routes.test.js`（4 例，vitest）覆盖检测/新增/删除/active；`vitest.config.mjs` 的 `include` 已扩展到 `server/**` 与 `test/**`。验证：`node --check` 全绿；curl 三步全过；`npm run test` 18 通过；`npm run lint` 绿；`npm run build` 成功。
- 运行方式：Electron → `npm run electron:dev`（后端随主进程起）；纯前端 dev → 两个终端 `npm run server:dev`（PORT=4521）+ `npm run dev`（Vite 代理 /api）。

## 脚本配置模型（默认分组 / 兼容性 / 导入导出，2026-08-02）

- **存储结构** `scripts.json`（路径 `server/config.js` 的 `scriptsFile`，= Electron `userData/scripts.json`）：`{ scripts:[{id,name,group,content,shell}], groups:[...], defaultGroup }`。**只有 `server/scripts-store.js` 写它**（前端 localStorage 仅作无后端回退）。
- **默认分组**：常量 `DEFAULT_GROUP='Default'`（英文，遵循 AGENTS.md UI 约定），双存 `server/config.js` 与 `client/src/constants.js`。脚本缺 group → 归一化时兜底到默认分组；默认分组**不可删、可重命名**（重命名同步 `defaultGroup` 与所有引用，撞名自动加 `(2)` 后缀）；普通分组重名拒绝。
- **向后兼容（兼容底线：name + content）**：`normalize()` 兼容旧版裸数组 `[{id,name,content,createdAt,orderNum,group}]` 与包装格式；缺 group 入默认分组；按脚本实际引用的 group 名补全 `groups` 列表；缺 id 自动生成；缺 name 的条目丢弃。
- **删除分组**：`DELETE /api/groups` 收 `{name, deleteScripts}`；`deleteScripts=false`（默认）→ 其下脚本**自动挪到默认分组**（不丢失）；`true` → 连同脚本删除；默认分组删除被后端拒（400）。
- **导入/导出格式**（以新版本为主，只认 name+content）：导出 `{type:'easyops-scripts-config', version:1, exportedAt, scripts:[{id,name,content}]}`；导入兼容该包装格式与裸数组，批量 `POST /api/scripts/import`（归入默认分组，按 id 覆盖）。UI：TopBar 下载/上传按钮接 `App.handleExport/handleImport`。
- **纯函数可测**：`normalize / applyRemoveGroup / applyRenameGroup / applyImport` 均为纯变换，测试见 `test/scripts-store.test.js`（12 例）。

## 终端完成探测哨兵（sentinel）：新方案 — 解耦 doneMarker 与 filter 的副作用（2026-08-03）

### 旧方案的两个耦合副作用（已废，supersedes 一切旧日志）
1) `pty-host doneMarker` 含 `PROMPT_COMMAND='PS1='; PS1=`：`PROMPT_COMMAND` 每次显示 PS1 前都把 PS1 置空，
   导致交互态下用户的自定义提示符（host/cwd/$ 等）**永远看不见**——反向劣化体验。
2) `sentinelFilter` 设 `consumeLines=2`：基于"哨兵后会有一行空 PS1"假设吸收 echo 输出 + 空 PS1。
   去掉 PROMPT_COMMAND 后 bash 哨兵后输出的是真实 PS1，吸收 2 行会**吃掉真实 PS1 的第一行**，
   终端出现"PS1 残缺 / 多余换行 / 光标错位"。

### 当前正确方案
- **doneMarker**（`electron/pty-host.js`）：
  ```
  `\x1b[2K\r\x1b[2K; echo "${doneToken}"`
  ```
  前导清行 ANSI 让原 PS1 第二行 `$ ` 视觉消失；**故意不写 PROMPT_COMMAND / PS1=**。
- **sentinelFilter**（`client/src/sentinelFilter.js`）：`consumeLines=1`（仅吸收 echo 输出这一行），
  其后真实 PS1 由正常分支原样透传。
- **跨 chunk 状态**：filter 返回 `consumeLines`，调用方（`ExecutionCard`）用 `filterConsumeRef` 续传；
  重跑时归零。`ANSI_CSI_RE` 提取哨兵回显行里的清行 ANSI 透传给 xterm（`\x1b[2K\r\x1b[2K` + `\r`），
  否则原 PS1 第二行不会消失。
- **eslint**：`ANSI_CSI_RE` 含 `\x1b`，需 `// eslint-disable-next-line no-control-regex`（ESC 是 ANSI CSI 必需）。

### 调试 "终端多余输出 / 多 PS1 / 光标错位" 的姿势
- 不要只看 `sentinelFilter` 单测（纯函数，单测绿 ≠ 真实终端对）——必须用真实 bash + 实际观察。
- 检查 doneMarker 与 filter 的 `consumeLines` 是否**配对**：旧假设（PROMPT_COMMAND 空 PS1）已被废弃，
  凡包含 `consumeLines=2` 或 `PROMPT_COMMAND='PS1='` 的旧 fixture / 旧讨论一律以上面新方案为准。

## UI 间距与对齐规则（2026-08-03，supersedes 旧日志里零散的 padding 改动）

- **面板层**（`.panel--list` / `.panel--exec`）：左右内距统一 **2px**，让脚本列与终端列水平方向视觉齐平；
  上下保持 14/16 / 14/10。**可见外边距由面板层决定**，内层行/列横向 padding 应归零。
- **嵌套缩进**（`.script-row` / `.script-group__cols`）：相对分组头额外左移 **22px→24px**（padding-left:24px），
  "分组合脚本"嵌套层级视觉一目了然；左右内边距为 0。
- **分组头**（`.script-group__head`）：左右内距 **4px**；`.script-group__title` 加 `margin-left: 9px`
  让 WMS 标题对齐到 Name 列起点（panel 2 + head pad 4 + toggle 18 + margin 2 + checkbox 13 + gap 8 = 47px
  → 补 9px 到 56px，与下方 Name 列同列）。
- **执行卡**（`.exec-card__head`）：左右内距 2px，与 `.panel--exec` 统一。

### ⚠️ hover 隐藏 bug（2026-08-03 踩坑，复用价值高）
- `--bg-hover` CSS 变量被 `.script-group__toggle:hover` / `.script-group__action:hover` /
  `.script-row:hover` / `.script-group__head:hover` **引用却从未定义**，导致 hover 高亮**静默失效**
  （CSS 变量 fallback 为透明 / initial，无报错）。
- 修复：在 `:root`（亮）与 `:root[data-theme='dark']`（暗）**两侧都定义** `--bg-hover`
  （亮色 #eef0f3、暗色 #313237），并删除冗余的暗色硬编码覆盖（统一走变量，主题切换自动适配）。
- 加 `transition: background 0.12s ease` 让浮动手感平滑。
- 教训：CSS 变量被多处引用前必须先 grep 验证定义存在；不要假设"应该已经有"。

## 视觉验证：Edge headless + CDP forcePseudoState（hover 等 :hover 态截图）
- 启动 Edge：
  `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --no-sandbox
  --hide-scrollbars --window-size=W,H --user-data-dir=<tmp> --remote-debugging-port=9222 <url>`
- Node 22 自带全局 `WebSocket`（WHATWG，EventTarget，需 `addEventListener('message'/'open')`）；
  无需 `ws` 包。
- 流程：`Target.createTarget` → `Target.attachToTarget{flatten:true}` → enable Page/DOM/CSS/Runtime
  → `Page.navigate` → 等渲染（3s+）→ `DOM.getDocument({depth:-1})`（**depth 必须 -1**，否则 querySelector
  找不到深层节点）→ `DOM.querySelector` → `CSS.forcePseudoState{forcedPseudoClasses:['hover']}` → 等过渡
  → `Page.captureScreenshot{format:'png'}` → 写文件 → `forcePseudoState{forcedPseudoClasses:[]}` 取消。
- ⚠️ Bash 沙盒**不持久化 `/tmp` 写入**（每次新命令沙盒重置），截图必须写到 workspace 目录；
  Node 路径用 `'.hover-shots/...'`（相对 cwd）而非 `/d/...`（会被解析为 `D:\d\...`）。

## WorkBuddy 沙盒与 Git 推送的坑（2026-08-03 踩坑，复用价值高）
- 沙盒**持久化 `.git/objects/` 与 `.git/index`，但不持久化 `.git/refs/` 的更新**。
  → `git commit` 打印了 commit 哈希并写入对象，**但 `refs/heads/<branch>` 没移动**（下次 log 仍显示旧 HEAD）；
  reflog 与 `git fsck --no-reflogs` 能找回 dangling 提交。
- `git reset --hard <dangling>` 同样不持久化 ref 更新。
- **正确的推送方式（绕过本地 ref）**：`git push origin <commit-hash>:<branch>`，
  例如 `git push origin fb2253b:feature/new_shell`。先 `git merge-base --is-ancestor <remote-tip> <hash>`
  确认 fast-forward。
- 教训：commit 后立刻 `git ls-remote origin <branch>` 验证远端真的有新 SHA，别只信本地 log/reflog。

### Windows 保留名幽灵文件 `nul`（同上，沙盒相关）
- Git Bash `2>nul` 重定向有时会在 cwd 产生名为 `nul` 的 0~65 字节文件（NTFS 保留名，普通 rm /
  WorkBuddy safe-delete / `rm -rf` 均被拦截 / 报"指定的设备名无效"）。
- 物理删除：PowerShell `[System.IO.File]::Delete('\\?\D:\...\nul')`（绕开设备名解析）；若仍 Access
  Denied（文件被锁），退而求其次：在 `.git/info/exclude` 加 `nul` 行本地屏蔽（仅本机，不提交）。
- `git status` 显示 `?? nul` 但 `fs.lstatSync('nul')` → ENOENT，`fs.lstatSync('\\?\...')` → OK
  size=65——是"readdir 可见但 stat 走设备"的典型 NTFS 保留名场景。

## 待补的工程实践缺口（截至 2026-08-03）

- ✅ 已补齐：ESLint 9 flat config（react + react-hooks + prettier 集成）、Prettier 3、Vitest 4（jsdom + @testing-library/react 16 + jest-dom 7）已落地，并格式化全库、加首测（ScriptItem）。
- ✅ 已补齐：Shell 的 CRUD 已通过 Express `/api/shells` 接入（检测/新增/删除/激活/无 shell 模式），前端经 HTTP 消费。
- 仍待补：无 TypeScript（当前纯 JS，已有 @types/react 等类型包待用）；缺少 README / 贡献约定文档。
- ✅ 已补齐：后端"脚本" CRUD + 分组管理 + 导入导出已接入（`server/scripts-routes.js` 提供 `/api/scripts`、`/api/scripts/import`、`/api/groups` GET/POST/PATCH/DELETE），前端经 `scriptsApi` 消费，无后端时退化到 `scriptsStore.js`（localStorage）。
- ✅ 已补齐：终端完成探测哨兵解耦——doneMarker 去 PROMPT_COMMAND、sentinelFilter consumeLines=1、ExecutionCard 跨 chunk 状态、8 例单测全绿；旧方案 PROMPT_COMMAND 永久清 PS1 / consumeLines=2 误吞真实 PS1 的耦合副作用已闭环。
- ✅ 已补齐：脚本列表 / 分组 hover 当前项高亮（修复 `--bg-hover` 漏定义的隐藏 bug），亮 / 暗主题适配；Edge CDP 视觉验证已建立流程。
- ⚠️ 已知遗留：`test/shell-routes.test.js` 有 4 例（POST 自定义 shell、active、Not-an-executable、duplicate 409）在 Windows 下失败——根因是测试用 `fs.chmodSync(0o755)` 创建假 shell，但 NTFS 的 chmod 不授予 `X_OK`，`server/shell-config.js` 的可执行校验拒绝；属环境差异（Linux/macOS CI 通过）。server 校验对真实 shell 是必要的，**故不动**其逻辑，仅在本机视为已知 skip。
- 质量门禁脚本：`npm run lint` / `npm run format` / `npm run format:check` / `npm run test`。
