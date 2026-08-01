# EasyOps Project

## Project Structure

- electron ^v43.2.0
- node-pty ^v1.1.0
- xterm.js ^v6.0.0
- xterm/addon-fit ^v0.11.0
- PTY Host
- IPC
- vite ^v8.2.0
- react ^v19.2.8
- electron-builder ^v26.15.3
- monaco-editor ^v0.56.0（devDependency；以 ESM 方式打包进 bundle，仅引入编辑器内核 + shell 语言：monaco-editor/editor/editor.api + monaco-editor/languages/definitions/shell/register；worker 用合规裸路径 monaco-editor/editor/editor.worker?worker 引入）

## Code Standards

- 用面向接口（依赖注入）做架构骨架
- 用函数式（纯函数）做业务血肉
- 辅以状态机做生命周期兜底
- 使用最佳工程最佳实践
- 代码注释要简明概要
- 软件的界面、按钮、提示都要用英文表示
