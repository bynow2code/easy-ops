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
| `pty:stop` | `{ runId }` | `void`(中止脚本执行:写 Ctrl+C,`run → stopped`,**会话保留**) |
| `pty:close` | `{ runId }` | `void`(终止会话并移除终端面板) |
| `pty:closeAll` | — | `void`(批量关闭全部终端) |
| `pty:list` | — | `TerminalSessionSnapshot[]`(渲染重载后恢复会话用,见 §8.5) |

**主 → 渲染事件**:`pty:data` `{ runId, chunk }`、`pty:runStatus` `{ runId, run, exitCode }`(脚本执行状态变更)、`pty:exit` `{ runId, exitCode, signal }`(会话终止)

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
3. shell 就绪后,主进程向 PTY 写入一行:`source '<临时文件绝对路径>'; printf '\033]1338;EasyOps;D;%s;%s\007' "$?" '<nonce>'`(路径加单引号包裹以容忍空格)。脚本由此在**当前 shell 上下文**中执行(环境变量、别名、PATH 与用户自己的终端一致);结尾的 `printf` 是**结束哨兵**,用于判定脚本执行边界与退出码 —— 方案 B 下 shell 不会主动上报「source 结束」,该哨兵是必需的,详见 §8.5。
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

### 8.3 会话终止策略(三层降级)

本节策略服务于「**关闭**」动作(终止整个会话)。若只是想中止当前脚本执行(「停止」),只需其中的 Ctrl+C 一步,会话保留 —— 见 §8.5。

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
- **「停止」**:中止脚本执行,会话保留(仅 `run=executing` 时可用)
- **「关闭」**:终止会话并移除面板(仅 `session=running` 时可用)
- **批量关闭**:一次性关闭全部终端
- 标题显示脚本名称;标题旁徽标显示脚本执行状态(§8.5)
- 自动 `fit`(addon-fit)+ 链接可点击(addon-web-links)

### 8.5 双重状态:会话状态与脚本执行状态

**为什么必须分两层**:方案 B 中 shell 执行完脚本后**仍停留在提示符**(这是「终端支持交互输入」的前提)。因此「shell 进程是否存活」与「脚本是否仍在执行」是两个彼此独立的维度。若只用一层状态,会出现「脚本早已跑完、界面却一直显示运行中」的错误。

```ts
// 会话状态:PTY / shell 进程的生命周期 —— 决定终端是否可输入、关闭语义
type SessionStatus = 'starting' | 'running' | 'stopping' | 'terminated' | 'error'

// 脚本执行状态:单次脚本运行的生命周期 —— 决定标题徽标、停止按钮、退出码展示
type RunStatus = 'pending' | 'executing' | 'succeeded' | 'failed' | 'stopped' | 'unknown'

interface TerminalSessionSnapshot {
  runId: string
  scriptId: string
  title: string
  session: SessionStatus
  run: RunStatus
  exitCode: number | null
  signal: number | null
  buffer: string          // 最近输出,截断至 100 KB
}
```

**会话状态(SessionStatus)**

| 状态 | 进入条件 | 终端面板表现 |
|---|---|---|
| `starting` | `pty.spawn()` 已调用,尚未确认就绪 | 标题显示「启动中」,输入禁用 |
| `running` | spawn 成功 | 终端可输入,「关闭」可用 |
| `stopping` | 会话终止流程中(三层降级) | 标题显示「关闭中」,禁用重复触发 |
| `terminated` | 收到 `onExit` | 标题显示「已结束 (code)」,输入禁用,保留输出 |
| `error` | `spawn` 抛错或 pty 设备异常 | 标题显示「启动失败」+ 原因 |

**脚本执行状态(RunStatus)**

| 状态 | 进入条件 | 标题徽标 |
|---|---|---|
| `pending` | 会话已创建,脚本尚未开始执行 | 「待执行」 |
| `executing` | 已写入脚本,尚未命中结束哨兵 | 「执行中」,「停止」可用 |
| `succeeded` | 哨兵命中且退出码为 0 | 「成功」 |
| `failed` | 哨兵命中且退出码非 0 | 「失败 (code)」 |
| `stopped` | 用户点击「停止」中止执行 | 「已停止」 |
| `unknown` | 会话在哨兵命中前终止,或哨兵失效 | 「结果未知」 |

**两层如何配合(典型时间线)**

1. `pty:start` → `session=starting`,`run=pending`
2. spawn 成功 → `session=running`
3. 写入脚本与哨兵 → `run=executing`
4. **哨兵命中 → `run=succeeded|failed`;此时 `session` 仍为 `running`,用户可继续在终端交互**
5. 用户 `exit` 或点击「关闭」→ `session=stopping` → `terminated`
6. 用户点击「停止」→ `run=stopped`(**会话保留**)

**「停止」与「关闭」是两个不同动作**

- **停止**(`pty:stop`):仅中止脚本执行,向 PTY 写入 `\x03`(Ctrl+C),`run → stopped`,**会话保留**,用户可继续使用终端。
- **关闭**(`pty:close`):终止整个会话,走 §8.3 三层降级,`session → terminated`,并移除终端面板。
- **批量关闭**(`pty:closeAll`):对所有活动会话执行「关闭」。

**脚本执行边界的检测(结束哨兵)**

`source` 执行时 shell 不会主动上报「脚本已结束」,因此需要显式哨兵。写入 PTY 的实际内容为:

```sh
source '<临时文件绝对路径>'; printf '\033]1338;EasyOps;D;%s;%s\007' "$?" '<nonce>'
```

- **主进程**在 pty 输出流中扫描 `OSC 1338;EasyOps;D;<exitCode>;<nonce>` 序列。
- 命中后提取退出码(`0 → succeeded`,非 0 → `failed`),并**从输出流中剥离该序列**,不污染 xterm 显示。
- `<nonce>` 为每次运行生成的随机串,防止用户脚本自身输出被误判。
- 采用 OSC 转义序列而非普通文本标记,避免影响终端渲染。
- 与 VS Code Shell Integration(OSC 633)同源,但更轻量 —— 仅标记单次脚本的结束边界。

**哨兵失效时的兜底**

- 脚本内含 `exit` → shell 直接退出,由 `onExit` 判定,`run` 依退出码归入 `succeeded` / `failed`。
- 会话在哨兵命中前崩溃 → `run=unknown`,界面标记「执行结果未知」。
- 用户主动中止 → `run=stopped`。

**可靠性设计(五条硬性要求)**

1. **单一权威源**:pty 实例仅存在于主进程 `PtyManager`(`Map<runId, PtySession>`)。渲染进程的 xterm 只是视图与输入源,**不持有状态真相**;会话状态与脚本执行状态都只能由主进程依据真实事件推进,故不存在两进程状态分裂的可能。

2. **渲染重载可恢复**(必须实现,否则出现幽灵终端):dev 模式 HMR 或用户刷新会重建 xterm,而 pty 仍在主进程运行。为此主进程须为每个会话保留**输出回滚缓冲**(保留最近 100 KB,超出后截断头部),渲染进程启动时先调 `pty:list` 拉取全部会话快照,逐个重建 xterm 并重放 `buffer`,再挂载增量监听。缺少此机制会导致「界面里终端消失、进程仍在后台运行且无法停止」的幽灵态。

3. **不依赖事件时序**:主进程自 `spawn` 起即把输出写入会话缓冲;渲染进程在调用 `pty:start` **之前**先注册全局 `pty:data` / `pty:runStatus` / `pty:exit` 监听。即使数据早于 `start` 的 Promise 返回,也能由缓冲补全,不丢 chunk。

4. **生命周期清理**:在 `window.on('closed')` 与 `app.on('before-quit')` 中调用 `ptyManager.disposeAll()`,确保窗口关闭或应用退出时所有 PTY 会话被终止(避免子进程变孤儿),同时清理临时脚本文件。

5. **异常隔离**:`pty.spawn()` 与 `onData` 回调以 try/catch 包裹,异常归入会话 `error` 状态并经 `pty:exit` 广播,绝不让异常冒泡导致主进程崩溃。

> 说明:以上机制是「IPC 事件推送」这一朴素实现之外的必需补充。只做事件推送而不做快照恢复与生命周期清理,必然在多平台联调中暴露幽灵终端与进程泄漏问题。

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
3. 执行脚本后出现交互式终端,标题为脚本名;可在其中键入命令并看到交互反馈(`sudo` / `read` 等提示可响应)。**脚本执行结束后状态徽标转为「成功」或「失败(退出码)」,而终端会话保持运行、仍可继续输入**(验证会话状态与执行状态相互独立)。
4. 点击「停止」可中止脚本执行且**会话保留**(终端仍可输入);点击「关闭」可终止会话,并在 WSL 与 Git Bash 环境下确认子进程被回收(无残留)。
5. 终端可单个最大化、单个关闭、批量关闭,且关闭后 PTY 会话被销毁(无泄漏)。
6. 开发模式下刷新渲染进程或触发 HMR 后,运行中的终端能自动恢复(标题、状态、已输出内容一致),不停留在幽灵态。
7. 关闭主窗口后所有 PTY 会话被终止:用 `ps` / 任务管理器确认无脚本子进程残留。
8. 主题三态切换即时生效,`system` 态随系统变化。
9. 设置面板正确显示版本号、仓库地址;shell 自动检测结果正确;可添加自定义 shell 路径并切换。
10. 导出配置再导入可完整还原;可成功导入旧版 `scripts.json` 并生成分组。
11. 打包产物在 macOS(无签名)上可完成自更新流程;Windows / Linux 可完成 `electron-updater` 流程。
12. 推送 tag 后 CI 三平台均产出预期产物并发布 Release。
