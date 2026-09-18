# EasyOps 脚本管家

> 一个帮你**集中管理、随手执行 Shell 脚本**的桌面小工具。把零散的运维/开发脚本收进一个窗口，分组、编辑、一键运行、在真实终端里交互，不用再满硬盘找脚本、开终端敲命令。

> 当前分支 `feature/new` 是基于 Electron + electron-vite 的**重构版本**（v0.8.0）。旧版（v0.7.15）保留在 `master` 分支。

---

## 这是什么，解决什么问题

日常开发中手里总有一堆零散脚本：启动后端、拉起前端、数据库备份、清理缓存、部署发布、定时巡检……它们散落在各个文件夹里，时间一长就**记不住放哪、想不起参数、复制粘贴还容易敲错**。

EasyOps 把这些脚本统一管起来：

- **不再翻文件夹**：所有脚本都在一个窗口里，按分组排列，支持搜索。
- **不用开终端**：点一下就跑，而且跑在**真正的终端**里 —— 输出实时滚动，脚本还能读你的输入。
- **不怕忘**：脚本内容、所属分组、用哪个 shell 都保存在应用里，下次直接用。
- **一个脚本一份环境**：同一个脚本可以指定用 zsh 跑、另一个用 bash 跑，互不干扰。

---

## 核心功能

| 功能 | 说明 |
|------|------|
| 📁 **脚本管理** | 新建、编辑、复制、删除脚本；脚本名必填、最长 30 字符。行内四个操作按钮：**执行 / 编辑 / 复制 / 删除** |
| 📋 **复制脚本** | 一键生成副本，内容、分组、脚本级 shell 全部照搬；副本名自动取「原名 副本」，重名则递增为「副本 2」「副本 3」，并自动选中新副本 |
| 🗂️ **分组管理** | 分组可选（`groupId` 可为空，即「未分组」）；分组名必填、最长 15 字符；可在分组标题处直接新建脚本 |
| 🔍 **搜索** | 按名称或脚本内容实时过滤 |
| 🖥️ **真实交互终端** | 基于 node-pty + xterm.js，不是「输出面板」—— 脚本能读 stdin，你也可以直接在里面敲命令；支持单个关闭与一键关闭全部、终端最大化/还原；终端标题为脚本名（同名脚本自动加序号区分） |
| 🐚 **脚本级 Shell 覆盖** | 在「新建/编辑脚本」弹窗里单独指定某个脚本用哪个 shell；不指定则跟随全局默认。若指定的 shell 后来被删除，编辑时会显示「已不可用」占位且保存不丢原值 |
| 🎨 **语法高亮编辑器** | CodeMirror 6 + shell 语法模式，带 shell 命令关键字补全 |
| 🌗 **主题三态** | 深色 / 浅色 / 跟随系统，入口在**顶栏**（设置面板不含主题项，避免重复入口） |
| 📤 **导入 / 导出配置** | 导出为 `easyops-config` v2 格式的 JSON；支持导入 v2 配置，也支持从旧版（v0.7.x）导出的 JSON 或旧版数据目录里的 `scripts.json` 迁移；导入前会二次确认，且对结构做校验 |
| 🔔 **检查更新** | 启动时可自动检查更新，也可在设置里手动检查。采用**无代码签名**方案（见下文） |
| 💻 **跨平台** | 三平台打包：macOS（dmg，Intel + Apple Silicon）、Windows（nsis）、Linux（AppImage / deb / rpm）；自动检测 zsh / bash / csh / dash / ksh / sh / tcsh，Windows 下另含 Git Bash 与 WSL |

### 与旧版（v0.7.x）的差异

重构版本按需求清单重写了功能集，**以下旧版特性目前尚未回归**：批量执行、拖拽排序、系统原生通知、以及独立于终端的「输出面板」（新版直接用真实终端替代）。

---

## 怎么用

### 1. 安装

- **macOS**：下载 `.dmg`，按架构选择 Intel 或 Apple Silicon 版本。
- **Windows**：下载 `EasyOps-Setup-<version>.exe`（NSIS）。
- **Linux**：下载 `.AppImage`（通用便携）、`.deb`（Debian / Ubuntu）或 `.rpm`（Fedora / CentOS），按发行版选择。

> 未做代码签名，macOS 首次打开可能需要右键「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/EasyOps.app`。

### 2. 新建脚本

点侧边栏「新建脚本」（或在某个分组标题处点 `+`，新脚本会直接落进那个分组），填写：

| 字段 | 说明 |
|------|------|
| 脚本名称 | 必填，最长 30 字符 |
| 分组 | 可留空 |
| **Shell** | 默认「跟随全局」；选择具体 shell 后，该脚本不再跟随全局默认 |
| 脚本内容 | 必填，shell 语法高亮 + 命令补全 |

点「保存」一次性提交以上四项。

### 3. 运行脚本

点脚本行左侧的 ▶（执行）按钮，应用会**新开一个终端标签**并在其中运行该脚本。

- 脚本执行结束后终端**不会自动关闭** —— 提示符会回到你面前，方便查看结果或继续敲命令。
- 想中断正在跑的脚本：在终端里按 `Ctrl+C`。
- 关闭终端：标签上的关闭按钮，或右上角「关闭全部」。

**关于启动速度**：终端启动的是**交互式 shell**（`-i`），会加载你的 `~/.zshrc` / `~/.bashrc`。如果你在 rc 里 source 了 nvm、oh-my-zsh 之类的重物，**从点执行到脚本真正开始跑之间会有相应延迟**（实测本机上 `zsh -i` 冷启动约 6.7 秒，`bash -i` 约 0.007 秒）。这是 shell 自身的开销，不是应用卡住；期间终端里会先回显一行 `source '...'`。

### 4. 复制脚本

点脚本行的复制按钮即可。副本与源脚本同分组，内容与 shell 设置一致，名称自动加「副本」后缀。

### 5. 导入 / 导出配置

设置面板 →「配置」：

- **导出当前配置**：落盘为一份 v2 JSON，含脚本、分组与设置。
- **导入配置**：导入 v2 JSON。
- **导入旧版配置**：从 v0.7.x 导出的 JSON 或旧版数据目录里的 `scripts.json` 迁移。

> ⚠️ 导入是**全量覆盖**，且会先二次确认。请先退出旧版 EasyOps，避免两边同时写同一份数据。

### 6. 设置面板

- 版本号、Git 仓库链接
- 「启动时检查更新」开关 + 手动检查更新
- **Shell**：列出检测到的 shell 与自定义 shell，可切换全局默认、重新检测、通过文件浏览器添加自定义 shell 路径
- 配置导入 / 导出

---

## 数据存放位置

均通过 electron-store 落盘在 Electron 的 `userData` 目录下：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/easyops/` |
| Windows | `%APPDATA%\easyops\` |
| Linux | `~/.config/easyops/` |

| 文件 | 内容 |
|------|------|
| `easyops-scripts.json` | 脚本与分组（键名 `data`） |
| `easyops-settings.json` | 主题、全局 shell、自定义 shell、启动检查更新 |

---

## 开发

### 环境要求

- Node.js 22+（CI 使用 22）
- npm

### 常用命令

```bash
npm install          # 装依赖(会触发 electron-builder install-app-deps 重建原生模块)
npm run dev          # 开发模式(electron-vite dev,主进程改动会自动重启)
npm run typecheck    # 三进程类型检查(tsc --noEmit,node + web 两套)
npm test             # 全量单测(vitest run)
npm run build        # typecheck + electron-vite build
npm start            # 预览构建产物
```

### 架构

三进程结构，**没有独立 HTTP server**，渲染层的一切能力都经 IPC 取得：

```
src/
├── main/          # 主进程(CJS 输出)
│   ├── index.ts       # 入口:单实例锁、store 装配、IPC 注册、退出时回收终端
│   ├── window.ts      # 窗口创建
│   ├── ipc/           # IPC 通道注册(scripts / groups / shell / pty / settings / config / updater / app)
│   ├── store/         # 数据层:scripts、settings、persistence、transfer(导入导出)
│   ├── pty/           # 终端:shell 检测、shellResolver、PtyManager(唯一会话表)、runner、title
│   └── updater/       # 更新:version / mac(自研替换) / win-linux(electron-updater)
├── preload/       # contextBridge 暴露 window.api(附 index.d.ts 类型声明)
├── renderer/      # React + antd
│   └── src/
│       ├── App.tsx            # 顶栏(版本 + 主题三态 + 设置入口)与工作区
│       ├── components/        # Sidebar / ScriptFormModal / GroupFormModal / SettingsModal
│       │                      # TerminalDock / TerminalView / ScriptEditor / UpdatePanel
│       ├── store/            # zustand:useAppStore(脚本/分组/表单) useTerminalStore(终端会话)
│       ├── settings/         # shellOverride:shell 下拉选项与失效值判定(纯函数)
│       ├── editor/           # shellKeywords:命令补全词表
│       ├── theme/            # 主题三态与 CSS 变量注入
│       └── utils/            # toUserMessage:剥掉 Electron 给 IPC 错误加的前缀
└── shared/        # 三进程共享的类型与校验(types.ts)
```

几个关键约定：

- **主进程保持 CJS 输出**（`electron-store@8` 是 CJS，不能升到纯 ESM 的 11.x）。
- **校验双侧做**：名称长度等约束在主进程（权威），渲染层做即时反馈。
- **脚本投喂用「写临时文件后执行」**：把脚本内容写入系统临时目录的 `easyops-<runId>.sh`，再让交互式 shell `source` 它，而不是逐行写进 shell。
- **终端只保留「关闭」一个概念**：`\x03` + `pty.kill()`；中断脚本请用 `Ctrl+C`。
- **IPC 错误文案**：`ipcMain.handle` 抛出的错误会被 Electron 包成 `Error invoking remote method 'x': <原文>`，渲染层展示前必须过 `toUserMessage()` 剥前缀，否则中文错误契约失效。

### 测试

vitest，共 **220** 个用例，分两套环境：

```bash
npm test                        # 全部
npx vitest run tests/main       # 主进程:node 环境
npx vitest run tests/renderer   # 渲染层:jsdom 环境
```

- **纯函数 / 数据层**：store、shell 检测与解析、导入导出迁移、更新事件判定等都有单测。
- **IPC 层**：用 `vi.mock('electron')` 把 `ipcMain.handle` 注册的处理函数收进一个 Map 再直接调用（见 `tests/main/updater-ipc.test.ts`、`tests/main/scripts-ipc.test.ts`）。
- **组件测试**：`tests/renderer/**` 走 jsdom，`tests/renderer/jsdomShims.ts` 补齐了 jsdom 缺的 `matchMedia` 与带伪元素的 `getComputedStyle`（antd 会用到）。

### 实机验证（可选）

GUI 行为建议在真实应用里验证。带远程调试端口启动，然后用 CDP 驱动：

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm run dev -- --noSandbox --remoteDebuggingPort=9333
```

要点：

- 用浏览器级 WebSocket（`ws://127.0.0.1:9333/devtools/browser/<id>`）→ `Target.getTargets` → `Target.attachToTarget` → `Runtime.evaluate`。
- 渲染层终端用的是 xterm 的 **DOM renderer**，`.xterm-rows > div` 能读到终端文本（**只有视口，没有 scrollback**）；要拿完整输出更适合直接订阅 `window.api.pty.onData()`。
- **直接调 `window.api.pty.start()` 起的会话不会出现在终端面板里**（面板由渲染层 store 添加），所以「验证脚本真的执行了」应让脚本自己写一个副作用文件，或走 UI 点击。
- ⚠️ **遗留的 Electron 进程会让新实例启动即退出**（拿不到 `app.requestSingleInstanceLock()` 就 `app.quit()`），日志表现为只打印到 `DevTools listening on ...` 就结束。清理用：
  ```bash
  pgrep -fl "easy-ops/node_modules/electron" | awk '{print $1}' | xargs -r kill
  ```

---

## 构建与发布

### 本地打包

```bash
npm run build:mac    # dmg(Intel + Apple Silicon)
npm run build:win    # nsis
npm run build:linux  # AppImage + deb + rpm
```

打包配置见 `electron-builder.yml`：`appId: com.easyops.app`，产物名 `EasyOps-<version>-<arch>.<ext>`，**已把 `node-pty` 加入 `asarUnpack`**（原生模块必须在 asar 外，且经 `electron-builder install-app-deps` 重建）。

### GitHub Actions

`.github/workflows/release.yml`：三平台矩阵构建，推送 `v*` 标签触发，也支持 `workflow_dispatch` 手动触发。构建完成后上传为 GitHub Release 产物。

> ⚠️ 踩过的坑：electron-builder 默认 `releaseType: draft`。如果 Release 已经存在（例如预建了草稿），必须显式设成 `release`，否则**全部产物会被静默跳过上传，而 CI 仍然全绿**。

### 无签名自动更新的实现

整个链路**不使用任何代码签名证书**：

| 平台 | 方案 |
|------|------|
| Windows / Linux | 直接用 `electron-updater`（读 GitHub Release 的 `latest.yml` / `latest-linux.yml`） |
| macOS | 自研：下载新版本 zip → `ditto -x -k` 解压 → 替换 `.app` → `xattr` 去掉隔离属性 → 重启应用（`src/main/updater/mac.ts`） |

> macOS 不做签名就无法使用 Squirrel.Mac 的标准更新链路，所以这里自己实现替换逻辑。

### 发版前建议

首次跑 CI 建议先用 `workflow_dispatch` 留空版本号试跑（会生成 `0.8.0-rc.<run>` 形式的版本），确认 `verify-release` 通过后再打正式 tag。

---

## 技术栈与版本约束

| 项 | 版本 | 备注 |
|---|---|---|
| Electron | 37.x | 需求指定 |
| electron-vite | 4.0.1 | 内置 Electron 37 构建目标 |
| Vite | 5.4.x | 满足 electron-vite 4 的 `vite ^5` peer |
| React / react-dom | 18.2.x | 需求指定 |
| TypeScript | 5.x | 三进程统一 |
| Ant Design | 5.29.x | 主题切换走 `ConfigProvider`；注意 5.29 起 `Modal` 的 `destroyOnClose` 已废弃，用 `destroyOnHidden` |
| node-pty | 1.1.0 | 原生模块，需 `asarUnpack` + rebuild |
| @xterm/xterm | 5.5.0 | 配 `addon-fit` / `addon-web-links` |
| CodeMirror 6 | 6.x | `@uiw/react-codemirror` + `@codemirror/legacy-modes` 的 shell 模式 |
| electron-store | **8.2.0** | ⚠️ 必须 8.x（CJS）；11.x 是纯 ESM，与主进程 CJS 输出冲突 |
| electron-updater | 6.x | 仅 Windows / Linux |
| zustand | 5.x | 渲染层状态 |

---

## 已知未验证项

以下是代码已完成、但**尚未在真实环境跑通**的部分，发版前需要补：

- macOS 自研替换安装的完整链路（下载 → ditto 解压 → 替换 → xattr → 重启）—— 需等 CI 产出首个 Release 后实测。
- Windows / Linux 的 `electron-updater` 端到端；`latest.yml` / `latest-linux.yml` 的真实产出。
- Windows 下 Git Bash / WSL 的真机行为，以及自定义 shell 带 `args: ['-i']` 在各平台的差异。
- 三平台产物的实际安装体验（macOS 未签名时的 Gatekeeper 提示等）。

---

## 许可证

MIT
