# EasyOps - Script Manager

EasyOps 是一个基于 Electron + React + Node.js 的脚本管理桌面应用，用于管理、编辑和批量执行 Shell 脚本，支持实时流式输出查看。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 前端 | React 19 + Vite 6 |
| 代码编辑器 | CodeMirror 6 |
| 后端 | Node.js + Express |
| 构建工具 | electron-builder |
| HTTP 通信 | Axios + SSE (Server-Sent Events) |

## 功能特性

- **脚本管理**：新增、编辑、删除 Shell 脚本
- **分组管理**：支持 Backend / Frontend 分组，拖拽切换分组
- **拖拽排序**：拖拽调整脚本执行顺序，支持跨分组拖拽
- **实时流式执行**：基于 SSE 实现脚本执行的实时输出
- **批量执行**：多选脚本后一键批量执行
- **Shell 语法高亮**：使用 CodeMirror 6 提供 Shell 脚本编辑高亮
- **跨平台**：支持 Windows、macOS、Linux（自动检测 Bash / Git Bash / WSL / cmd）
- **系统信息展示**：显示当前 Shell 类型、版本等信息

## 项目结构

```
EasyOps/
├── client/                  # React 前端
│   ├── src/
│   │   ├── App.jsx          # 主应用组件
│   │   ├── App.css          # 样式
│   │   ├── main.jsx         # 入口文件
│   │   └── components/
│   │       └── ShellEditor.jsx  # CodeMirror Shell 编辑器
│   ├── public/
│   ├── package.json
│   └── vite.config.js
├── server/                  # Node.js 后端
│   ├── index.js             # Express 服务（API + SSE 流式执行）
│   └── scripts.json         # 脚本数据存储
├── electron/                # Electron 主进程
│   ├── main.js              # 主进程入口
│   └── preload.js           # 预加载脚本
├── package.json             # 根项目配置
└── README.md
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- （Windows 用户建议安装 Git Bash）

### 安装依赖

```bash
# 安装根目录依赖（Electron + concurrently）
npm install

# 安装前端依赖
cd client && npm install
```

### 开发模式

```bash
# 同时启动前端开发服务器（Vite）和后端服务（Express）
npm run dev
```

前端开发服务器运行在 `http://localhost:5173`，后端 API 运行在 `http://localhost:3001`。

### Electron 开发模式

```bash
# 先构建前端，再启动 Electron 应用
npm run electron-dev
```

### 构建安装包

```bash
# 构建 Windows 安装包（NSIS + ZIP）
npm run electron-build
```

构建产物输出到 `dist-electron/` 目录。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/scripts` | 获取所有脚本 |
| POST | `/api/scripts` | 新增脚本 |
| PUT | `/api/scripts/:id` | 更新脚本 |
| DELETE | `/api/scripts/:id` | 删除脚本 |
| POST | `/api/scripts/reorder` | 批量排序 / 切换分组 |
| GET | `/api/scripts/:id/execute-stream` | SSE 流式执行单个脚本 |
| GET | `/api/scripts/batch-execute-stream` | SSE 流式批量执行脚本 |
| GET | `/api/system-info` | 获取系统信息（平台、Shell 类型等） |

## 脚本执行原理

1. 后端自动检测当前系统的 Shell 环境（Windows 优先查找 Git Bash / WSL，回退至 cmd；Linux/macOS 使用 bash）
2. 前端通过 EventSource 订阅 `/api/scripts/:id/execute-stream` 接口
3. 后端通过 `child_process.spawn` 启动 Shell 进程，将脚本内容通过 stdin 传入
4. stdout / stderr 通过 SSE 实时推送到前端展示
5. 客户端断开连接时自动终止子进程

## 配置说明

- 脚本数据存储在 `server/scripts.json`（Electron 打包后存储在用户数据目录）
- 后端端口默认为 `3001`，若被占用则自动在 `3001-3100` 范围内查找可用端口
- 前端开发代理配置在 `client/vite.config.js` 中，自动读取后端端口
- Electron 打包配置在根 `package.json` 的 `build` 字段中