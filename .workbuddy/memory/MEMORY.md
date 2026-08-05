# easy-ops 项目长期记忆（curated）

## 工程原则

- **分层架构**：渲染层(React+xterm) → Preload(IPC) → 主进程(Electron+PTY Host) → 后端(Express+scripts.json) → shared/。跨层只走接口。
- **代码风格**：架构用面向接口/依赖注入；业务用纯函数；生命周期用状态机兜底；注释简明概要。
- **类型安全**：优先 TypeScript；迁移成本高时至少 JSDoc 标注跨层接口。
- **错误处理**：IPC/PTY/后端全链路错误透传，渲染层 ErrorBoundary；不静默吞异常。
- **可测试性**：纯函数加单测；IPC/PTY 关键路径加集成测试。
- **代码质量**：ESLint + Prettier；配置集中到 `shared/config.js`（ENV 覆盖默认值）。
- **Electron 安全**：`contextIsolation: true`、sandbox、preload 白名单、`nodeIntegration: false`。
- **输入校验**：Add Script 等表单前后端双重校验。
- **日志**：`shared/logger.js` 双模式（dev 终端 / prod JSON Lines）。

## Monaco 集成

- ESM 入口（Vite8/Rolldown）：
  `import * as monaco from 'monaco-editor/editor/editor.api'`
  `import 'monaco-editor/languages/definitions/shell/register'`
  `import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'`
  `import editorWorker from 'monaco-editor/editor/editor.worker?worker'`
- v0.56 `package.json` 有 `exports`，裸路径必须写 `monaco-editor/<sub>`，**不能**带 `esm/vs/` 前缀。
- `editor.api` 是裸 API，**不注册 SuggestController**；需要 suggest 必须手动 import contrib。
- `monaco-editor` 放 `devDependencies`。

## 脚本存储与执行模型

- 脚本以数据存 `scripts.json` 的 `content` 字段，无独立 `.sh` 文件。
- 执行：`pty.spawn(interpreter, spawnArgs)`，常驻交互 shell；脚本跑完停在提示符，可继续手敲命令。
- `spawnArgs` 在 `openSession` 内构建：bash 家族追加 `--init-file <init>` 关回显；其余（zsh/fish）空参。
- **bash 家族避免 PS2 空行**：不把多行 content 直接 write 进 PTY，而是先写入 `<userData>/easyops-script-<execId>.sh`，再向 PTY 发送单行 `source <path>; echo "<TOKEN>"; stty echo`。这样脚本输出前不会出现 bash 的 `>` continuation prompt。
- 平台差异只在 shell 选取与 PTY 启停；UI/feature 代码无 `if(platform)`。
- Stop：`killByExec(execId)` → `killSession`；win32 用 `term.kill()`，Unix 杀进程组。
- 重跑前先 kill 旧运行中会话。
- ⚠️ `electron:dev` 前必须 `npm run rebuild:pty`（`node-pty` 原生模块需针对 Electron ABI 重编）。

## Shell 检测后端化

- 权威数据源：Express `/api/shells`、`/api/shells/active`、`/api/shells/no-shell-mode`。
- 主进程 `app.whenReady()` 注入 `EASY_OPS_USER_DATA` 与 `EASYOPS_LOG_DIR` 后 `require('../server/index.js')`。
- 前端 `shellApi.js`：Electron 内用 `http://127.0.0.1:<port>/api`（带重试）；Vite dev 用相对 `/api` 代理到 `127.0.0.1:4521`。
- 失败退化到 `shellStore.js`（localStorage）。

## 脚本配置模型

- `scripts.json`：`{ scripts:[{id,name,group,content,shell}], groups:[...], defaultGroup }`。
- `DEFAULT_GROUP='Default'`；缺 group 归默认分组；默认分组不可删、可重命名。
- 导入/导出格式：`{type:'easyops-scripts-config', version:1, exportedAt, scripts:[{id,name,content}]}`。
- 纯函数：`normalize / applyRemoveGroup / applyRenameGroup / applyImport`。

## 终端完成探测哨兵（2026-08-04 重构，08-04 二次修正）

- **目标**：脚本终端只显示"提示符 + 真实输出 + 一个可交互提示符"，无命令回显、无哨兵语法错误、无多余 PS1、无 PS2 空行。
- **bash 家族**（路径以 bash/wsl 结尾，含 wsl.exe 启动器、Git/System32 bash）：
  - 启动时经 `--init-file <userData>/easyops-shell-init.sh`：先设一个非空占位 `PS1`，再 **`source "$HOME/.bashrc"`**（拿回用户平时终端的 PATH/alias/主题/带路径颜色的 PS1），最后 `stty -echo`（关后续回显）。
    **绝不写死 PS1、不跳过用户配置**——终端外观与平时一致。
  - 脚本内容先写入 `<userData>/easyops-script-<execId>.sh`，再向 PTY 发送单行：
    `source "<bashPath>"; echo "<TOKEN>"; stty echo\n`
  - `source` 避免多行脚本触发 bash PS2（`>`）空行；`stty echo` 在脚本跑完后恢复回显，保证可交互；会话结束 `term.onExit` 中删除临时脚本文件。
  - init / 脚本文件 Windows→bash 路径：`toBashInitPath()`（Git Bash 用 `/<drive>/…`，WSL 用 `/mnt/<drive>/…`）。
- **非 bash 家族**（zsh/fish）：沿用旧方案——脚本 + 独立 `doneMarker`=`\x1b[2K\r\x1b[2K; echo "${doneToken}"`，由 sentinelFilter 处理回显/清行（该分支保留 consumeLines/ANSI 逻辑）。
- `sentinelFilter`：仍以 `token` 整行丢弃哨兵输出；`consumeLines`/`SENTINEL_HINT` 分支为非 bash 保留。
- 跨 chunk 状态由 `ExecutionCard` 用 `filterConsumeRef` 续传；重跑归零。
- `ANSI_CSI_RE` 含 `\x1b`，需 `// eslint-disable-next-line no-control-regex`。

## UI 间距与对齐规则

- 面板层：`.panel--list` / `.panel--exec` 左右内距 **2px**。
- **嵌套缩进**：`.script-row` 相对分组头缩进 **24px**（`padding-left: 24px`）。
- 分组头：`.script-group__head` 左右内距 4px；`.script-group__title` `margin-left: 9px` 对齐 Name 列。
- 执行卡：`.exec-card__head` 左右内距 2px。
- `--bg-hover` 在 `:root` 与 `:root[data-theme='dark']` 两侧定义。

## xterm 视觉样式

- 2026-08-05 改为 Git Bash / mintty 风格：黑底浅灰前景 + 鲜艳 16 色 ANSI 调色板。
- `ExecutionCard` 中 `new Terminal({ fontFamily, fontSize, lineHeight, cursorBlink, theme })`
  - `fontFamily`: `Consolas, "Cascadia Code", "Courier New", monospace`
  - `fontSize`: 14；`lineHeight`: 1.2
  - `cursorBlink`: true（默认方块光标）
  - `theme`: `GITBASH_THEME`（背景 #000000、前景 #bfbfbf、cursor #bfbfbf、selection #555555，ANSI 16 色用 mintty 鲜艳色）。
- 不再跟随应用 light/dark 主题切换，保持稳定的 Git Bash 外观。
- 容器 `.exec-card__term` 无 padding、无背景色覆盖，让 xterm 主题填满容器。

## 视觉验证

- Edge headless + CDP `CSS.forcePseudoState` 可强制 hover 态截图。
- 流程：`Target.createTarget` → attach → enable Page/DOM/CSS/Runtime → `Page.navigate` → `DOM.getDocument({depth:-1})` → `DOM.querySelector` → `CSS.forcePseudoState{forcedPseudoClasses:['hover']}` → `Page.captureScreenshot`。
- 截图写到 workspace 目录（`/tmp` 不持久）。

## 沙盒与 Git 推送

- 沙盒持久化 `.git/objects/` 与 `.git/index`，**不持久化 `.git/refs/`**。
- 正确推送：`git push origin <commit-hash>:<branch>`；先 `git merge-base --is-ancestor <remote-tip> <hash>` 确认 fast-forward。
- Windows 保留名幽灵文件 `nul`：用 PowerShell `[System.IO.File]::Delete('\\?\D:\...\nul')` 删除，或在 `.git/info/exclude` 屏蔽。

## 待补缺口

- 仍待补：TypeScript、README / 贡献约定文档。
- 已知遗留：`test/shell-routes.test.js` 4 例在 Windows 下因 NTFS chmod 不授予 `X_OK` 而失败；属环境差异，server 校验逻辑不动。
- 质量门禁：`npm run lint` / `npm run format` / `npm run format:check` / `npm run test`。
