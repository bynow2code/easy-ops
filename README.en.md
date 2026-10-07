# EasyOps Script Manager

[简体中文](./README.md) | English

> A little desktop tool that helps you **keep your shell scripts in one place and run them in one click**.

## The problem it solves

Day-to-day development and ops leave you with piles of scattered scripts and long commands: SSH remote execution, running ops scripts remotely, triaging logs, clearing caches, ad-hoc commands… tucked into all kinds of folders and buried in shell history until you can no longer remember where they are or what arguments they take.

EasyOps gathers them into one window: organize them in groups, search on a whim, and run one with a click in a **real interactive terminal** — output streams live and you can type right into it. Each script's content and shell are remembered for next time.

## Typical Use Cases

- **SSH remote execution**: Turn "go do this on the server" into a script and run it in one click (`ssh deploy@prod "cd /app && git pull && pm2 restart all"`)
- **Run scripts over SSH**: Keep an ops script locally and send it to a remote host in one click (`ssh ops@db-1 'bash -s' < backup.sh`)
- **Multi-host batch operations**: Restart services across machines with one loop (`for h in web-1 web-2; do ssh $h "systemctl restart app"; done`)
- **Log triage**: Watch and filter logs on a server without retyping the login command (`ssh prod "tail -f /var/log/app/error.log"`)
- **Everyday local tasks**: Clear caches, run commands and other small tasks — one click each

## Core Features

- **Script management**: Multi-level groups with drag-and-drop sorting and cross-group moves; search by name; deleting a group cascades to its subgroups and scripts (with a confirmation).
- **Context menus & multi-select**: Right-click any script or group row to duplicate, delete, rename or add a subgroup; Cmd/Ctrl-click or Shift-click to select multiple rows, then batch delete in one go.
- **Real interactive terminal**: Built on node-pty + xterm.js — not an "output panel": scripts can read input and you can type commands right in; cards can be maximized or all closed at once.
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
