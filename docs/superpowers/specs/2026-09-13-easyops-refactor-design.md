# EasyOps 重构设计规格

- 日期:2026-09-13
- 状态:已按用户评审意见修订(待最终确认)
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
| UI | Ant Design / @ant-design/icons | 5.29.3 / 5.6.1 | `ConfigProvider` 切换主题;图标版本与 antd 5 的内部依赖(`^5.6.1`)对齐,避免双份安装 |
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
- **不做多选批量执行**:仅支持单个脚本执行(需求原文为「单个脚本执行」;旧版的多选 Execute Selected 不迁移)。
- 不做云端同步 / 多设备。
- 不改变现有 Release 仓库与 tag 命名(`v*`)。
- 不引入 `tree-kill` 等额外杀进程包(见 §8.5 取舍说明)。

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

**触发方式**:**仅**在设置面板提供「导入旧版配置」按钮,由用户按需手动触发。**不做启动时自动扫描与弹窗** —— 那会引入额外的启动检测逻辑,且旧版仍在使用时容易误判。

**前置条件(重要)**:新版 `appId` 必须保持为 **`com.easyops.app`**、`productName` 保持 **`EasyOps`**,以复用与旧版相同的 `userData` 目录,把旧 `scripts.json` 作为「导入旧版配置」的默认文件位置。若将来变更 appId,则该按钮改为让用户手动选择旧 `scripts.json` 的路径。导入前需提示用户先退出旧版(若仍在使用),避免两边同时写同一份数据。

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
| `group:reorder` | `{ ids: string[] }` | `void`(与 `Group.order` 字段对应) |

**终端**

| 通道 | 入参 | 返回 |
|---|---|---|
| `pty:start` | `{ scriptId }` | `{ runId, title }` |
| `pty:write` | `{ runId, data }` | `void` |
| `pty:resize` | `{ runId, cols, rows }` | `void` |
| `pty:close` | `{ runId }` | `void`(结束会话并移除面板) |
| `pty:closeAll` | — | `void`(批量关闭全部终端) |

**主 → 渲染事件**:`pty:data` `{ runId, chunk }`、`pty:exit` `{ runId, exitCode, signal }`(会话结束)

**设置 / Shell / 配置**

| 通道 | 入参 | 返回 |
|---|---|---|
| `settings:get` | — | `Settings` |
| `settings:update` | `{ patch }` | `Settings` |
| `shell:detect` | — | `ShellInfo[]` |
| `shell:validate` | `{ path }` | `{ valid, version?, reason? }` |
| `shell:browse` | — | `string \| null`(原生文件对话框) |
| `config:export` | — | `{ canceled, path? }` |
| `config:import` | `{ mode: 'v2' \| 'legacy' }` | `{ canceled, stats? }`(`legacy` 走 §6 迁移路径) |

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
3. shell 就绪后,向 PTY 写入一行 `source '<临时文件绝对路径>'`(路径用单引号包裹以容忍空格)。脚本由此在**当前 shell 上下文**中执行,环境变量、别名、PATH 与用户自己的终端完全一致。
4. 脚本执行完毕后 shell 停在提示符,用户可继续交互(满足「终端支持交互输入」)。
5. `runId` 结束时删除临时文件;进程异常退出时,在 app 退出钩子中清理 `easyops-*.sh` 残留。

**选择方案 B 的理由**:多行结构化脚本(`if/fi`、heredoc、函数定义)若逐行写入交互 shell 会被提前解析;落文件执行可保证语义 100% 正确,同时不牺牲交互能力。

### 8.2 数据流

```
pty.onData → webContents.send('pty:data') → xterm.write()
xterm.onData(键盘)   → invoke('pty:write')  → pty.write()
ResizeObserver → invoke('pty:resize')  → pty.resize(cols, rows)
pty.onExit        → send('pty:exit')      → 终端显示「会话已结束」并禁用输入
```

每个运行实例对应一个 PTY 会话与一个 xterm 实例,终端标题 = 脚本名称。

### 8.3 关闭与清理

**只有一个用户概念:关闭。** 关闭一个终端 = 结束它的 PTY 会话并移除面板。

| 场景 | 行为 |
|---|---|
| 关闭单个终端 | 写入 `\x03`(Ctrl+C)→ `pty.kill()` → 从会话表移除 → 移除面板 |
| 批量关闭 | 对全部活动会话执行上述流程 |
| 脚本执行中想中断 | **用户直接按 Ctrl+C**(终端原生能力,不另设按钮) |
| 窗口关闭 / 应用退出 | `ptyManager.disposeAll()` 终止全部会话,并清理临时脚本文件 |
| 渲染进程重载(dev HMR) | 主进程检测到重载即 `disposeAll()` —— **只清理,不恢复** |

**关于「渲染重载」的取舍**:不做会话快照与输出回放(那需要为每个会话维护输出缓冲、新增 `pty:list` 通道与重放逻辑)。生产环境下不存在用户刷新页面的路径;dev 模式重载即清空重来。用最简的「重载即清理」避免幽灵进程,而不是引入一套恢复机制。

**关于「终止是否够干净」**:`pty.kill()` 已由 node-pty 处理平台差异(Unix 作用于会话/进程组;Windows 遍历进程树),前置的 `\x03` 让前台命令有机会优雅退出。**先按最简实现;若实测发现 WSL 场景有残留,再补一条写入 `exit\n`** —— 不预先构建用不上的降级链。

### 8.4 终端 UI 能力

- 交互输入(经 xterm `onData`)
- 单个最大化(大窗 / 全屏)、还原
- 单个关闭
- 批量关闭
- 标题显示脚本名称;同一脚本多次执行时追加序号 `(2)`、`(3)` 以区分
- 自动 `fit`(addon-fit)+ 链接可点击(addon-web-links)

### 8.5 刻意不做的设计(明确取舍)

以下能力经讨论后**主动移除**:终端本身已经承担了这些表达,额外机制只增加复杂度而不增加信息。

| 移除项 | 原因 |
|---|---|
| 会话状态机(`SessionStatus` 五态) | 终端面板「在」或「不在」即全部信息 |
| 脚本执行状态机(`RunStatus` 六态) | 脚本是否跑完,看一眼提示符是否回来就知道 |
| 结束哨兵(OSC 1338 序列) | 它只是为驱动上面那个状态机而存在 |
| `pty:runStatus` 事件 | 同上 |
| `pty:list` 快照通道 + 输出回滚缓冲 | 重载改为「清理」而非「恢复」,不再需要 |
| 独立的「停止」按钮 | 交互式终端里 Ctrl+C 就是停止 |
| 三层降级终止链 | 简化为 `\x03` + `pty.kill()`;实测有残留再补 |

**保留的底线**(这些不是「复杂性」,而是正确性,缺一不可):

1. 主进程持有唯一的会话表 `Map<runId, PtySession>` —— 关闭时才找得到进程去杀。
2. 窗口关闭 / 应用退出时必须 `disposeAll()` —— 否则留下孤儿进程。
3. 临时脚本文件必须清理 —— 否则临时目录堆积垃圾。

## 9. Shell 检测与切换

**自动检测**:

| 平台 | 探测目标 | 方式 |
|---|---|---|
| macOS | `zsh`、`bash` | 解析 `/etc/shells` + `which`;默认偏好 `zsh` |
| Linux | `bash`(及 `/etc/shells` 中的其它) | 解析 `/etc/shells` + `which` |
| Windows | Git Bash、WSL | Git Bash 走常见安装路径候选 + `where`;WSL 走 `wsl.exe -l -q` |

**自定义路径**:经原生文件对话框选择,主进程校验「文件存在且可执行」,并执行 `--version` 探测能否正常启动。**不做** PE Subsystem 之类的二进制格式解析(旧版有此逻辑)—— 若误选了 GUI 程序,`--version` 探测会自然失败并被拒。

**切换**:设置面板选择全局默认 shell(`settings.shellId`);单个脚本可覆盖(`script.shellId`),未覆盖时跟随全局。

## 10. 脚本编辑器

- CodeMirror 6 + `@codemirror/legacy-modes/mode/shell` 提供 shell 语法高亮。
- `@codemirror/autocomplete` 提供关键字候选,**范围限定**为:shell 内建命令(`cd` / `echo` / `export` / `set` / `source` / `alias` …)+ 少量常用命令(`ls` / `grep` / `awk` / `git` / `npm` …),以一份精简内置词表实现。**不读取**用户别名或命令历史。
- 行号、代码折叠、括号匹配与自动闭合。
- 名称输入框:实时校验 1–30 字符并提示剩余长度。

## 11. 主题

- 三态:`light` / `dark` / `system`,持久化于 `settings.theme`。
- 实现:Ant Design `ConfigProvider` 按态切换 `defaultAlgorithm` / `darkAlgorithm`;`system` 态通过 `matchMedia('(prefers-color-scheme: dark)')` 监听并同步,系统切换时实时生效。
- 自研样式统一走 CSS 变量,与 AntD token 对齐,避免旧版 `data-theme` 与媒体查询两套机制并存的问题。

## 12. 导入导出

- **导出**:脚本 + 分组 + 设置,写为 v2 格式 JSON,经原生保存对话框落盘。
- **导入 v2**:校验结构与 `name` / 长度约束后全量覆盖(二次确认)。
- **机器相关设置的处理**:`settings.customShells`(含绝对路径)与 `shellId` 在导入时逐项校验,目标在本机不存在则丢弃该项并计入 `warnings`,不阻断导入 —— 避免换机器后选中无效 shell。
- **导入旧版**:设置面板「导入旧版配置」按钮触发,走 §6 迁移路径。
- 主进程为唯一写入方,导入失败时保持原有数据不变(先解析校验、后原子替换)。

## 13. 自动更新(无签名)

| 平台 | 方案 |
|---|---|
| Windows / Linux | `electron-updater`,`autoDownload: false`,`provider: github`(`bynow2code/easy-ops`) |
| macOS | 无签名无法使用 Squirrel.Mac,**自研**:GitHub API 取 `releases/latest` → 比对版本 → 下载对应 arch 的 `zip` → `ditto -x -k` 解压 → 写后台脚本,待主进程退出后替换 `/Applications` 中的应用 → `xattr -dr com.apple.quarantine` 去隔离 → 重新 `open` |

- **macOS 自研更新的前提与回退**(必须一并实现,否则会卡住用户):
  - 假设应用位于 `/Applications`;若实际运行路径不在此目录,回退为「打开 Release 页面引导手动下载」,不做替换。
  - 替换需要目标目录写权限。若写入失败(权限不足 / 非管理员 / 系统拦截),回退为引导手动下载并给出明确提示,**不得静默失败**。
  - 依赖 CI 同时产出 macOS `.zip` 产物(见 §14)。
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
- 图标沿用旧版 `master` 分支 `client/public/` 下的 `logo*.png` / `logo.ico`;macOS 打包所需的 `.icns` 由 `iconutil` 从 1024px PNG 生成。

## 16. 验收标准

1. `npm run dev` 可启动应用,三进程正常;`npm run build` 产出无错误。
2. 脚本可新增(名称超 30 字被拒)、编辑、删除、执行;分组可增删改(名称超 15 字被拒),脚本可跨组移动。
3. 执行脚本后出现交互式终端,标题为脚本名;可在其中键入命令并看到交互反馈(`sudo` / `read` 等提示可响应);脚本跑完后提示符正常返回,可继续输入。
4. 脚本执行中按 Ctrl+C 可中断当前命令,终端保持可用。
5. 终端可单个最大化、单个关闭、批量关闭,且关闭后 PTY 会话被销毁。
6. 关闭主窗口后所有 PTY 会话被终止:用 `ps` / 任务管理器确认无脚本子进程残留。
7. 主题三态切换即时生效,`system` 态随系统变化。
8. 设置面板正确显示版本号、仓库地址;shell 自动检测结果正确;可添加自定义 shell 路径并切换。
9. 导出配置再导入可完整还原;在设置面板点「导入旧版配置」可成功导入旧版 `scripts.json` 并生成分组。
10. Windows / Linux 可完成 `electron-updater` 更新流程;macOS 在应用位于 `/Applications` 且有写权限时可完成自替换更新,权限不足时**正确回退为引导手动下载**(不静默失败)。
11. 推送 tag 后 CI 三平台均产出预期产物并发布 Release。
