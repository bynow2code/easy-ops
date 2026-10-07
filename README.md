# EasyOps 脚本管家

简体中文 | [English](./README.en.md)

> 一个帮你**集中管理、随手执行 Shell 脚本**的桌面小工具。

## 它解决什么问题

日常开发与运维离不开一堆零散脚本和长命令：SSH 远程执行、远程跑运维脚本、日志排查、清理缓存、执行命令……散落在各个文件夹和终端历史里，时间一长就记不住放哪、想不起参数。

EasyOps 把它们收进一个窗口：按分组管理、随手搜索，点一下就在**真正的交互式终端**里跑起来，输出实时滚动，还能直接输入。脚本内容和用哪个 shell 都会记住，下次直接用。

## 典型场景

- **SSH 远程执行**：把连服务器要做的事写成脚本，点一下就跑（`ssh deploy@prod "cd /app && git pull && pm2 restart all"`）
- **远程跑运维脚本**：本地维护一段脚本，一键送到服务器上执行（`ssh ops@db-1 'bash -s' < backup.sh`）
- **多机批量操作**：一个循环搞定多台机器（`for h in web-1 web-2; do ssh $h "systemctl restart app"; done`）
- **日志排查**：登上去实时看日志、过滤报错（`ssh prod "tail -f /var/log/app/error.log"`）
- **本地日常**：清理缓存、执行命令等零散操作，随手一点

## 核心功能

- **脚本管理**：多级分组嵌套整理，拖拽排序、跨分组移动，按名称搜索；删除分组会级联删除其下子分组与脚本（有二次确认）
- **右键菜单与多选**：脚本行与分组行均可右键调出菜单（复制 / 删除 / 重命名 / 新建子分组）；Cmd/Ctrl 与 Shift 多选，一键批量删除
- **真实交互终端**：基于 node-pty + xterm.js，不是「输出面板」——脚本能读输入，你也能直接敲命令；终端卡片可最大化、一键关闭全部
- **脚本级 shell**：每个脚本可单独指定 zsh、bash、WSL、Git Bash 等，不指定则跟随全局默认
- **语法高亮编辑器**：CodeMirror 6，带 shell 命令补全；多脚本以页签并行编辑，未保存改动自动留存
- **导入 / 导出**：整份配置一键备份恢复，支持从旧版 v0.7.x 迁移
- **自动更新**：应用内检查并安装新版本，无需手动下载
- **主题与平台**：深色 / 浅色 / 跟随系统三种主题；macOS（Intel + Apple Silicon）、Windows、Linux

## 下载

到 [Releases](https://github.com/bynow2code/easy-ops/releases/latest) 页面下载对应平台的安装包：

| 平台 | 文件 |
|------|------|
| macOS | `.dmg`（按 CPU 选择 Intel 或 Apple Silicon） |
| Windows | `EasyOps-Setup-<version>.exe` |
| Linux | `.AppImage` / `.deb` / `.rpm` |

> **应用未做代码签名**，首次打开需要手动放行：
> - **macOS**：到「系统设置 → 隐私与安全性」点「仍要打开」（macOS 15 起右键「打开」已不再能放行）；或执行 `xattr -dr com.apple.quarantine /Applications/EasyOps.app`。放行一次后，后续自动更新不会再被拦截
> - **Windows**：SmartScreen 提示中点「更多信息 → 仍要运行」

## 快速上手

1. **新建脚本**：点侧边栏顶部的 ＋ 新建分组；鼠标移到分组行上，点行尾的 ＋ 在该分组下新建脚本——名字先填，内容之后再写
2. **写内容**：选中脚本，在左侧下方的详情区直接编辑，按 `Cmd/Ctrl+S` 保存
3. **跑脚本**：鼠标移到脚本行上，点行尾的 ▶——右侧新增终端卡片并实时输出；跑完仍可继续敲命令，按 `Ctrl+C` 可中断脚本

## 常见问题

**点了执行，终端迟迟没输出？**
交互式 shell 启动时要加载你的 `~/.zshrc` / `~/.bashrc`；rc 里有 nvm、oh-my-zsh 之类的重物时，冷启动最慢约 7 秒，等一下就好。

**没点保存就切走了，内容会丢吗？**
不会。未保存改动按脚本自动留存（页签上有橙点标记）；关闭带未保存改动的页签会先确认「保存更改 / 不保存 / 取消」，退出应用前也会提醒。

**数据存在哪？想备份怎么办？**
拷走整个数据目录即备份：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/easyops/` |
| Windows | `%APPDATA%\easyops\` |
| Linux | `~/.config/easyops/` |

## 开发

面向开发者的文档（架构、测试、打包发布等）见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 许可证

[PolyForm Noncommercial License 1.0.0](./LICENSE)（仅限非商业用途）
