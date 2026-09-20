# 开发文档

> 面向使用者（下载、安装、上手）的内容见 [README](../README.md)。本文只讲开发、测试与发布。

## 环境要求

- Node.js 22+（CI 使用 22）
- npm

## 常用命令

```bash
npm install          # 装依赖（会触发 electron-builder install-app-deps 重建原生模块）
npm run dev          # 开发模式（electron-vite dev）
npm run typecheck    # 三进程类型检查（tsc --noEmit，node + web 两套）
npm test             # 全量单测（vitest run）
npm run build        # typecheck + electron-vite build
npm start            # 预览构建产物
```

> ⚠️ **主进程改动后要确认应用真的重启了**：electron-vite 会重新构建 `out/main`，但实测存在「构建完成、Electron 没重启」的情况（旧进程继续跑旧代码）。看 dev 日志里有没有新的一行 `start electron app...` / `DevTools listening on ...`；没有就手动 `kill` 掉 Electron 进程重启。改渲染层文件触发 HMR 会重置渲染层 store（开着的终端卡片会没掉），主进程侧正常回收。

## 架构

三进程结构，**没有独立 HTTP server**，渲染层的一切能力都经 IPC 取得：

```
src/
├── main/          # 主进程（CJS 输出）
│   ├── index.ts       # 入口：单实例锁、store 装配、IPC 注册、退出时回收终端
│   ├── window.ts      # 窗口创建
│   ├── ipc/           # IPC 通道注册（scripts / groups / shell / pty / settings / config / updater / app）
│   ├── store/         # 数据层：scripts、settings、persistence、transfer（导入导出）
│   ├── pty/           # 终端：shell 检测、shellResolver、PtyManager（唯一会话表）、runner、title、env
│   └── updater/       # 更新：version / mac（自研替换）/ win-linux（electron-updater）
├── preload/       # contextBridge 暴露 window.api（附 index.d.ts 类型声明）
├── renderer/      # React + antd
│   └── src/
│       ├── App.tsx            # 顶栏（版本 + 主题三态 + 设置入口）与工作区
│       ├── components/        # Sidebar / ScriptFormModal / GroupFormModal / SettingsModal
│       │                      # TerminalDock / TerminalView / ScriptEditor / UpdatePanel
│       ├── store/             # zustand：useAppStore（脚本/分组/表单）、useTerminalStore（终端会话）
│       ├── settings/          # shellOverride：shell 下拉选项与失效值判定（纯函数）
│       ├── editor/            # shellKeywords：命令补全词表
│       ├── theme/             # 主题三态与 CSS 变量注入
│       └── utils/             # toUserMessage：剥掉 Electron 给 IPC 错误加的前缀
└── shared/        # 三进程共享的类型与校验（types.ts）
```

### 关键约定

- **主进程保持 CJS 输出**（`electron-store@8` 是 CJS，不能升到纯 ESM 的 11.x）。
- **校验双侧做**：名称长度等约束在主进程（权威），渲染层做即时反馈。
- **脚本投喂用「写临时文件后执行」**：把脚本内容写入系统临时目录的 `easyops-<runId>.sh`，再让交互式 shell `source` 它，而不是逐行写进 shell。
- **终端只保留「关闭」一个概念**：`\x03` + `pty.kill()`；中断脚本请用 `Ctrl+C`。
- **IPC 错误文案**：`ipcMain.handle` 抛出的错误会被 Electron 包成 `Error invoking remote method 'x': <原文>`，渲染层展示前必须过 `toUserMessage()` 剥前缀，否则中文错误契约失效。

## 测试

vitest，共 **269** 个用例，分两套环境：

```bash
npm test                        # 全部
npx vitest run tests/main       # 主进程：node 环境
npx vitest run tests/renderer   # 渲染层：jsdom 环境
```

- **纯函数 / 数据层**：store、shell 检测与解析、导入导出迁移、更新事件判定等都有单测。
- **IPC 层**：用 `vi.mock('electron')` 把 `ipcMain.handle` 注册的处理函数收进一个 Map 再直接调用（见 `tests/main/updater-ipc.test.ts`、`tests/main/scripts-ipc.test.ts`）。
- **组件测试**：`tests/renderer/**` 走 jsdom，`tests/renderer/jsdomShims.ts` 补齐了 jsdom 缺的 `matchMedia` 与带伪元素的 `getComputedStyle`（antd 会用到）。

## 实机验证（可选）

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

## 构建与发布

### 应用图标

几何的单一来源是 `scripts/gen-app-icon.mjs`，三平台产物用 `node scripts/build-icons.mjs` 一次生成：

```bash
node scripts/build-icons.mjs
```

- `build/icon.png`（1024，Linux）、`build/icon.icns`（macOS，iconset 各档原生渲染）、`build/icon.ico`（Windows，16–256 共 7 档，用 electron-builder 自带的转换器生成）
- 主体按 **Apple 生产模板网格**留白：1024 画布里主体 824×824、四周各 100px、圆角约为主体宽的 22.5%。留白数字出自 Apple Design Resources 的 macOS App Icon 模板（HIG 正文只写 1024×1024，并让人去用那份模板）。**没有这圈留白，图标在 Dock / Finder / 启动台里会比系统应用大一圈** —— 系统按画布对齐所有图标，主体占比越高看起来越大
- 未走 App Store 的分层 `.icon`（Icon Composer）流程，macOS 不会替我们施加圆角遮罩，所以圆角和留白都得自己烤进 `.icns`
- dev 下由主进程 `applyAppIcon` 补设（macOS 走 `app.dock.setIcon`，其余 `BrowserWindow.setIcon`）；打包后不需要，各平台用自己那份资源

### 本地打包

```bash
npm run build:mac    # dmg（Intel + Apple Silicon）
npm run build:win    # nsis
npm run build:linux  # AppImage + deb + rpm
```

打包配置见 `electron-builder.yml`：`appId: com.easyops.app`，产物名 `EasyOps-<version>-<arch>.<ext>`，**已把 `node-pty` 加入 `asarUnpack`**（原生模块必须在 asar 外，且经 `electron-builder install-app-deps` 重建）。

> ⚠️ 在 Intel 机器上跑过 `build:mac` 后，node-pty 会被重建成 arm64（mac target 含双架构，后写者赢），本地 dev 终端会报 `posix_spawnp failed.`。重跑 `npx electron-builder install-app-deps` 即可恢复。

### GitHub Actions

`.github/workflows/release.yml`：三平台矩阵构建，推送 `v*` 标签触发，也支持 `workflow_dispatch` 手动触发（留空版本号会生成 `0.8.0-rc.<run>` 形式的预发布，不污染正式更新通道）。构建完成后上传为 GitHub Release 产物。

发布前有一个独立的 `verify-release` 终检：断言三个平台的更新清单（`latest-mac.yml` / `latest.yml` / `latest-linux.yml`）都已发布，**并逐个核对清单里引用的每个安装包与 blockmap 都真的在 Release 资产中** —— 更新器按清单下载，清单列了文件不代表资产上传成功。

> ⚠️ 踩过的坑：electron-builder 默认 `releaseType: draft`。如果 Release 已经存在（例如预建了草稿），必须显式设成 `release`，否则**全部产物会被静默跳过上传，而 CI 仍然全绿**。重跑超过 2 小时的失败 job 也需 `EP_GH_IGNORE_TIME: 'true'` 忽略发布器的时间窗（workflow 已配置）。

### 无签名自动更新的实现

整个链路**不使用任何代码签名证书**：

| 平台 | 方案 |
|------|------|
| Windows / Linux | 直接用 `electron-updater`（读 GitHub Release 的 `latest.yml` / `latest-linux.yml`，校验其中的 sha512） |
| macOS | 自研：下载新版本 zip → 按 `latest-mac.yml` 里的 sha512 校验完整性 → `ditto -x -k` 解压 → 替换 `.app` → `xattr` 去掉隔离属性 → 重启应用（`src/main/updater/mac.ts`） |

mac 链路的几个要点：

- **完整性校验**：下载器只保证传输不保证内容，所以 zip 落盘后按清单里的 sha512 逐字节核对，不匹配即丢弃并回退手动下载。
- **失败可见**：替换脚本在应用退出后才运行，失败无处上报 —— 它会把原因写进临时目录的固定错误文件，下次启动时读取并在设置面板提示。
- **安装位置判断**：只对「位于 `/Applications` 且当前用户可写」的情况自动替换，其余情况回退打开下载页手动替换。
- **Gatekeeper 与隔离属性**：zip 由 Node 直接写盘、不经 LaunchServices，天然不带 quarantine 属性；`xattr` 只是双保险。对已放行过首次启动的无签名应用，自替换不会再次触发 Gatekeeper。

> macOS 不做签名就无法使用 Squirrel.Mac 的标准更新链路，所以这里自己实现替换逻辑。

### 发版前建议

首次跑 CI 建议先用 `workflow_dispatch` 留空版本号试跑（会生成 `0.8.0-rc.<run>` 形式的版本），确认 `verify-release` 通过后再打正式 tag。

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

## 已知未验证项

以下是代码已完成、但**尚未在真实环境跑通**的部分，发版前需要补：

- macOS 自研替换安装的完整链路（下载 → sha512 校验 → ditto 解压 → 替换 → xattr → 重启）—— 需等 CI 产出首个 Release 后实测。
- Windows / Linux 的 `electron-updater` 端到端；`latest.yml` / `latest-linux.yml` 的真实产出。
- Windows 下 Git Bash / WSL 的真机行为，以及自定义 shell 带 `args: ['-i']` 在各平台的差异。
- 三平台产物的实际安装体验（macOS 未签名时的 Gatekeeper 提示等）。
