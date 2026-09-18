# EasyOps 重构 · 计划 1/3:基础骨架、数据层与脚本管理

> **面向 AI 代理的工作者:** 必需子技能:使用 subagent-driven-development(推荐)或 executing-plans 逐任务实现此计划。步骤使用复选框(`- [ ]`)语法来跟踪进度。

**目标:** 搭起 electron-vite 三进程骨架,跑通 node-pty 原生模块,实现脚本与分组的数据层、CRUD 界面与 shell 编辑器。

**架构:** Electron 主进程持有全部数据(经 `electron-store` 持久化到 `userData`)与 PTY 会话;preload 经 `contextBridge` 暴露类型安全的 `window.api`;renderer 为 React 18 + Ant Design 5,状态用 zustand。所有业务逻辑放在可被 vitest 直接调用的纯模块里,IPC 层只做薄封装。

**技术栈:** Electron 37.10.3 / electron-vite 4.0.1 / Vite 5.4.21 / TypeScript 5 / React 18.2 / Ant Design 5 / zustand 5 / electron-store 8.2.0 / node-pty 1.1.0 / CodeMirror 6 / vitest

**规格:** `docs/superpowers/specs/2026-09-13-easyops-refactor-design.md`

## 全局约束

以下为项目级硬性要求,每个任务都隐含包含本节:

- Electron 固定 `37.10.3`;electron-vite 固定 `4.0.1`;Vite 固定 `5.4.21`;React / react-dom 固定 `18.2.0`。
- `electron-store` 必须是 **8.2.0(CJS)**;不得升级到 9+ 或 11.x(纯 ESM,与主进程 CJS 冲突)。
- `@xterm/xterm` 固定 `5.5.0`(不用 6.x);`@xterm/addon-fit` 用 `0.10.0`;`@xterm/addon-web-links` 用 `0.11.0`。
- `node-pty` 固定 `1.1.0`,必须列在 `dependencies`(非 devDependencies),并在 `electron-builder.yml` 中 `asarUnpack`。
- 脚本名称:必填,**1–30 字符**;分组名称:必填,**1–15 字符**。校验在主进程(权威)与渲染层(即时反馈)双侧执行。
- 分组为**可选**(`Script.groupId` 可为 `null`)。
- **不做多选批量执行**,仅支持单个脚本执行。
- 目录结构、数据模型、IPC 通道命名一律以规格 §4 / §5 / §7 为准。
- 提交信息使用中文,格式 `type: 描述`(type 取 feat / fix / docs / chore / test / refactor)。
- 涉及 UI 文案一律使用简体中文。

---

## 文件结构

本计划涉及的文件(职责单一,按职责而非技术层级拆分):

| 路径 | 职责 |
|---|---|
| `package.json` | 依赖与脚本;`main` 指向 `out/main/index.js` |
| `electron.vite.config.ts` | 三进程构建配置 |
| `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json` | 类型检查配置(node 侧 / web 侧分离) |
| `vitest.config.ts` | 测试配置(node 环境为主,renderer 测试用 jsdom) |
| `.gitignore` | 忽略构建产物与编辑器目录 |
| `src/main/index.ts` | app 生命周期、单实例锁、组装各模块 |
| `src/main/window.ts` | 主窗口创建与配置 |
| `src/main/ipc/index.ts` | IPC 注册中心,按域调用各 handler 模块 |
| `src/main/ipc/scripts.ts` | 脚本域 IPC handler 注册 |
| `src/main/ipc/groups.ts` | 分组域 IPC handler 注册 |
| `src/main/store/scripts.ts` | 脚本与分组的数据读写(纯逻辑,可测) |
| `src/main/store/settings.ts` | 设置读写(纯逻辑,可测) |
| `src/main/store/persistence.ts` | electron-store 实例与原子写入封装 |
| `src/main/pty/probe.ts` | node-pty 原生模块可用性探测(任务 2 的交付物) |
| `src/preload/index.ts` | contextBridge 暴露 `window.api` |
| `src/preload/index.d.ts` | `window.api` 类型声明 |
| `src/renderer/index.html` | 渲染进程入口 HTML |
| `src/renderer/src/main.tsx` | React 挂载入口 |
| `src/renderer/src/App.tsx` | 顶层布局 |
| `src/renderer/src/theme/provider.tsx` | 主题三态 + AntD ConfigProvider |
| `src/renderer/src/theme/useResolvedTheme.ts` | 解析 `system` 态为实际 light/dark |
| `src/renderer/src/store/useAppStore.ts` | zustand:脚本、分组与选中态 |
| `src/renderer/src/components/Sidebar.tsx` | 分组树 + 脚本列表 |
| `src/renderer/src/components/GroupFormModal.tsx` | 分组新增/编辑弹窗 |
| `src/renderer/src/components/ScriptFormModal.tsx` | 脚本新增/编辑弹窗(含名称校验) |
| `src/renderer/src/components/ScriptEditor.tsx` | CodeMirror 6 shell 编辑器 |
| `src/renderer/src/editor/shellKeywords.ts` | 关键字候选词表与补全源(纯函数,可测) |
| `tests/main/validate.test.ts` | 校验单测 |
| `tests/main/scripts-store.test.ts` | 脚本/分组数据层单测 |
| `tests/main/settings-store.test.ts` | 设置数据层单测 |
| `tests/renderer/shellKeywords.test.ts` | 候选词表单测 |

---

## 任务 1:项目骨架与构建管线

> **已知风险与回退**:`electron-vite@4.0.1` 内部使用 Vite 7,而本项目按需求固定 Vite 5.4.21(其 peer 声明支持 `^5`)。若 `npm run dev` 因 Vite API 不兼容报错,回退方案为改用 `electron-vite@3.1.0`(纯 Vite 5 时代版本),其余配置不变。本任务必须先验证这一点。

**文件:**
- 创建:`package.json`
- 创建:`electron.vite.config.ts`
- 创建:`tsconfig.json`、`tsconfig.node.json`、`tsconfig.web.json`
- 创建:`.gitignore`
- 创建:`src/main/index.ts`、`src/main/window.ts`
- 创建:`src/preload/index.ts`
- 创建:`src/renderer/index.html`、`src/renderer/src/main.tsx`、`src/renderer/src/App.tsx`
- 创建:`build/icon.png`(从 `master` 分支复制)

- [ ] **步骤 1:从旧版分支取出图标资源**

```bash
cd /Users/arthur/www/easy-ops
mkdir -p build
git show master:client/public/logo-1024.png > build/icon.png
ls -la build/icon.png
```

预期:文件存在且大于 1KB。

- [ ] **步骤 2:写 `package.json`**

```json
{
  "name": "easyops",
  "version": "0.8.0",
  "description": "EasyOps - Script Manager Desktop App",
  "main": "./out/main/index.js",
  "author": "bynow2code",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/bynow2code/easy-ops.git"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "npm run typecheck && electron-vite build",
    "start": "electron-vite preview",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json --composite false",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json --composite false",
    "typecheck": "npm run typecheck:node && npm run typecheck:web",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "electron-builder install-app-deps",
    "build:win": "npm run build && electron-builder --win",
    "build:mac": "npm run build && electron-builder --mac",
    "build:linux": "npm run build && electron-builder --linux"
  },
  "dependencies": {
    "electron-store": "8.2.0",
    "electron-updater": "^6.3.9",
    "node-pty": "1.1.0"
  },
  "devDependencies": {
    "@ant-design/icons": "^6.3.4",
    "@codemirror/autocomplete": "^6.20.3",
    "@codemirror/legacy-modes": "^6.5.4",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^15.0.7",
    "@types/node": "^22.10.2",
    "@types/react": "^18.2.79",
    "@types/react-dom": "^18.2.25",
    "@uiw/react-codemirror": "^4.25.10",
    "@vitejs/plugin-react": "^4.3.4",
    "@xterm/addon-fit": "0.10.0",
    "@xterm/addon-web-links": "0.11.0",
    "@xterm/xterm": "5.5.0",
    "antd": "^5.29.3",
    "electron": "37.10.3",
    "electron-builder": "^26.0.12",
    "electron-vite": "4.0.1",
    "jsdom": "^25.0.1",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "typescript": "^5.7.2",
    "vite": "5.4.21",
    "vitest": "^2.1.9",
    "zustand": "^5.0.2"
  }
}
```

- [ ] **步骤 3:写 `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
```

- [ ] **步骤 4:写三个 tsconfig**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUnusedLocals": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "tests/**/*", "electron.vite.config.ts", "vitest.config.ts"]
}
```

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/renderer/src/*"],
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*", "src/preload/index.d.ts"]
}
```

- [ ] **步骤 5:写 `.gitignore`**

```
node_modules/
out/
dist/
release/
.DS_Store
*.log
.idea/
.vscode/
```

- [ ] **步骤 6:写主进程最小实现**

`src/main/window.ts`:

```ts
import { resolve } from 'node:path'
import { BrowserWindow, shell } from 'electron'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1280,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'EasyOps',
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(resolve(__dirname, '../renderer/index.html'))
  }

  return win
}
```

`src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'

let mainWindow: BrowserWindow | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
```

- [ ] **步骤 7:写 preload 最小实现**

`src/preload/index.ts`:

```ts
import { contextBridge } from 'electron'

const api = {
  ping: (): string => 'pong'
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

- [ ] **步骤 8:写渲染进程最小实现**

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"
    />
    <title>EasyOps</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import 'antd/dist/reset.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx`:

```tsx
import { Button, Typography } from 'antd'

export default function App(): JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>EasyOps</Typography.Title>
      <Button type="primary" onClick={() => window.api.ping().then((r) => console.log(r))}>
        测试 IPC
      </Button>
    </div>
  )
}
```

- [ ] **步骤 9:安装依赖**

```bash
cd /Users/arthur/www/easy-ops
npm install
```

预期:安装成功,`postinstall` 触发 `electron-builder install-app-deps` 并为 Electron 37 重建 `node-pty`。

- [ ] **步骤 10:运行开发模式验证骨架**

```bash
npm run dev
```

预期:Electron 窗口出现,显示「EasyOps」标题与一个按钮;点击按钮后终端输出 `pong`。

若因 Vite API 不兼容报错,按本任务开头说明回退到 `electron-vite@3.1.0` 后重试。

- [ ] **步骤 11:Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json .gitignore build/icon.png src/
git commit -m "feat: 搭建 electron-vite 三进程骨架"
```

---

## 任务 2:node-pty 原生模块可用性验证

这是整个方案中唯一可能"卡住"的技术点,必须在写任何业务代码前验证。

> **测试策略说明**:`node-pty` 是原生模块,安装时为 Electron ABI 构建,因此在 Node 环境运行的 vitest 中 **无法直接 require**(ABI 不匹配)。所以本任务不做 vitest 单测,改为在 Electron 主进程内做启动探测;后续任务中凡涉及 PTY 的,也只把纯逻辑(参数拼装、标题序号等)抽出来做单测。

**文件:**
- 创建:`src/main/pty/probe.ts`
- 修改:`src/main/index.ts`(在 `whenReady` 中调用探测)

- [ ] **步骤 1:写探测模块**

`src/main/pty/probe.ts`:

```ts
import * as os from 'node:os'
import * as pty from 'node-pty'

export interface ProbeResult {
  ok: boolean
  output: string
  exitCode: number | null
  error?: string
}

const PROBE_TIMEOUT_MS = 5000

export function probePty(): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: ProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    let child: pty.IPty
    try {
      child = pty.spawn(
        process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        process.platform === 'win32' ? ['/c', 'echo easyops-pty-ok'] : ['-c', 'echo easyops-pty-ok'],
        {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd: os.homedir(),
          env: process.env as Record<string, string>
        }
      )
    } catch (err) {
      done({ ok: false, output: '', exitCode: null, error: String(err) })
      return
    }

    let buffer = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 忽略:探测超时后的清理失败不影响结论 */
      }
      done({ ok: false, output: buffer, exitCode: null, error: '探测超时' })
    }, PROBE_TIMEOUT_MS)

    child.onData((chunk) => {
      buffer += chunk
    })

    child.onExit(({ exitCode }) => {
      done({
        ok: buffer.includes('easyops-pty-ok'),
        output: buffer,
        exitCode
      })
    })
  })
}
```

- [ ] **步骤 2:在主进程启动时调用探测并打印结果**

在 `src/main/index.ts` 顶部增加导入:

```ts
import { probePty } from './pty/probe'
```

在 `app.whenReady().then(...)` 内部、`mainWindow = createMainWindow()` 之前插入:

```ts
    const probe = await probePty()
    if (probe.ok) {
      console.log('[EasyOps] node-pty 可用,输出:', probe.output.trim())
    } else {
      console.error('[EasyOps] node-pty 不可用:', probe.error ?? `退出码 ${probe.exitCode}`)
    }
```

并将 `whenReady().then(() => {` 改为 `whenReady().then(async () => {`。

- [ ] **步骤 3:运行并确认探测通过**

```bash
npm run dev
```

预期:终端输出 `[EasyOps] node-pty 可用,输出: easyops-pty-ok`(macOS 上可能带多余的 `\r\n` 或回显,属正常)。

若输出 `node-pty 不可用`,排查顺序:① 是否执行过 `electron-builder install-app-deps`;② `npm rebuild node-pty --runtime=electron --target=37.10.3`;③ 检查 Xcode Command Line Tools 是否安装(macOS)。

- [ ] **步骤 4:Commit**

```bash
git add src/main/pty/probe.ts src/main/index.ts
git commit -m "feat: 增加 node-pty 原生模块启动探测"
```

---

## 任务 3:校验逻辑与数据层

**文件:**
- 创建:`src/shared/types.ts`(数据模型、常量与三个 `validate*` 函数 —— 校验必须放在 `shared/` 下才能被渲染层复用,以满足"双侧校验"约束)
- 创建:`src/main/store/persistence.ts`
- 创建:`src/main/store/scripts.ts`
- 创建:`src/main/store/settings.ts`
- 测试:`tests/main/validate.test.ts`
- 测试:`tests/main/scripts-store.test.ts`
- 测试:`tests/main/settings-store.test.ts`

- [ ] **步骤 1:写共享类型定义**

`src/shared/types.ts`:

```ts
export interface Script {
  id: string
  name: string
  content: string
  groupId: string | null
  shellId: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export interface Group {
  id: string
  name: string
  order: number
  createdAt: string
}

export interface CustomShell {
  id: string
  name: string
  path: string
}

export interface ShellInfo {
  id: string
  name: string
  path: string
  args: string[]
  version?: string
  source: 'detected' | 'custom'
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface Settings {
  theme: ThemeMode
  shellId: string | null
  customShells: CustomShell[]
  checkUpdateOnLaunch: boolean
}

export const SCRIPT_NAME_MAX = 30
export const GROUP_NAME_MAX = 15

export interface ValidationResult {
  ok: boolean
  message?: string
}

// 以下三个函数本步骤只声明签名,实现留到步骤 3 的 TDD 循环里补齐,
// 目的是让步骤 2 的测试能够先真实失败。
export function validateScriptName(_name: unknown): ValidationResult {
  throw new Error('not implemented')
}

export function validateGroupName(_name: unknown): ValidationResult {
  throw new Error('not implemented')
}

export function validateScriptContent(_content: unknown): ValidationResult {
  throw new Error('not implemented')
}
```

> 说明:长度用 `Array.from(name).length` 计数,保证中文与 emoji 按字符而非 UTF-16 码元计数。

- [ ] **步骤 2:写失败的测试(校验)**

`tests/main/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SCRIPT_NAME_MAX,
  GROUP_NAME_MAX,
  validateGroupName,
  validateScriptContent,
  validateScriptName
} from '../../src/shared/types'

describe('validateScriptName', () => {
  it('拒绝空字符串', () => {
    expect(validateScriptName('').ok).toBe(false)
  })

  it('拒绝纯空白', () => {
    expect(validateScriptName('   ').ok).toBe(false)
  })

  it('拒绝非字符串', () => {
    expect(validateScriptName(undefined).ok).toBe(false)
    expect(validateScriptName(123).ok).toBe(false)
  })

  it('接受 30 个字符', () => {
    expect(validateScriptName('a'.repeat(SCRIPT_NAME_MAX)).ok).toBe(true)
  })

  it('拒绝 31 个字符', () => {
    expect(validateScriptName('a'.repeat(SCRIPT_NAME_MAX + 1)).ok).toBe(false)
  })

  it('中文按字符计数:30 个汉字通过', () => {
    expect(validateScriptName('测'.repeat(30)).ok).toBe(true)
  })

  it('中文按字符计数:31 个汉字被拒', () => {
    expect(validateScriptName('测'.repeat(31)).ok).toBe(false)
  })
})

describe('validateGroupName', () => {
  it('接受 15 个字符', () => {
    expect(validateGroupName('a'.repeat(GROUP_NAME_MAX)).ok).toBe(true)
  })

  it('拒绝 16 个字符', () => {
    expect(validateGroupName('a'.repeat(GROUP_NAME_MAX + 1)).ok).toBe(false)
  })

  it('拒绝空字符串', () => {
    expect(validateGroupName('').ok).toBe(false)
  })
})

describe('validateScriptContent', () => {
  it('拒绝空内容', () => {
    expect(validateScriptContent('').ok).toBe(false)
  })

  it('拒绝纯空白内容', () => {
    expect(validateScriptContent('\n\t  ').ok).toBe(false)
  })

  it('接受有内容的脚本', () => {
    expect(validateScriptContent('echo hi').ok).toBe(true)
  })
})
```

- [ ] **步骤 3:验证测试失败,再补实现使其通过**

运行:`npx vitest run tests/main/validate.test.ts`
预期:FAIL,报错 `not implemented`。

把 `src/shared/types.ts` 里三个占位函数替换为以下实现:

```ts
export function validateScriptName(name: unknown): ValidationResult {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, message: '脚本名称不能为空' }
  }
  if (Array.from(name).length > SCRIPT_NAME_MAX) {
    return { ok: false, message: `脚本名称不能超过 ${SCRIPT_NAME_MAX} 个字符` }
  }
  return { ok: true }
}

export function validateGroupName(name: unknown): ValidationResult {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, message: '分组名称不能为空' }
  }
  if (Array.from(name).length > GROUP_NAME_MAX) {
    return { ok: false, message: `分组名称不能超过 ${GROUP_NAME_MAX} 个字符` }
  }
  return { ok: true }
}

export function validateScriptContent(content: unknown): ValidationResult {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, message: '脚本内容不能为空' }
  }
  return { ok: true }
}
```

再次运行:`npx vitest run tests/main/validate.test.ts`
预期:PASS。

- [ ] **步骤 4:写失败的测试(脚本与分组数据层)**

`tests/main/scripts-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createScriptsStore, type ScriptsData } from '../../src/main/store/scripts'

let data: ScriptsData
let store: ReturnType<typeof createScriptsStore>

beforeEach(() => {
  data = { scripts: [], groups: [] }
  store = createScriptsStore({
    read: () => data,
    write: (next) => {
      data = next
    }
  })
})

describe('分组', () => {
  it('创建分组时校验名称长度', () => {
    expect(() => store.createGroup('a'.repeat(16))).toThrowError(/15/)
    expect(data.groups).toHaveLength(0)
  })

  it('创建分组并分配递增 order', () => {
    const g1 = store.createGroup('后端')
    const g2 = store.createGroup('前端')
    expect(g1.name).toBe('后端')
    expect(g1.order).toBe(0)
    expect(g2.order).toBe(1)
    expect(data.groups).toHaveLength(2)
  })

  it('删除分组时其下脚本的 groupId 置空', () => {
    const g = store.createGroup('后端')
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: g.id })
    expect(s.groupId).toBe(g.id)
    store.deleteGroup(g.id)
    expect(store.listScripts()[0].groupId).toBeNull()
    expect(data.groups).toHaveLength(0)
  })
})

describe('脚本', () => {
  it('创建脚本时校验名称超长', () => {
    expect(() => store.createScript({ name: 'a'.repeat(31), content: 'echo', groupId: null })).toThrowError(/30/)
  })

  it('创建脚本时校验内容为空', () => {
    expect(() => store.createScript({ name: 'a', content: '  ', groupId: null })).toThrowError(/内容/)
  })

  it('允许 groupId 为 null(分组不必选)', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    expect(s.groupId).toBeNull()
  })

  it('更新名称时同样执行长度校验', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    expect(() => store.updateScript(s.id, { name: 'b'.repeat(31) })).toThrowError(/30/)
    expect(store.listScripts()[0].name).toBe('a')
  })

  it('更新时刷新 updatedAt', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    const before = s.updatedAt
    const updated = store.updateScript(s.id, { content: 'echo b' })
    expect(updated.content).toBe('echo b')
    expect(updated.updatedAt >= before).toBe(true)
  })

  it('删除脚本', () => {
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    store.deleteScript(s.id)
    expect(store.listScripts()).toHaveLength(0)
  })

  it('按 ids 重排脚本 order', () => {
    const a = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    const b = store.createScript({ name: 'b', content: 'echo b', groupId: null })
    const c = store.createScript({ name: 'c', content: 'echo c', groupId: null })
    store.reorderScripts([c.id, a.id, b.id])
    expect(store.listScripts().map((s) => s.id)).toEqual([c.id, a.id, b.id])
    expect(store.listScripts().map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('将脚本移入分组', () => {
    const g = store.createGroup('后端')
    const s = store.createScript({ name: 'a', content: 'echo a', groupId: null })
    const moved = store.updateScript(s.id, { groupId: g.id })
    expect(moved.groupId).toBe(g.id)
  })

  it('操作不存在的脚本时抛错', () => {
    expect(() => store.updateScript('nope', { name: 'x' })).toThrowError(/不存在/)
    expect(() => store.deleteScript('nope')).toThrowError(/不存在/)
  })
})

describe('分组重排', () => {
  it('按 ids 重排分组 order', () => {
    const g1 = store.createGroup('A')
    const g2 = store.createGroup('B')
    store.reorderGroups([g2.id, g1.id])
    expect(store.listGroups().map((g) => g.id)).toEqual([g2.id, g1.id])
    expect(store.listGroups().map((g) => g.order)).toEqual([0, 1])
  })
})
```

- [ ] **步骤 5:运行测试验证失败**

运行:`npx vitest run tests/main/scripts-store.test.ts`
预期:FAIL,报错 `Failed to resolve import "../../src/main/store/scripts"`。

- [ ] **步骤 6:实现数据层**

`src/main/store/persistence.ts`:

```ts
import Store from 'electron-store'

export interface Persistence<T> {
  read: () => T
  write: (next: T) => void
}

// 约束放宽为 Record<string, any> 而非 Record<string, unknown>:ScriptsData 与 Settings 都是
// interface,TypeScript 不为 interface 推断隐式索引签名,用 unknown 会让调用点报 TS2345。
// electron-store 自身的泛型约束口径也是 Record<string, any>。
export function createElectronStore<T extends Record<string, any>>(
  name: string,
  defaults: T,
  key: string
): Persistence<T> {
  const store = new Store<T>({ name, defaults })
  return {
    read: () => (store.get(key) as T) ?? defaults,
    write: (next) => {
      store.set(key, next)
    }
  }
}

export function createMemoryPersistence<T>(initial: T): Persistence<T> {
  let data = initial
  return {
    read: () => data,
    write: (next) => {
      data = next
    }
  }
}
```

`src/main/store/scripts.ts`:

```ts
import {
  GROUP_NAME_MAX,
  SCRIPT_NAME_MAX,
  validateGroupName,
  validateScriptContent,
  validateScriptName
} from '../../shared/types'
import type { Group, Script } from '../../shared/types'
import type { Persistence } from './persistence'

export interface ScriptsData {
  scripts: Script[]
  groups: Group[]
}

export type CreateScriptInput = {
  name: string
  content: string
  groupId: string | null
  shellId?: string | null
}

export type ScriptPatch = Partial<Pick<Script, 'name' | 'content' | 'groupId' | 'shellId'>>

export interface ScriptsStore {
  listScripts: () => Script[]
  listGroups: () => Group[]
  createScript: (input: CreateScriptInput) => Script
  updateScript: (id: string, patch: ScriptPatch) => Script
  deleteScript: (id: string) => void
  reorderScripts: (ids: string[]) => void
  createGroup: (name: string) => Group
  updateGroup: (id: string, name: string) => Group
  deleteGroup: (id: string) => void
  reorderGroups: (ids: string[]) => void
  replaceAll: (data: ScriptsData) => ScriptsData
}

function nowIso(): string {
  return new Date().toISOString()
}

function nextOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1
}

function normalizeOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }))
}

function applyOrderById<T extends { id: string; order: number }>(items: T[], ids: string[]): T[] {
  const indexOf = new Map(ids.map((id, i) => [id, i]))
  return items.map((item) => {
    const next = indexOf.get(item.id)
    return next === undefined ? item : { ...item, order: next }
  })
}

export function createScriptsStore(persistence: Persistence<ScriptsData>): ScriptsStore {
  const state = (): ScriptsData => {
    const raw = persistence.read()
    return {
      scripts: Array.isArray(raw?.scripts) ? raw.scripts : [],
      groups: Array.isArray(raw?.groups) ? raw.groups : []
    }
  }

  const commit = (next: ScriptsData): ScriptsData => {
    persistence.write(next)
    return next
  }

  return {
    listScripts() {
      return normalizeOrder(state().scripts)
    },

    listGroups() {
      return normalizeOrder(state().groups)
    },

    createScript(input) {
      const nameCheck = validateScriptName(input.name)
      if (!nameCheck.ok) throw new Error(nameCheck.message)
      const contentCheck = validateScriptContent(input.content)
      if (!contentCheck.ok) throw new Error(contentCheck.message)

      const data = state()
      const script: Script = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        content: input.content,
        groupId: input.groupId ?? null,
        shellId: input.shellId ?? null,
        order: nextOrder(data.scripts),
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
      commit({ ...data, scripts: [...data.scripts, script] })
      return script
    },

    updateScript(id, patch) {
      const data = state()
      const index = data.scripts.findIndex((s) => s.id === id)
      if (index === -1) throw new Error(`脚本不存在: ${id}`)

      if (patch.name !== undefined) {
        const nameCheck = validateScriptName(patch.name)
        if (!nameCheck.ok) throw new Error(nameCheck.message)
      }
      if (patch.content !== undefined) {
        const contentCheck = validateScriptContent(patch.content)
        if (!contentCheck.ok) throw new Error(contentCheck.message)
      }

      const updated: Script = {
        ...data.scripts[index],
        ...patch,
        updatedAt: nowIso()
      }
      const scripts = [...data.scripts]
      scripts[index] = updated
      commit({ ...data, scripts })
      return updated
    },

    deleteScript(id) {
      const data = state()
      if (!data.scripts.some((s) => s.id === id)) throw new Error(`脚本不存在: ${id}`)
      commit({ ...data, scripts: data.scripts.filter((s) => s.id !== id) })
    },

    reorderScripts(ids) {
      const data = state()
      commit({ ...data, scripts: applyOrderById(data.scripts, ids) })
    },

    createGroup(name) {
      const nameCheck = validateGroupName(name)
      if (!nameCheck.ok) throw new Error(nameCheck.message)
      const data = state()
      const group: Group = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        order: nextOrder(data.groups),
        createdAt: nowIso()
      }
      commit({ ...data, groups: [...data.groups, group] })
      return group
    },

    updateGroup(id, name) {
      const nameCheck = validateGroupName(name)
      if (!nameCheck.ok) throw new Error(nameCheck.message)
      const data = state()
      const index = data.groups.findIndex((g) => g.id === id)
      if (index === -1) throw new Error(`分组不存在: ${id}`)
      const groups = [...data.groups]
      groups[index] = { ...groups[index], name }
      commit({ ...data, groups })
      return groups[index]
    },

    deleteGroup(id) {
      const data = state()
      if (!data.groups.some((g) => g.id === id)) throw new Error(`分组不存在: ${id}`)
      commit({
        groups: data.groups.filter((g) => g.id !== id),
        scripts: data.scripts.map((s) => (s.groupId === id ? { ...s, groupId: null } : s))
      })
    },

    reorderGroups(ids) {
      const data = state()
      commit({ ...data, groups: applyOrderById(data.groups, ids) })
    },

    replaceAll(next) {
      return commit({
        scripts: Array.isArray(next.scripts) ? next.scripts : [],
        groups: Array.isArray(next.groups) ? next.groups : []
      })
    }
  }
}
```

`src/main/store/settings.ts`:

```ts
import type { Settings, ThemeMode } from '../../shared/types'
import type { Persistence } from './persistence'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  shellId: null,
  customShells: [],
  checkUpdateOnLaunch: true
}

const THEMES: ThemeMode[] = ['light', 'dark', 'system']

export interface SettingsStore {
  get: () => Settings
  update: (patch: Partial<Settings>) => Settings
}

export function createSettingsStore(persistence: Persistence<Settings>): SettingsStore {
  let cache: Settings = { ...DEFAULT_SETTINGS, ...persistence.read() }

  return {
    get() {
      return { ...cache }
    },

    update(patch) {
      const next: Settings = { ...cache }

      if (patch.theme !== undefined) {
        if (!THEMES.includes(patch.theme)) throw new Error(`无效的主题值: ${String(patch.theme)}`)
        next.theme = patch.theme
      }
      if (patch.shellId !== undefined) {
        next.shellId = typeof patch.shellId === 'string' && patch.shellId.length > 0 ? patch.shellId : null
      }
      if (patch.checkUpdateOnLaunch !== undefined) {
        next.checkUpdateOnLaunch = Boolean(patch.checkUpdateOnLaunch)
      }
      if (patch.customShells !== undefined) {
        next.customShells = Array.isArray(patch.customShells)
          ? patch.customShells
              .filter((s) => s && typeof s.id === 'string' && typeof s.path === 'string')
              .map((s) => ({ id: s.id, name: String(s.name ?? s.path), path: s.path }))
          : []
      }

      cache = next
      persistence.write(next)
      return { ...next }
    }
  }
}
```

- [ ] **步骤 7:运行测试验证通过**

运行:`npx vitest run tests/main/scripts-store.test.ts tests/main/settings-store.test.ts tests/main/validate.test.ts`
预期:全部 PASS。

- [ ] **步骤 8:写设置数据层测试**

`tests/main/settings-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, DEFAULT_SETTINGS } from '../../src/main/store/settings'
import type { Settings } from '../../src/shared/types'

let saved: Settings
let store: ReturnType<typeof createSettingsStore>

beforeEach(() => {
  saved = { ...DEFAULT_SETTINGS }
  store = createSettingsStore({
    read: () => saved,
    write: (next) => {
      saved = next
    }
  })
})

describe('settingsStore', () => {
  it('默认主题为 system', () => {
    expect(store.get().theme).toBe('system')
  })

  it('接受合法主题值', () => {
    expect(store.update({ theme: 'dark' }).theme).toBe('dark')
    expect(saved.theme).toBe('dark')
  })

  it('拒绝非法主题值', () => {
    expect(() => store.update({ theme: 'blue' as never })).toThrowError(/主题/)
  })

  it('把空字符串 shellId 归一化为 null', () => {
    expect(store.update({ shellId: '' }).shellId).toBeNull()
    expect(store.update({ shellId: 'zsh' }).shellId).toBe('zsh')
  })

  it('过滤掉结构不完整的自定义 shell', () => {
    const result = store.update({
      customShells: [
        { id: 'custom:/bin/x', name: 'x', path: '/bin/x' },
        { id: 'bad', name: 'missing path' } as never
      ]
    })
    expect(result.customShells).toHaveLength(1)
    expect(result.customShells[0].path).toBe('/bin/x')
  })

  it('get 返回副本,外部修改不影响内部状态', () => {
    const a = store.get()
    a.theme = 'dark'
    expect(store.get().theme).toBe('system')
  })
})
```

- [ ] **步骤 9:配置 vitest 并运行全部测试**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: false
  }
})
```

运行:`npm test`
预期:全部 PASS。

- [ ] **步骤 10:Commit**

```bash
git add vitest.config.ts src/shared/types.ts src/main/store/ tests/main/
git commit -m "feat: 实现脚本与分组数据层及校验逻辑"
```

---

## 任务 4:脚本与分组 CRUD 的 IPC 层

> **测试策略说明**:`ipcMain.handle` 依赖 Electron 运行时,无法在 vitest 中执行。因此本任务把「业务逻辑」全部留在任务 3 的数据层(已被单测覆盖),IPC 层只做**薄封装**(取参 → 调数据层 → 返回)。本任务的验证方式是启动应用后经 DevTools 调用 `window.api`。

> ⚠️ **更正(2026-09-18)**:上面「`ipcMain.handle` 无法在 vitest 中执行」的结论**已过时**。用 `vi.mock('electron')` 把 `ipcMain.handle` 注册的处理函数收进一个 Map,再直接调用它即可测试 —— 见 `tests/main/updater-ipc.test.ts` 与 `tests/main/scripts-ipc.test.ts`。IPC 层已有用例覆盖,新增通道时请一并补测,不必再只靠 DevTools 手验。(原文保留,作为当时的决策记录。)

**文件:**
- 创建:`src/main/ipc/scripts.ts`
- 创建:`src/main/ipc/groups.ts`
- 创建:`src/main/ipc/index.ts`
- 修改:`src/main/index.ts`(装配 store 并注册 IPC)
- 修改:`src/preload/index.ts`(暴露脚本与分组 API)
- 修改:`src/preload/index.d.ts`(类型声明)

- [ ] **步骤 1:写脚本域 IPC 注册**

`src/main/ipc/scripts.ts`:

```ts
import { ipcMain } from 'electron'
import type { ScriptsStore } from '../store/scripts'

export function registerScriptIpc(store: ScriptsStore): void {
  ipcMain.handle('script:list', () => store.listScripts())

  ipcMain.handle('script:create', (_event, input: { name: string; content: string; groupId: string | null }) =>
    store.createScript(input)
  )

  ipcMain.handle('script:update', (_event, payload: { id: string; patch: Record<string, unknown> }) =>
    store.updateScript(payload.id, payload.patch)
  )

  ipcMain.handle('script:delete', (_event, payload: { id: string }) => {
    store.deleteScript(payload.id)
  })

  ipcMain.handle('script:reorder', (_event, payload: { ids: string[] }) => {
    store.reorderScripts(payload.ids)
  })
}
```

- [ ] **步骤 2:写分组域 IPC 注册**

`src/main/ipc/groups.ts`:

```ts
import { ipcMain } from 'electron'
import type { ScriptsStore } from '../store/scripts'

export function registerGroupIpc(store: ScriptsStore): void {
  ipcMain.handle('group:list', () => store.listGroups())
  ipcMain.handle('group:create', (_event, payload: { name: string }) => store.createGroup(payload.name))
  ipcMain.handle('group:update', (_event, payload: { id: string; name: string }) =>
    store.updateGroup(payload.id, payload.name)
  )

  ipcMain.handle('group:delete', (_event, payload: { id: string }) => {
    store.deleteGroup(payload.id)
  })

  ipcMain.handle('group:reorder', (_event, payload: { ids: string[] }) => {
    store.reorderGroups(payload.ids)
  })
}
```

- [ ] **步骤 3:写 IPC 注册中心**

`src/main/ipc/index.ts`:

```ts
import { app, ipcMain, type BrowserWindow } from 'electron'
import type { ScriptsStore } from '../store/scripts'
import type { SettingsStore } from '../store/settings'
import { registerGroupIpc } from './groups'
import { registerScriptIpc } from './scripts'

export interface IpcContext {
  scripts: ScriptsStore
  settings: SettingsStore
  getWindow: () => BrowserWindow | null
  repoUrl: string
}

export function registerIpc(ctx: IpcContext): void {
  registerScriptIpc(ctx.scripts)
  registerGroupIpc(ctx.scripts)

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    repo: ctx.repoUrl,
    platform: process.platform
  }))

  ipcMain.handle('app:openExternal', async (_event, payload: { url: string }) => {
    const { shell } = await import('electron')
    if (/^https?:\/\//i.test(payload.url)) await shell.openExternal(payload.url)
  })
}
```

> 说明:`settings:get` / `settings:update` 两条通道在步骤 6 追加,以保持每一步都是可独立验证的增量。

- [ ] **步骤 4:在主进程装配 store 与 IPC**

> ⚠️ **不要对 `src/main/index.ts` 做整体替换。** 下面的代码基于任务 1 的初始形态编写;若照抄覆盖,会**回退任务 2 引入的两项已审查通过的修复**:① `spawnMainWindow()` 助手(macOS `activate` 分支重建窗口未挂 `closed` 监听的缺陷修复);② 探测收敛为「窗口创建之后、仅 `!app.isPackaged` 时执行、非阻塞」。请**只把新增内容合并进现有文件**:顶部新增的导入,以及 `whenReady` 回调内新增的 store 装配与 `registerIpc(...)` 调用。凡是与现有文件冲突的部分(尤其是窗口创建与探测的组织方式),**以现有文件为准**。

作为对照,合并后的完整形态应为:

```ts
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { probePty } from './pty/probe'
import { createElectronStore } from './store/persistence'
import { createScriptsStore, type ScriptsData } from './store/scripts'
import { createSettingsStore, DEFAULT_SETTINGS } from './store/settings'
import { createMainWindow } from './window'
import type { Settings } from '../shared/types'

const REPO_URL = 'https://github.com/bynow2code/easy-ops'

let mainWindow: BrowserWindow | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  const spawnMainWindow = (): void => {
    const win = createMainWindow()
    win.on('closed', () => {
      mainWindow = null
    })
    mainWindow = win
  }

  app
    .whenReady()
    .then(() => {
      const scriptsPersistence = createElectronStore<ScriptsData>('easyops-scripts', { scripts: [], groups: [] }, 'data')
      const settingsPersistence = createElectronStore<Settings>('easyops-settings', DEFAULT_SETTINGS, 'data')

      const scriptsStore = createScriptsStore(scriptsPersistence)
      const settingsStore = createSettingsStore(settingsPersistence)

      registerIpc({
        scripts: scriptsStore,
        settings: settingsStore,
        getWindow: () => mainWindow,
        repoUrl: REPO_URL
      })

      spawnMainWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          spawnMainWindow()
        }
      })

      if (!app.isPackaged) {
        void probePty().then((probe) => {
          if (probe.ok) {
            console.log('[EasyOps] node-pty 可用')
          } else {
            console.error('[EasyOps] node-pty 不可用:', probe.error ?? `退出码 ${probe.exitCode}`)
          }
        })
      }
    })
    .catch((err: unknown) => {
      console.error('[EasyOps] 主进程启动失败:', err)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
```

- [ ] **步骤 5:更新 preload 暴露脚本与分组 API**

`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Group, Script, Settings } from '../shared/types'

const api = {
  app: {
    info: (): Promise<{ version: string; repo: string; platform: string }> => ipcRenderer.invoke('app:info'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', { url })
  },
  scripts: {
    list: (): Promise<Script[]> => ipcRenderer.invoke('script:list'),
    create: (input: { name: string; content: string; groupId: string | null }): Promise<Script> =>
      ipcRenderer.invoke('script:create', input),
    update: (id: string, patch: Partial<Script>): Promise<Script> => ipcRenderer.invoke('script:update', { id, patch }),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('script:delete', { id }),
    reorder: (ids: string[]): Promise<void> => ipcRenderer.invoke('script:reorder', { ids })
  },
  groups: {
    list: (): Promise<Group[]> => ipcRenderer.invoke('group:list'),
    create: (name: string): Promise<Group> => ipcRenderer.invoke('group:create', { name }),
    update: (id: string, name: string): Promise<Group> => ipcRenderer.invoke('group:update', { id, name }),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('group:delete', { id }),
    reorder: (ids: string[]): Promise<void> => ipcRenderer.invoke('group:reorder', { ids })
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', { patch })
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

- [ ] **步骤 6:在注册中心补充 settings 通道**

在 `src/main/ipc/index.ts` 的 `registerIpc` 末尾追加:

```ts
  ipcMain.handle('settings:get', () => ctx.settings.get())
  ipcMain.handle('settings:update', (_event, payload: { patch: Partial<Settings> }) => ctx.settings.update(payload.patch))
```

并在文件顶部的导入中加入 `Settings` 类型:

```ts
import type { Settings } from '../../shared/types'
```

- [ ] **步骤 7:写 `window.api` 类型声明**

`src/preload/index.d.ts`:

```ts
import type { Api } from './index'

declare global {
  interface Window {
    api: Api
  }
}

export {}
```

- [ ] **步骤 8:运行类型检查**

运行:`npm run typecheck`
预期:无错误。

- [ ] **步骤 9:手动验证 IPC**

```bash
npm run dev
```

在应用窗口内按 `Cmd+Option+I`(macOS)打开 DevTools,在 Console 依次执行:

```js
await window.api.scripts.create({ name: '测试脚本', content: 'echo hello', groupId: null })
await window.api.scripts.list()
await window.api.groups.create('后端')
await window.api.scripts.create({ name: 'a'.repeat(31), content: 'echo', groupId: null })
```

预期:第 1 条返回新建脚本对象;第 2 条返回含 1 项的数组;第 3 条返回新建分组;第 4 条**抛出错误**并提示「脚本名称不能超过 30 个字符」。

- [ ] **步骤 10:Commit**

```bash
git add src/main/ipc/ src/main/index.ts src/preload/
git commit -m "feat: 注册脚本与分组 CRUD 的 IPC 通道"
```

---

## 任务 5:主题系统(深色 / 浅色 / 跟随系统)

**文件:**
- 创建:`src/renderer/src/theme/useResolvedTheme.ts`
- 创建:`src/renderer/src/theme/provider.tsx`
- 修改:`src/renderer/src/main.tsx`
- 修改:`src/renderer/src/App.tsx`(加主题切换按钮)
- 测试:`tests/renderer/useResolvedTheme.test.ts`

- [ ] **步骤 1:写失败的测试(系统主题解析)**

`tests/renderer/useResolvedTheme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveTheme } from '../../src/renderer/src/theme/useResolvedTheme'

describe('resolveTheme', () => {
  it('light 直接返回 light', () => {
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('dark 直接返回 dark', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
  })

  it('system 跟随系统为深色', () => {
    expect(resolveTheme('system', true)).toBe('dark')
  })

  it('system 跟随系统为浅色', () => {
    expect(resolveTheme('system', false)).toBe('light')
  })
})
```

- [ ] **步骤 2:运行测试验证失败**

运行:`npx vitest run tests/renderer/useResolvedTheme.test.ts`
预期:FAIL,报错无法解析模块。

- [ ] **步骤 3:实现主题解析与 Provider**

`src/renderer/src/theme/useResolvedTheme.ts`:

```ts
import { useEffect, useState } from 'react'
import type { ThemeMode } from '../../../shared/types'

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): 'light' | 'dark' {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return systemPrefersDark ? 'dark' : 'light'
}

const QUERY = '(prefers-color-scheme: dark)'

export function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState<boolean>(() =>
    typeof window === 'undefined' || !window.matchMedia ? false : window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(QUERY)
    const onChange = (event: MediaQueryListEvent): void => setPrefersDark(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return prefersDark
}
```

`src/renderer/src/theme/provider.tsx`:

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme } from 'antd'
import type { ThemeMode } from '../../../shared/types'
import { resolveTheme, useSystemPrefersDark } from './useResolvedTheme'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}

export function ThemeProvider({
  mode,
  onModeChange,
  children
}: {
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
  children: ReactNode
}): JSX.Element {
  const systemPrefersDark = useSystemPrefersDark()
  const resolved = resolveTheme(mode, systemPrefersDark)

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode: onModeChange }),
    [mode, resolved, onModeChange]
  )

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
```

- [ ] **步骤 4:接入渲染入口与最小页面**

`src/renderer/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import zhCN from 'antd/locale/zh_CN'
import { ConfigProvider } from 'antd'
import App from './App'
import 'antd/dist/reset.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Button, Segmented, Space, Typography } from 'antd'
import type { ThemeMode } from '../../shared/types'
import { ThemeProvider, useTheme } from './theme/provider'

function ThemeSwitch(): JSX.Element {
  const { mode, setMode } = useTheme()
  return (
    <Segmented
      value={mode}
      onChange={(value) => setMode(value as ThemeMode)}
      options={[
        { label: '浅色', value: 'light' },
        { label: '深色', value: 'dark' },
        { label: '跟随系统', value: 'system' }
      ]}
    />
  )
}

function Shell(): JSX.Element {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.info().then((info) => setVersion(info.version))
  }, [])

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large">
        <Typography.Title level={4} style={{ margin: 0 }}>
          EasyOps v{version}
        </Typography.Title>
        <ThemeSwitch />
      </Space>
    </div>
  )
}

export default function App(): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    window.api.settings.get().then((s) => setMode(s.theme))
  }, [])

  const handleModeChange = (next: ThemeMode): void => {
    setMode(next)
    void window.api.settings.update({ theme: next })
  }

  return (
    <ThemeProvider mode={mode} onModeChange={handleModeChange}>
      <Shell />
    </ThemeProvider>
  )
}
```

- [ ] **步骤 5:运行测试与类型检查**

```bash
npm test
npm run typecheck
```

预期:全部 PASS,类型无错误。

- [ ] **步骤 6:手动验证主题三态**

```bash
npm run dev
```

预期:点击「浅色 / 深色 / 跟随系统」即时切换;选「跟随系统」后在 macOS「系统设置 → 外观」切换浅色/深色,应用界面**实时跟随**;重启应用后主题保持上次选择。

- [ ] **步骤 7:Commit**

```bash
git add src/renderer/ tests/renderer/
git commit -m "feat: 实现主题三态切换与持久化"
```

---

## 任务 6:侧边栏(分组与脚本管理)

**文件:**
- 创建:`src/renderer/src/store/useAppStore.ts`
- 创建:`src/renderer/src/components/GroupFormModal.tsx`
- 创建:`src/renderer/src/components/ScriptFormModal.tsx`
- 创建:`src/renderer/src/components/Sidebar.tsx`
- 修改:`src/renderer/src/App.tsx`

- [ ] **步骤 1:写 zustand store**

`src/renderer/src/store/useAppStore.ts`:

```ts
import { create } from 'zustand'
import type { Group, Script } from '../../../shared/types'

export type NameFormState =
  | { type: 'none' }
  | { type: 'group-create' }
  | { type: 'group-edit'; group: Group }
  | { type: 'script-create'; groupId: string | null }
  | { type: 'script-edit'; script: Script }

interface AppState {
  scripts: Script[]
  groups: Group[]
  selectedScriptId: string | null
  form: NameFormState
  loading: boolean
  search: string
  reload: () => Promise<void>
  selectScript: (id: string | null) => void
  openForm: (form: NameFormState) => void
  closeForm: () => void
  setSearch: (value: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  scripts: [],
  groups: [],
  selectedScriptId: null,
  form: { type: 'none' },
  loading: false,
  search: '',

  async reload() {
    set({ loading: true })
    const [scripts, groups] = await Promise.all([window.api.scripts.list(), window.api.groups.list()])
    const selected = get().selectedScriptId
    set({
      scripts,
      groups,
      loading: false,
      selectedScriptId: selected && scripts.some((s) => s.id === selected) ? selected : null
    })
  },

  selectScript(id) {
    set({ selectedScriptId: id })
  },

  openForm(form) {
    set({ form })
  },

  closeForm() {
    set({ form: { type: 'none' } })
  },

  setSearch(value) {
    set({ search: value })
  }
}))
```

- [ ] **步骤 2:写分组表单弹窗**

`src/renderer/src/components/GroupFormModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Form, Input, Modal, message } from 'antd'
import { GROUP_NAME_MAX, validateGroupName } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'

export function GroupFormModal(): JSX.Element | null {
  const form = useAppStore((s) => s.form)
  const closeForm = useAppStore((s) => s.closeForm)
  const reload = useAppStore((s) => s.reload)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isCreate = form.type === 'group-create'
  const isEdit = form.type === 'group-edit'
  const open = isCreate || isEdit

  useEffect(() => {
    if (isEdit) setName(form.group.name)
    else if (isCreate) setName('')
  }, [form, isCreate, isEdit])

  if (!open) return null

  const handleOk = async (): Promise<void> => {
    const check = validateGroupName(name)
    if (!check.ok) {
      message.error(check.message)
      return
    }
    setSubmitting(true)
    try {
      if (isCreate) await window.api.groups.create(name)
      else await window.api.groups.update(form.group.id, name)
      await reload()
      closeForm()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isCreate ? '新建分组' : '编辑分组'}
      onOk={handleOk}
      onCancel={closeForm}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form layout="vertical">
        <Form.Item
          label="分组名称"
          required
          help={`最长 ${GROUP_NAME_MAX} 个字符,当前 ${Array.from(name).length} 个`}
          validateStatus={name.length > 0 && !validateGroupName(name).ok ? 'error' : undefined}
        >
          <Input
            value={name}
            autoFocus
            maxLength={GROUP_NAME_MAX * 2}
            placeholder="例如:后端服务"
            onChange={(e) => setName(e.target.value)}
            onPressEnter={handleOk}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
```

- [ ] **步骤 3:写脚本表单弹窗**

`src/renderer/src/components/ScriptFormModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, message } from 'antd'
import { SCRIPT_NAME_MAX, validateScriptContent, validateScriptName } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'

export function ScriptFormModal(): JSX.Element | null {
  const form = useAppStore((s) => s.form)
  const groups = useAppStore((s) => s.groups)
  const closeForm = useAppStore((s) => s.closeForm)
  const reload = useAppStore((s) => s.reload)
  const selectScript = useAppStore((s) => s.selectScript)

  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isCreate = form.type === 'script-create'
  const isEdit = form.type === 'script-edit'
  const open = isCreate || isEdit

  useEffect(() => {
    if (isEdit) {
      setName(form.script.name)
      setContent(form.script.content)
      setGroupId(form.script.groupId)
    } else if (isCreate) {
      setName('')
      setContent('')
      setGroupId(form.groupId)
    }
  }, [form, isCreate, isEdit])

  if (!open) return null

  const nameCheck = validateScriptName(name)
  const contentCheck = validateScriptContent(content)

  const handleOk = async (): Promise<void> => {
    if (!nameCheck.ok) return void message.error(nameCheck.message)
    if (!contentCheck.ok) return void message.error(contentCheck.message)

    setSubmitting(true)
    try {
      if (isCreate) {
        const created = await window.api.scripts.create({ name, content, groupId })
        await reload()
        selectScript(created.id)
      } else {
        await window.api.scripts.update(form.script.id, { name, content, groupId })
        await reload()
      }
      closeForm()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isCreate ? '新建脚本' : '编辑脚本'}
      onOk={handleOk}
      onCancel={closeForm}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      width={720}
      destroyOnClose
    >
      <Form layout="vertical">
        <Form.Item
          label="脚本名称"
          required
          help={`最长 ${SCRIPT_NAME_MAX} 个字符,当前 ${Array.from(name).length} 个`}
          validateStatus={name.length > 0 && !nameCheck.ok ? 'error' : undefined}
        >
          <Input
            value={name}
            autoFocus
            placeholder="例如:启动本地服务"
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>

        <Form.Item label="分组" help="可留空,表示不归入任何分组">
          <Select
            value={groupId}
            allowClear
            placeholder="未分组"
            onChange={(value) => setGroupId(value ?? null)}
            options={groups.map((g) => ({ label: g.name, value: g.id }))}
          />
        </Form.Item>

        <Form.Item
          label="脚本内容"
          required
          validateStatus={content.length > 0 && !contentCheck.ok ? 'error' : undefined}
          help={content.length > 0 && !contentCheck.ok ? contentCheck.message : undefined}
        >
          <Input.TextArea
            value={content}
            rows={8}
            placeholder="echo hello"
            style={{ fontFamily: 'var(--font-mono, monospace)' }}
            onChange={(e) => setContent(e.target.value)}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
```

> 说明:任务 7 会把这里的 `Input.TextArea` 替换为 CodeMirror 编辑器。

- [ ] **步骤 4:写侧边栏**

`src/renderer/src/components/Sidebar.tsx`:

```tsx
import { useEffect, useMemo } from 'react'
import { Button, Empty, Input, Modal, Space, Tag, Tooltip, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, FolderAddOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { Group, Script } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'

function matches(script: Script, keyword: string): boolean {
  if (!keyword) return true
  const k = keyword.toLowerCase()
  return script.name.toLowerCase().includes(k) || script.content.toLowerCase().includes(k)
}

export function Sidebar(): JSX.Element {
  const { scripts, groups, selectedScriptId, search, reload, selectScript, openForm, setSearch } = useAppStore()

  useEffect(() => {
    void reload()
  }, [reload])

  const visible = useMemo(() => scripts.filter((s) => matches(s, search)), [scripts, search])

  const grouped = useMemo(() => {
    const byGroup = new Map<string | null, Script[]>()
    byGroup.set(null, [])
    for (const g of groups) byGroup.set(g.id, [])
    for (const s of visible) {
      const key = s.groupId && byGroup.has(s.groupId) ? s.groupId : null
      byGroup.get(key)!.push(s)
    }
    return byGroup
  }, [visible, groups])

  const handleDeleteScript = (script: Script): void => {
    Modal.confirm({
      title: '删除脚本',
      content: `确定删除「${script.name}」吗?此操作不可撤销。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.api.scripts.remove(script.id)
          await reload()
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err))
        }
      }
    })
  }

  const handleDeleteGroup = (group: Group): void => {
    Modal.confirm({
      title: '删除分组',
      content: `确定删除分组「${group.name}」吗?组内脚本会变为未分组,不会被删除。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.api.groups.remove(group.id)
          await reload()
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err))
        }
      }
    })
  }

  const renderScript = (script: Script): JSX.Element => (
    <div
      key={script.id}
      onClick={() => selectScript(script.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        background: selectedScriptId === script.id ? 'rgba(22,119,255,0.12)' : 'transparent'
      }}
    >
      <Typography.Text
        ellipsis={{ tooltip: script.name }}
        style={{ flex: 1, fontSize: 13, fontWeight: selectedScriptId === script.id ? 500 : 400 }}
      >
        {script.name}
      </Typography.Text>
      <Space size={2}>
        <Tooltip title="编辑">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              openForm({ type: 'script-edit', script })
            }}
          />
        </Tooltip>
        <Tooltip title="删除">
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              handleDeleteScript(script)
            }}
          />
        </Tooltip>
      </Space>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索脚本"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <Space>
        <Button icon={<PlusOutlined />} onClick={() => openForm({ type: 'script-create', groupId: null })}>
          新建脚本
        </Button>
        <Button icon={<FolderAddOutlined />} onClick={() => openForm({ type: 'group-create' })}>
          新建分组
        </Button>
      </Space>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {groups.map((group) => {
          const items = grouped.get(group.id) ?? []
          return (
            <div key={group.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Space size={6}>
                  <Typography.Text strong style={{ fontSize: 12 }}>
                    {group.name}
                  </Typography.Text>
                  <Tag style={{ marginInlineEnd: 0 }}>{items.length}</Tag>
                </Space>
                <Space size={2}>
                  <Tooltip title="在此分组新建脚本">
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => openForm({ type: 'script-create', groupId: group.id })}
                    />
                  </Tooltip>
                  <Tooltip title="编辑分组">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openForm({ type: 'group-edit', group })}
                    />
                  </Tooltip>
                  <Tooltip title="删除分组">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteGroup(group)}
                    />
                  </Tooltip>
                </Space>
              </div>
              <div style={{ marginTop: 4 }}>
                {items.length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: 8 }}>
                    暂无脚本
                  </Typography.Text>
                ) : (
                  items.map(renderScript)
                )}
              </div>
            </div>
          )
        })}

        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong style={{ fontSize: 12 }}>
            未分组
          </Typography.Text>
          <div style={{ marginTop: 4 }}>
            {(grouped.get(null) ?? []).length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: 8 }}>
                暂无脚本
              </Typography.Text>
            ) : (
              (grouped.get(null) ?? []).map(renderScript)
            )}
          </div>
        </div>

        {scripts.length === 0 ? <Empty description="还没有脚本,点击上方「新建脚本」开始" /> : null}
      </div>
    </div>
  )
}
```

- [ ] **步骤 5:接入 App 布局**

`src/renderer/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Segmented, Space, Typography } from 'antd'
import type { ThemeMode } from '../../shared/types'
import { ThemeProvider, useTheme } from './theme/provider'
import { Sidebar } from './components/Sidebar'
import { ScriptFormModal } from './components/ScriptFormModal'
import { GroupFormModal } from './components/GroupFormModal'

function TopBar(): JSX.Element {
  const { mode, setMode } = useTheme()
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.info().then((info) => setVersion(info.version))
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(5,5,5,0.06)'
      }}
    >
      <Typography.Text strong>EasyOps v{version}</Typography.Text>
      <Segmented
        size="small"
        value={mode}
        onChange={(value) => setMode(value as ThemeMode)}
        options={[
          { label: '浅色', value: 'light' },
          { label: '深色', value: 'dark' },
          { label: '跟随系统', value: 'system' }
        ]}
      />
    </div>
  )
}

function Workspace(): JSX.Element {
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <aside style={{ width: 320, borderRight: '1px solid rgba(5,5,5,0.06)', padding: 12, overflow: 'hidden' }}>
        <Sidebar />
      </aside>
      <main style={{ flex: 1, padding: 16 }}>
        <Typography.Text type="secondary">从左侧选择一个脚本查看详情</Typography.Text>
      </main>
    </div>
  )
}

export default function App(): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    window.api.settings.get().then((s) => setMode(s.theme))
  }, [])

  const handleModeChange = (next: ThemeMode): void => {
    setMode(next)
    void window.api.settings.update({ theme: next })
  }

  return (
    <ThemeProvider mode={mode} onModeChange={handleModeChange}>
      <Space direction="vertical" size={0} style={{ height: '100vh', width: '100%' }}>
        <TopBar />
        <Workspace />
      </Space>
      <GroupFormModal />
      <ScriptFormModal />
    </ThemeProvider>
  )
}
```

- [ ] **步骤 6:手动验证脚本与分组管理**

```bash
npm run dev
```

预期逐项确认:
1. 「新建分组」→ 输入「后端」→ 保存后左侧出现该分组,计数为 0。
2. 「新建脚本」→ 名称留空点保存 → 提示「脚本名称不能为空」。
3. 名称填 31 个字符 → 提示超长,且输入框下方计数同步显示。
4. 正常创建后脚本出现在列表中;选择分组下拉可归入「后端」。
5. 点击脚本行可选中(高亮)。
6. 编辑脚本改名后列表即时更新。
7. 删除分组 → 组内脚本变为「未分组」而非被删除。
8. 重启应用后数据仍在。

- [ ] **步骤 7:Commit**

```bash
git add src/renderer/src/
git commit -m "feat: 实现侧边栏与脚本分组管理界面"
```

---

## 任务 7:脚本编辑器(高亮 + 关键字候选)

**文件:**
- 创建:`src/renderer/src/editor/shellKeywords.ts`
- 创建:`src/renderer/src/components/ScriptEditor.tsx`
- 修改:`src/renderer/src/components/ScriptFormModal.tsx`(把 TextArea 换成编辑器)
- 修改:`src/renderer/src/App.tsx`(主区域显示选中脚本)
- 测试:`tests/renderer/shellKeywords.test.ts`

- [ ] **步骤 1:写失败的测试(候选词表)**

`tests/renderer/shellKeywords.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SHELL_KEYWORDS, completionsFor } from '../../src/renderer/src/editor/shellKeywords'

describe('SHELL_KEYWORDS', () => {
  it('包含核心内建命令', () => {
    for (const word of ['cd', 'echo', 'export', 'source', 'alias', 'set']) {
      expect(SHELL_KEYWORDS.some((k) => k.label === word)).toBe(true)
    }
  })

  it('包含常用外部命令', () => {
    for (const word of ['ls', 'grep', 'awk', 'git', 'npm']) {
      expect(SHELL_KEYWORDS.some((k) => k.label === word)).toBe(true)
    }
  })

  it('词表规模控制在精简范围内', () => {
    expect(SHELL_KEYWORDS.length).toBeGreaterThan(20)
    expect(SHELL_KEYWORDS.length).toBeLessThanOrEqual(80)
  })
})

describe('completionsFor', () => {
  it('前缀匹配返回候选', () => {
    const labels = completionsFor('ex').map((c) => c.label)
    expect(labels).toContain('export')
  })

  it('空输入返回空数组', () => {
    expect(completionsFor('')).toEqual([])
  })

  it('无匹配返回空数组', () => {
    expect(completionsFor('zzzzzz')).toEqual([])
  })

  it('结果上限为 20 条', () => {
    expect(completionsFor('e').length).toBeLessThanOrEqual(20)
  })
})
```

- [ ] **步骤 2:运行测试验证失败**

运行:`npx vitest run tests/renderer/shellKeywords.test.ts`
预期:FAIL,报错无法解析模块。

- [ ] **步骤 3:实现候选词表**

`src/renderer/src/editor/shellKeywords.ts`:

```ts
import type { Completion } from '@codemirror/autocomplete'

const BUILTINS: [string, string][] = [
  ['cd', '切换目录'],
  ['echo', '输出文本'],
  ['export', '导出环境变量'],
  ['source', '在当前 shell 执行文件'],
  ['alias', '定义别名'],
  ['unalias', '删除别名'],
  ['set', '设置 shell 选项'],
  ['unset', '删除变量'],
  ['read', '读取输入'],
  ['exit', '退出 shell'],
  ['return', '从函数返回'],
  ['eval', '求值并执行'],
  ['exec', '替换当前进程'],
  ['type', '查看命令类型'],
  ['which', '查找命令路径'],
  ['history', '命令历史']
]

const COMMON: [string, string][] = [
  ['ls', '列出目录内容'],
  ['pwd', '显示当前目录'],
  ['mkdir', '创建目录'],
  ['rm', '删除文件'],
  ['cp', '复制'],
  ['mv', '移动或重命名'],
  ['cat', '查看文件内容'],
  ['less', '分页查看'],
  ['head', '查看开头'],
  ['tail', '查看结尾'],
  ['grep', '文本搜索'],
  ['find', '查找文件'],
  ['sed', '流编辑器'],
  ['awk', '文本处理'],
  ['sort', '排序'],
  ['uniq', '去重'],
  ['wc', '统计行数与字数'],
  ['chmod', '修改权限'],
  ['chown', '修改属主'],
  ['ps', '查看进程'],
  ['kill', '结束进程'],
  ['df', '磁盘占用'],
  ['du', '目录大小'],
  ['tar', '打包与解包'],
  ['curl', 'HTTP 请求'],
  ['ssh', '远程登录'],
  ['rsync', '同步文件'],
  ['docker', '容器管理'],
  ['git', '版本控制'],
  ['npm', 'Node 包管理'],
  ['node', '运行 Node'],
  ['python3', '运行 Python']
]

function toCompletion([label, detail]: [string, string]): Completion {
  return { label, type: 'keyword', detail }
}

export const SHELL_KEYWORDS: Completion[] = [...BUILTINS, ...COMMON].map(toCompletion)

const MAX_RESULTS = 20

export function completionsFor(prefix: string): Completion[] {
  if (!prefix) return []
  const lower = prefix.toLowerCase()
  return SHELL_KEYWORDS.filter((k) => k.label.toLowerCase().startsWith(lower)).slice(0, MAX_RESULTS)
}
```

- [ ] **步骤 4:运行测试验证通过**

运行:`npx vitest run tests/renderer/shellKeywords.test.ts`
预期:PASS。

- [ ] **步骤 5:实现编辑器组件**

`src/renderer/src/components/ScriptEditor.tsx`:

```tsx
import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { autocompletion, closeBrackets, type CompletionContext } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import { useTheme } from '../theme/provider'
import { completionsFor } from '../editor/shellKeywords'

function shellCompletionSource(context: CompletionContext): { from: number; options: ReturnType<typeof completionsFor> } | null {
  const word = context.matchBefore(/[\w.-]*/)
  if (!word || (word.from === word.to && !context.explicit)) return null
  const options = completionsFor(word.text)
  if (options.length === 0) return null
  return { from: word.from, options }
}

export function ScriptEditor({
  value,
  onChange,
  height = '260px',
  readOnly = false
}: {
  value: string
  onChange?: (next: string) => void
  height?: string
  readOnly?: boolean
}): JSX.Element {
  const { resolved } = useTheme()

  const extensions = useMemo(
    () => [
      StreamLanguage.define(shell),
      autocompletion({ override: [shellCompletionSource], activateOnTyping: true }),
      closeBrackets(),
      EditorView.lineWrapping
    ],
    []
  )

  return (
    <div style={{ border: '1px solid rgba(5,5,5,0.15)', borderRadius: 6, overflow: 'hidden' }}>
      <CodeMirror
        value={value}
        height={height}
        theme={resolved}
        readOnly={readOnly}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          highlightActiveLine: true,
          autocompletion: false
        }}
        onChange={(next) => onChange?.(next)}
      />
    </div>
  )
}
```

> 说明:`basicSetup.autocompletion` 必须设为 `false`,否则会与自定义的 `autocompletion` 扩展冲突;关键字候选由 `override: [shellCompletionSource]` 提供。

- [ ] **步骤 6:在脚本表单中替换为编辑器**

修改 `src/renderer/src/components/ScriptFormModal.tsx`:在文件顶部增加导入

```tsx
import { ScriptEditor } from './ScriptEditor'
```

将该文件中「脚本内容」的 `Form.Item` 内层由 `Input.TextArea` 替换为:

```tsx
          <ScriptEditor value={content} onChange={setContent} />
```

并删除该 `Form.Item` 上不再需要的 `Input.TextArea` 相关属性(保留 `label`、`required`、`validateStatus`、`help`)。

- [ ] **步骤 7:在主区域显示选中脚本**

修改 `src/renderer/src/App.tsx` 的 `Workspace` 组件为:

```tsx
function Workspace(): JSX.Element {
  const selectedScriptId = useAppStore((s) => s.selectedScriptId)
  const scripts = useAppStore((s) => s.scripts)
  const openForm = useAppStore((s) => s.openForm)
  const selected = scripts.find((s) => s.id === selectedScriptId) ?? null

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <aside style={{ width: 320, borderRight: '1px solid rgba(5,5,5,0.06)', padding: 12, overflow: 'hidden' }}>
        <Sidebar />
      </aside>
      <main style={{ flex: 1, padding: 16, overflow: 'auto' }}>
        {selected ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {selected.name}
              </Typography.Title>
              <Button size="small" onClick={() => openForm({ type: 'script-edit', script: selected })}>
                编辑
              </Button>
            </Space>
            <ScriptEditor value={selected.content} readOnly height="420px" />
          </Space>
        ) : (
          <Typography.Text type="secondary">从左侧选择一个脚本查看详情</Typography.Text>
        )}
      </main>
    </div>
  )
}
```

并在 `App.tsx` 顶部补充导入:

```tsx
import { Button } from 'antd'
import { ScriptEditor } from './components/ScriptEditor'
import { useAppStore } from './store/useAppStore'
```

- [ ] **步骤 8:运行测试与类型检查**

```bash
npm test
npm run typecheck
```

预期:全部 PASS,类型无错误。

- [ ] **步骤 9:手动验证编辑器**

```bash
npm run dev
```

预期逐项确认:
1. 打开「新建脚本」,内容区域是可编辑的代码编辑器,带行号。
2. 输入 `echo hello` — `echo` 显示 shell 关键字高亮颜色。
3. 输入 `ex` 时弹出候选列表,含 `export`、`exit`,回车可补全。
4. 选中一个脚本后,主区域以只读方式显示其内容且高亮正常。
5. 深浅色主题切换后编辑器底色/文字随之变化。

- [ ] **步骤 10:Commit**

```bash
git add src/renderer/src/ tests/renderer/
git commit -m "feat: 实现 shell 编辑器与关键字候选"
```

---

## 计划 1 完成标志

全部任务完成后,`npm run dev` 应得到一个可用的脚本管理器:能创建/编辑/删除分组与脚本、脚本内容有 shell 高亮与关键字候选、主题三态可切换且持久化、数据落盘可重启保留。此时**还没有终端执行能力**,由计划 2 补齐。

自检记录:本计划已对照规格 §4/§5/§7/§10/§11 逐条覆盖;未覆盖章节为 §6(迁移,计划 3)、§8(终端,计划 2)、§9(Shell 检测,计划 3)、§12(导入导出,计划 3)、§13(更新,计划 3)、§14(CI,计划 3)、§15(构建,计划 2/3 分摊)。
