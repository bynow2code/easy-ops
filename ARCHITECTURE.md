# EasyOps 架构设计（Shell 脚本管理工具）

> 本期目标：确立基础架构分层 + 交付统一日志模块（shared/logger.js）。
> 后续步骤：脚本列表 UI、PTY 双向流、后端 CRUD API、打包与日志目录注入。

## 1. 产品定位

桌面端 Shell 脚本管理工具，核心能力：

1. **脚本列表 + 新增**：脚本元数据持久化于 `scripts.json`。
2. **可交互式终端执行**：每个脚本在独立的 `node-pty` 会话中运行，渲染层用 `xterm.js` 呈现并支持输入。

## 2. 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│  渲染层 client/ (React + Vite + xterm.js)                      │
│   ├─ ScriptList      脚本列表 / 新增入口                       │
│   └─ TerminalPane    xterm.js 可交互终端                       │
└───────────────────────────┬──────────────────────────────────┘
                            │ IPC（经 preload 安全桥接）
┌───────────────────────────┴──────────────────────────────────┐
│  桥接层 electron/preload.js                                    │
│   contextIsolation=true，仅暴露有限通道                        │
│   listScripts / addScript / openTerminal / write / resize / …  │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────────────┐
│  主进程 electron/main.js (Electron)                            │
│   ├─ Window + App 生命周期                                     │
│   ├─ IPC Router           转发渲染层请求                       │
│   ├─ PTY Host Manager    按脚本创建/销毁 node-pty 会话         │
│   └─ 启动内嵌后端（fork server/index.js），读取 port.txt       │
└──────────┬───────────────────────────────────────┬───────────┘
           │ 派生 shell                              │ fork + HTTP
┌──────────┴──────────────┐              ┌──────────┴──────────────────┐
│  PTY Host               │              │  后端服务 server/index.js    │
│  (node-pty per script)  │              │   ├─ 脚本仓库 CRUD           │
│  双向流：               │              │   │  读写 scripts.json        │
│   输出→IPC→xterm        │              │   ├─ 集中配置 config.js       │
│   输入→IPC→pty          │              │   └─ 日志模块 logger.js       │
└──────────┬──────────────┘              └──────────┬──────────────────┘
           │ shell                                   │ 共享
           ▼                                         ▼
        OS Shell                              shared/logger.js（跨进程统一）
```

### 2.1 渲染层 `client/`

- React + Vite 构建。
- `ScriptList`：展示脚本列表、提供新增脚本入口。
- `TerminalPane`：基于 `xterm.js` 的可交互终端。
- 不直接 `require('electron')`，仅通过 `preload` 暴露的 API 通信。

### 2.2 桥接层 `electron/preload.js`

- 上下文隔离（`contextIsolation: true`），仅暴露有限 IPC 通道：
  `listScripts` / `addScript` / `openTerminal` / `writeToTerminal` / `resizeTerminal` / `onTerminalData`。

### 2.3 主进程 `electron/main.js`

- 窗口生命周期、加载 `preload`。
- `IPC Router`：转发渲染层请求。
- `PTY Host Manager`：维护 `scriptId → pty` 映射，支持创建/销毁/resize/kill。
- 启动内嵌后端服务（fork `server/index.js`），读取 `port.txt` 建立通道。

### 2.4 PTY Host `electron/pty-host.js`

- 使用 `node-pty` 派生 shell 执行脚本命令。
- 双向流：shell 输出经 IPC 推送至 `xterm`；用户输入经 IPC 回写 pty。
- 维护每个脚本独立的会话，支持 resize、kill。

### 2.5 后端服务 `server/index.js`（Express）

- 脚本仓库 CRUD：读取/写入 `scripts.json`。
- 集中配置（`server/config.js`）：脚本文件路径、日志默认目录、端口文件。
- 日志模块（`shared/logger.js`）：主进程与后端共用，统一日志。

### 2.6 共享日志模块 `shared/logger.js`（本期交付）

- 开发模式：终端输出；生产模式：文件输出（目录由后端 `config.dir` 注入）。
- 级别阈值过滤、Error 自动展开、context 上下文记录、进程级兜底 hook。

## 3. 关键数据流

### 3.1 新增脚本

渲染层表单 → `preload.addScript` → 主进程 → HTTP/IPC → 后端写 `scripts.json`。

### 3.2 执行脚本（交互式）

渲染层点击"运行" → `preload.openTerminal(scriptId)` → 主进程 PTY Host 派生 shell 执行脚本命令 → 输出经 IPC 流式推送至 `xterm` → 用户输入回写 pty。

### 3.3 日志

任意进程 `createLogger(config)` → 开发打印终端 / 生产写 `config.dir/<filename>`（JSON Lines）。

## 4. 日志模块设计（本期交付）

| 配置字段        | 含义                             | 默认值/来源                     |
| --------------- | -------------------------------- | ------------------------------- |
| `isDev`         | 运行模式（决定默认传输）         | `NODE_ENV !== 'production'`     |
| `level`         | 全局级别阈值                     | `info`（生产）/ `debug`（开发） |
| `dir`           | 日志目录（**后端可配置**）       | `server/config.js` 注入         |
| `filename`      | 日志文件名                       | `easyops.log`                   |
| `enableConsole` | 是否终端输出（null=跟随 isDev）  | 跟随模式                        |
| `enableFile`    | 是否文件输出（null=跟随 !isDev） | 跟随模式                        |
| `maxFileSize`   | 单文件滚动阈值                   | 5MB                             |
| `maxBackup`     | 历史备份文件数                   | 3                               |

- 工厂：`createLogger(config)` 返回带 `debug/info/warn/error` 的实例。
- 上下文：`logger.child({scriptId})` 预置上下文，或每次调用传 `ctx`。
- 错误：`error(msg, ctx, err)`。
- 兜底：`installProcessHandlers(logger)` 捕获 `uncaughtException` / `unhandledRejection`。

## 5. 后续步骤（待逐项推进）

- [ ] 脚本列表 UI + 新增表单（`client/`）
- [ ] PTY Host 与 xterm 双向流（`electron/pty-host.js` + `TerminalPane`）
- [ ] 后端脚本 CRUD API（`server/index.js`）
- [ ] 打包配置与日志目录注入（`electron-builder` + 主进程注入 `EASYOPS_LOG_DIR`）
