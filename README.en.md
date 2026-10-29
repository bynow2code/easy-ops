# EasyOps Shell Manager

[简体中文](./README.md) | English

> Keep every scattered shell script in one window — one click to run.

## The problem it solves

The shell scripts you use day to day end up everywhere: inside some project folder, buried in shell history, scribbled in some note. After a while you can't recall where one lives or what arguments it takes, so running it again means piecing the command together from scratch.

EasyOps puts them all in one window, organised in groups and searchable on demand — then runs one with a single click in a real interactive terminal.

## Core Features

- **Script management**: Multi-level groups with drag-and-drop sorting and cross-group moves; search by name; deleting a group cascades to its subgroups and scripts (with a confirmation).
- **Context menus & multi-select**: Right-click any script or group row to duplicate, delete, rename or add a subgroup; Cmd/Ctrl-click or Shift-click to select multiple rows, then batch delete in one go.
- **Real interactive terminal**: Built on node-pty + xterm.js — not an "output panel": scripts can read input and you can type commands right in. Select output and press `Ctrl+Shift+C` (`Cmd+C` on macOS) to copy; `Ctrl+C` stays reserved for interrupting scripts. Cards can be maximized or all closed at once.
- **Per-script shell**: Give each script its own shell (zsh, bash, WSL, Git Bash, …) or follow the global default.
- **Syntax-highlighted editor**: CodeMirror 6 with shell command completion; edit several scripts side by side in tabs, unsaved changes kept automatically.
- **Import / Export**: One-click backup and restore of the whole configuration; migration from v0.7.x supported.
- **Auto-update**: Check for and install new versions inside the app — no manual downloads.
- **Themes & platforms**: Dark / Light / Follow system; macOS (Intel + Apple Silicon), Windows and Linux.

## Download

Get the installer for your platform from the [Releases](https://github.com/bynow2code/easy-ops/releases/latest) page:

| Platform | File |
|----------|------|
| macOS | `.dmg` (pick Intel or Apple Silicon) |
| Windows | `EasyOps-Setup-<version>.exe` |
| Linux | `.AppImage` / `.deb` / `.rpm` |

> The app is **not code-signed** — allow it once on first launch:
> - **macOS**: in System Settings → Privacy & Security, click **"Open Anyway"** (right-click → Open no longer works on macOS 15); or run `xattr -dr com.apple.quarantine /Applications/EasyOps.app`. Once allowed, auto-updates won't be blocked again.
> - **Windows**: on the SmartScreen prompt, click "More info → Run anyway".

## Quick Start

1. **Create a script**: Click the ＋ at the top of the sidebar to create a group; hover the group row and click the ＋ at its end to add a script — a name is all it takes, write the content later.
2. **Write the content**: Select the script and edit it in the detail pane at the bottom left; press `Cmd/Ctrl+S` to save.
3. **Run it**: Hover the script row and click the ▶ at its end — a terminal card opens on the right with live output; the terminal stays open for more commands — press `Ctrl+C` to interrupt the script.

## FAQ

**I hit Run, but the terminal stays quiet for a while?**
An interactive shell loads your `~/.zshrc` / `~/.bashrc` on startup; with heavy things like nvm or oh-my-zsh, a cold start can take up to ~7 seconds — just give it a moment.

**Will I lose my edits if I switch away without saving?**
No. Unsaved changes are kept per script (marked with an orange dot on the tab); closing a tab with unsaved changes first asks you to save, discard or cancel, and quitting the app reminds you too.

**Where is my data? How do I back it up?**
Copy the whole data folder and you have a backup:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/easyops/` |
| Windows | `%APPDATA%\easyops\` |
| Linux | `~/.config/easyops/` |

## Development

Developer docs (architecture, testing, packaging & release) — currently available in Chinese — are in [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## License

[PolyForm Noncommercial License 1.0.0](./LICENSE) (noncommercial use only)
