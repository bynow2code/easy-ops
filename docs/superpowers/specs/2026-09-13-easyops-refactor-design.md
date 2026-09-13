# EasyOps 重构设计规格

- 日期:2026-09-13
- 状态:待用户审查
- 仓库:https://github.com/bynow2code/easy-ops
- 目标分支:`feature/new`(master 保留旧版 v0.7.15 作为对照)

## 1. 背景与目标

EasyOps 是一个脚本管理器桌面应用。旧版(v0.7.15,位于 master 分支)采用三段式架构:
`client`(React 19 + Vite 6)+ `electron`(main / preload)+ `server`(Express + SSE,负责脚本存储与执行)。

旧版存在的核心问题:

1. 执行输出区不是真正的终端,只是多个 `<pre>` 面板堆叠,**不支持运行中交互输入**。
2. 脚本执行链路为 `renderer → HTTP → server(fork 子进程) → SSE`,链路长,主进程还需经 `PORT=0` + IPC 回传端口。
3. `server/index.js` 1301 行、`client/src/App.jsx` 2411 行,职责高度集中,难以维护。
4. macOS 只探测 `bash`,不支持 `zsh`(macOS 10.15+ 默认 shell)。
5. 脚本编辑器只有语法高亮,没有关键字候选。
6. Windows 上停止 WSL / Git Bash 子进程依赖 PID 桥接黑科技,健壮性差。

本次重构目标:用 **electron-vite** 重建为三进程标准结构,引入 **node-pty + xterm.js** 提供真正的交互式终端体验,在保持原有功能的前提下显著改善可维护性与跨平台健壮性。

## 2. 技术栈(锁定版本)

| 层 | 选型 | 版本 | 说明 |
|---|---|---|---|
| 壳 | Electron | 37.10.3 | 需求指定 37,取最新补丁 |
| 构建 | electron-vite | 4.0.1 | 内置 Electron 37 构建目标 |
| 构建 | Vite | 5.4.21 | 满足 electron-vite 4 的 `vite ^5` peer |
| 语言 | TypeScript | 5.x | 三进程统一 |
| 前端 | React / react-dom | 18.2.0 | 需求指定(旧版为 19) |
| UI | Ant Design / @ant-design/icons | 5.29.3 / 6.3.4 | `ConfigProvider` 切换主题 |
| 状态 | zustand | 5.x | 轻量替代 2411 行单文件 |
| 终端 | node-pty | 1.1.0 | 主进程 spawn,支持交互 |
| 终端 UI | @xterm/xterm + addon-fit + addon-web-links | 5.5.0 / 0.10.0 | 选 5.x 而非 6.0,生态更稳 |
| 编辑器 | CodeMirror 6(`@uiw/react-codemirror`、`@codemirror/legacy-modes`、`@codemirror/autocomplete`) | 6.x | shell 高亮 + 关键字候选 |
| 存储 | electron-store | **8.2.0** | 8.x 为 CJS;11.x 为纯 ESM,与主进程 CJS 冲突 |
| 更新 | electron-updater | 6.x | Windows / Linux |
| 打包 | electron-builder | 26.x | 三平台产物 |

> 版本决策依据:`electron-vite@4.0.1` 的 `peerDependencies.vite` 为 `^5 || ^6 || ^7`,Node 要求 `^20.19.0 || >=22.12.0`。当前 Node 22.22.2 满足。

## 3. 目标与非目标

**目标**:实现需求列出的 8 项功能(脚本管理、分组管理、交互式终端、主题、设置面板、导入导出、无签名更新、CI 打包)。

**非目标(明确排除)**:

- 不再保留独立 HTTP server 进程;所有能力经 IPC 直连。
- 不做云端同步 / 多设备。
- 不改变现有 Release 仓库与 tag 命名(`v*`)。
- 不引入 `tree-kill` 等额外杀进程包(理由见 §8.3)。

## 4. 目录结构

```
easy-ops/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
├─ build/                        # 图标、entitlements
├─ .github/workflows/release.yml
└─ src/
   ├─ main/
   │  ├─ index.ts                # app 生命周期、单实例锁
   │  ├─ window.ts               # 窗口创建、最大化
   │  ├─ ipc/index.ts            # IPC 注册中心(按域拆分)
   │  ├─ store/scripts.ts        # 脚本 + 分组持久化
   │  ├─ store/settings.ts       # 设置持久化
   │  ├─ pty/manager.ts          # PTY 会话管理与编排
   │  ├─ pty/runner.ts           # 脚本投喂(方案 B)
   │  ├─ pty/shell.ts            # shell 自动检测 / 自定义校验
   │  ├─ pty/stop.ts             # 三层停止策略
   │  ├─ updater/index.ts        # 更新入口(平台分流)
   │  ├─ updater/win-linux.ts    # electron-updater
   │  ├─ updater/mac.ts          # 无签名自研更新
   │  └─ migration.ts            # 旧版数据导入
   ├─ preload/
   │  ├─ index.ts
   │  └─ index.d.ts              # window.api 类型声明
   └─ renderer/
      ├─ index.html
      └─ src/
         ├─ main.tsx
         ├─ App.tsx
         ├─ theme/provider.tsx
         ├─ store/{scripts,terminal,settings}.ts
         ├─ hooks/useTerminal.ts
         └─ components/
            ├─ Sidebar.tsx
            ├─ ScriptEditor.tsx
            ├─ ScriptFormModal.tsx
            ├─ GroupFormModal.tsx
            ├─ TerminalView.tsx
            ├─ TerminalDock.tsx
            └─ SettingsModal.tsx
```

## 5. 数据模型

```ts
interface Script {
  id: string
  name: string          // 必填,1–30 字符
  content: string       // 必填
  groupId: string | null // 可空 —— 对应「分组不必选」
  shellId: string | null // 可空 —— 空则跟随全局设置
  order: number
  createdAt: string
  updatedAt: string
}

interface Group {
  id: string
  name: string          // 必填,1–15 字符
  order: number
  createdAt: string
}

interface Settings {
  theme: 'light' | 'dark' | 'system'
  shellId: string | null          // 全局默认 shell
  customShells: CustomShell[]     // 自定义 shell 路径
  checkUpdateOnLaunch: boolean
  migrated: boolean               // 是否已完成旧数据迁移
}

interface CustomShell {
  id: string            // 'custom:<path>'
  name: string          // 展示名
  path: string
}

interface ShellInfo {
  id: string            // 'zsh' | 'bash' | 'gitbash:<path>' | 'wsl:<distro>' | 'custom:<path>'
  name: string
  path: string
  args: string[]        // 启动参数,如 ['-i']
  version?: string
  source: 'detected' | 'custom'
}
```

**关于「分组不必选」**:新建脚本时分组的默认值为「未分组」(`groupId = null`),即分组是可选概念,但未分组不等于校验失败。

**约束**:`name`/`group.name` 的长度限制在 **主进程与渲染进程双侧校验**(主进程为权威,渲染层做即时反馈),避免绕过 UI 写入超长值。

## 6. 数据迁移(旧版兼容)

**触发方式**:设置面板提供「导入旧版配置」按钮;首次启动若在 `userData` 下检测到旧 `scripts.json` 且 `settings.migrated === false`,弹出一次性提示(不自动覆盖)。

**前置条件(重要)**:新版 `appId` 必须保持为 **`com.easyops.app`**、`productName` 保持 **`EasyOps`**,以复用与旧版相同的 `userData` 目录,从而自动定位旧 `scripts.json`。若将来变更 appId,迁移流程必须改为由用户手动选择旧 `scripts.json` 文件路径。此外,若旧版仍安装在机器上,需提示用户先退出旧版再导入,避免两边同时写同一份数据。

**识别逻辑**:兼容两种旧格式:

- 裸数组 `Script[]`(旧 `userData/scripts.json`)
- 旧导出格式 `{ type: "easyops-scripts-config", version: 1, exportedAt, scripts }`

**转换规则**:

1. 旧 `script.group`(`'backend' | 'frontend'` 字符串)→ 去重生成 `Group` 实体,回填 `groupId`。
2. 旧 `script.orderNum` → `order`。
3. 旧 `script.shellId` 保留(校验目标 shell 是否仍存在,不存在则置 `null`)。
4. 丢弃无法识别的字段,不阻断导入;返回 `{ imported, skipped, warnings }`。

**新版导出格式**(v2):

```json
{
  "type": "easyops-config",
  "version": 2,
  "exportedAt": "2026-09-13T00:00:00.000Z",
  "scripts": [],
  "groups": [],
  "settings": {}
}
```

导入 v2 时**全量覆盖**前须二次确认;导入 v1 / 裸数组走迁移路径。

## 7. IPC 契约

所有通道经 `contextBridge` 以 `window.api` 暴露,preload 中 `contextIsolation: true`、`nodeIntegration: false`。

**脚本**

| 通道 | 入参 | 返回 |
|---|---|---|
| `script:list` | — | `Script[]` |
| `script:create` | `{ name, content, groupId }` | `Script` |
| `script:update` | `{ id, patch }` | `Script` |
| `script:delete` | `{ id }` | `void` |
| `script:reorder` | `{ ids: string[] }` | `void` |

**分组**

| 通道 | 入参 | 返回 |
|---|---|---|
| `group:list` | — | `Group[]` |
| `group:create` | `{ name }` | `Group` |
| `group:update` | `{ id, name }` | `Group` |
| `group:delete` | `{ id }` | `void`(其下脚本 `groupId` 置 `null`) |

**终端**

| 通道 | 入参 | 返回 |
|---|---|---|
| `pty:start` | `{ scriptId }` | `{ runId, title }` |
| `pty:write` | `{ runId, data }` | `void` |
| `pty:resize` | `{ runId, cols, rows }` | `void` |
| `pty:stop` | `{ runId }` | `void` |
| `pty:stopAll` | — | `void` |
| `pty:close` | `{ runId }` | `void`(停止并移除终端视图) |

**主 → 渲染事件**:`pty:data` `{ runId, chunk }`、`pty:exit` `{ runId, exitCode, signal }`

**设置 / Shell / 配置**

| 通道 | 入参 | 返回 |
|---|---|---|
| `settings:get` | — | `Settings` |
| `settings:update` | `{ patch }` | `Settings` |
| `shell:detect` | — | `ShellInfo[]` |
| `shell:validate` | `{ path }` | `{ valid, version?, reason? }` |
| `shell:browse` | — | `string \| null`(原生文件对话框) |
| `config:export` | — | `{ canceled, path? }` |
| `config:import` | `{ mode: 'v2' \| 'legacy' }` | `{ canceled, stats? }` |
| `migration:scan` | — | `{ found, path?, count }` |
| `migration:apply` | — | `{ imported, skipped, warnings }` |

**应用 / 更新**

| 通道 | 入参 | 返回 |
|---|---|---|
| `app:info` | — | `{ version, repo, platform }` |
| `app:openExternal` | `{ url }` | `void` |
| `update:check` / `update:download` / `update:install` | — | `void` |

**主 → 渲染事件**:`update:event` `{ status, version?, percent?, message? }`

## 8. 终端设计(核心)

### 8.1 启动与脚本投喂(方案 B)

1. `pty:start` 时,主进程把脚本内容写入 `app.getPath('temp')` 下的唯一临时文件 `easyops-<runId>.sh`。
2. PTY 以**交互模式**启动用户选定 shell(或全局默认),即 `<shellPath> -i`,cwd 取用户主目录。
3. shell 就绪后,主进程向 PTY 写入一行 `source '<临时文件绝对路径>'\n`(路径加单引号包裹以容忍空格)。脚本由此在**当前 shell 上下文**中执行,环境变量、别名、PATH 与用户自己的终端完全一致。
4. 脚本执行完毕后 shell 停在提示符,用户可继续交互(满足「终端支持交互输入」)。
5. `runId` 结束时删除临时文件;进程异常退出时,在 app 退出钩子中清理 `easyops-*.sh` 残留。

**选择方案 B 的理由**:多行结构化脚本(`if/fi`、heredoc、函数定义)若逐行写入交互 shell 会被提前解析;落文件执行可保证语义 100% 正确,同时不牺牲交互能力。

### 8.2 数据流

```
pty.onData → webContents.send('pty:data') → xterm.write()
xterm.onData(键盘)   → invoke('pty:write')  → pty.write()
ResizeObserver → invoke('pty:resize')  → pty.resize(cols, rows)
pty.onExit → send('pty:exit') → 终端标记退出码
```

每个运行实例对应一个 PTY 会话与一个 xterm 实例,终端标题 = 脚本名称。

### 8.3 停止策略(三层降级)

| 层级 | 动作 | 超时 |
|---|---|---|
| 1 · 终端语义软停止 | 写入 `\x03`(Ctrl+C)中断当前前台命令;延迟 200ms 后写入 `exit\n` 让 shell 自行退出 | 等待 800ms 收 `onExit` |
| 2 · SIGTERM 兜底 | `ptyProcess.kill('SIGTERM')`;Unix 作用于进程组,Windows 由 node-pty 遍历进程树 | 等待 500ms |
| 3 · SIGKILL 强杀 | `ptyProcess.kill('SIGKILL')`;Windows 可回落 `taskkill /PID <pid> /T /F` | — |

**为什么不再需要 WSL PID 桥接**:第 1 层的 `exit` 由 WSL / Git Bash **内部**的 bash 执行,bash 退出时会向自身前台进程组发送 `SIGHUP`,其子进程自然被回收。旧版的 PID 桥接本质上是在手工模拟这一机制。

**为什么写 `\x03` 而不是 `kill('SIGINT')`**:写 Ctrl+C 字节等价于真实按键,可移植到所有 shell;而 node-pty 在 Windows 上不支持 `SIGINT` / `SIGHUP` 信号名,仅支持 `SIGTERM` / `SIGKILL`。

**不引入额外杀进程包的理由**:node-pty 的 `kill()` 已覆盖 Windows 进程树遍历与 Unix 进程组传播;`tree-kill` 对 WSL 内部进程无效,边际价值低。仅当联调发现某 shell 不响应 SIGHUP 时,再将其接入第 3 层。

### 8.4 终端 UI 能力

- 交互输入(经 xterm `onData`)
- 单个最大化(大窗 / 全屏)、还原
- 单个关闭
- 批量关闭(全部关闭)
- 标题显示脚本名称 + 运行状态(运行中 / 已退出 码)
- 自动 `fit`(addon-fit)+ 链接可点击(addon-web-links)

## 9. Shell 检测与切换

**自动检测**:

| 平台 | 探测目标 | 方式 |
|---|---|---|
| macOS | `zsh`、`bash` | 解析 `/etc/shells` + `which`;默认偏好 `zsh` |
| Linux | `bash`(及 `/etc/shells` 中的其它) | 解析 `/etc/shells` + `which` |
| Windows | Git Bash、WSL | Git Bash 走常见安装路径候选 + `where`;WSL 走 `wsl.exe -l -q` |

**自定义路径**:经原生文件对话框选择,主进程校验「文件可执行」且能返回版本号(执行 `--version` 探测);Windows 上拒绝 GUI 程序(解析 PE Subsystem,避免误选)。

**切换**:设置面板选择全局默认 shell(`settings.shellId`);单个脚本可覆盖(`script.shellId`),未覆盖时跟随全局。

## 10. 脚本编辑器

- CodeMirror 6 + `@codemirror/legacy-modes/mode/shell` 提供 shell 语法高亮。
- `@codemirror/autocomplete` 提供关键字候选:内置 shell 内建命令、常用命令及常用参数的关键字表。
- 行号、代码折叠、括号匹配与自动闭合。
- 名称输入框:实时校验 1–30 字符并提示剩余长度。

## 11. 主题

- 三态:`light` / `dark` / `system`,持久化于 `settings.theme`。
- 实现:Ant Design `ConfigProvider` 按态切换 `defaultAlgorithm` / `darkAlgorithm`;`system` 态通过 `matchMedia('(prefers-color-scheme: dark)')` 监听并同步,系统切换时实时生效。
- 自研样式统一走 CSS 变量,与 AntD token 对齐,避免旧版 `data-theme` 与媒体查询两套机制并存的问题。

## 12. 导入导出

- **导出**:脚本 + 分组 + 设置,写为 v2 格式 JSON,经原生保存对话框落盘。
- **导入 v2**:校验结构与 `name` / 长度约束后全量覆盖(二次确认)。
- **导入旧版**:走 §6 迁移路径。
- 主进程为唯一写入方,导入失败时保持原有数据不变(先解析校验、后原子替换)。

## 13. 自动更新(无签名)

| 平台 | 方案 |
|---|---|
| Windows / Linux | `electron-updater`,`autoDownload: false`,`provider: github`(`bynow2code/easy-ops`) |
| macOS | 无签名无法使用 Squirrel.Mac,**自研**:GitHub API 取 `releases/latest` → 比对版本 → 下载对应 arch 的 `zip` → `ditto -x -k` 解压 → 写后台脚本,待主进程退出后替换 `/Applications` 中的应用 → `xattr -dr com.apple.quarantine` 去隔离 → 重新 `open` |

- 开发模式(`is.dev`)下点击检查更新直接提示「开发模式不支持」。
- 支持手动检查;`checkUpdateOnLaunch` 控制启动时是否静默检查。

## 14. CI(自动打包)

`.github/workflows/release.yml`:

- **触发**:`workflow_dispatch` + push tag `v*`。
- **环境**:Node 22;以 tag 同步 `package.json` 版本号。
- **矩阵**:
  - `windows-latest` → `nsis` + `zip`
  - `macos-latest` → `dmg` + `zip`,设 `CSC_IDENTITY_AUTO_DISCOVERY: false`(不签名)
  - `ubuntu-latest` → `AppImage` + `deb` + `rpm`(需 `apt install rpm`)
- **发布**:`softprops/action-gh-release` 统一上传安装包与 `latest.yml` / `latest-mac.yml` / `latest-linux.yml`(供更新器读取)。

## 15. 构建与原生模块要点

- `node-pty` 为原生模块:主进程构建时 external(`electron-vite` 的 `externalizeDepsPlugin` / `build.rollupOptions.external`),不被打包进 bundle。
- `electron-builder` 配置 `asarUnpack: ['**/node_modules/node-pty/**']`,并把 `node-pty` 列入 `dependencies`(非 devDependencies)。
- 安装后执行 `electron-builder install-app-deps` 针对 Electron 37 ABI 重建原生模块。
- 主进程保持 CJS 输出(避免与 `electron-store@8` 的 CJS 形态冲突)。
- `appId` 固定 `com.easyops.app`、`productName` 固定 `EasyOps`(理由见 §6);产物命名保持 `EasyOps-<version>-<arch>.<ext>` / `EasyOps-Setup-<version>.<ext>`。
- 需新增 `.gitignore`(当前分支缺失),至少忽略 `node_modules/`、`out/`、`dist/`、`release/`、`.idea/`。

## 16. 验收标准

1. `npm run dev` 可启动应用,三进程正常;`npm run build` 产出无错误。
2. 脚本可新增(名称超 30 字被拒)、编辑、删除、执行;分组可增删改(名称超 15 字被拒),脚本可跨组移动。
3. 执行脚本后出现交互式终端,标题为脚本名;可在其中键入选中的命令并看到交互反馈(`sudo` / `read` 等提示可响应)。
4. 点击停止可终止脚本;WSL 与 Git Bash 环境下确认子进程被回收(无残留)。
5. 终端可单个最大化、单个关闭、批量关闭,且关闭后 PTY 会话被销毁(无泄漏)。
6. 主题三态切换即时生效,`system` 态随系统变化。
7. 设置面板正确显示版本号、仓库地址;shell 自动检测结果正确;可添加自定义 shell 路径并切换。
8. 导出配置再导入可完整还原;可成功导入旧版 `scripts.json` 并生成分组。
9. 打包产物在 macOS(无签名)上可完成自更新流程;Windows / Linux 可完成 `electron-updater` 流程。
10. 推送 tag 后 CI 三平台均产出预期产物并发布 Release。
