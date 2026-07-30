<p align="center">
  <a href="README.md">简体中文</a> · <a href="README_EN.md">English</a>
</p>

# EasyOps Script Manager

> A lightweight desktop tool that helps you **centrally manage and run Shell scripts on demand**. Gather all your scattered ops/dev scripts into one window — categorize, edit, run with one click, and watch the logs stream in real time, without ever opening a terminal to type commands.

---

## What It Is & What Problem It Solves

In day-to-day development we always end up with a pile of scattered scripts: starting the backend, launching the frontend, database backups, cache cleanup, deploy & release, routine health checks… They live in different folders, and over time you **forget where they are, what arguments they take, and copy-pasting them is error-prone**.

EasyOps brings all those scripts under one roof:

- **No more folder hunting**: All scripts live in one window, organized by group.
- **No terminal required**: One click runs them, and the output streams in real time — just like watching a terminal.
- **Never forget again**: Script content and parameters are saved inside the app, ready to reuse.
- **Batch made easy**: Select several scripts and run them concurrently with one click — perfect for "spin up the whole environment" scenarios.

In short, it's a **launcher + manager for your scripts**, turning repetitive command operations into point-and-click tasks.

---

## Core Features

| Feature | Description |
|---------|-------------|
| 📁 **Script Management** | Create, edit, and delete Shell scripts; content is saved as you go |
| 🗂️ **Group Management** | Supports groups like Backend / Frontend; drag to switch a script's group |
| 🖥️ **Per-script Shell** | Each script can pick its own Shell interpreter from the global shell list when editing; if left unset it follows the global config. A small **yellow dot** at the top-right corner of a script's name (like a notification badge, but yellow) means it overrides the global shell. |
| ↕️ **Drag & Drop Sorting** | Reorder scripts by dragging; cross-group dragging is supported |
| ⚡ **Real-time Streaming Execution** | Built on SSE, script output scrolls in real time just like a terminal |
| 🔁 **Batch Execution** | Select multiple scripts and run them with one click; scripts run concurrently |
| 🎨 **Syntax-highlighting Editor** | Built-in CodeMirror 6 gives you highlighted, cleaner Shell editing |
| 💻 **Cross-platform** | Auto-detects Bash / Git Bash / WSL; runs on Windows, macOS, and Linux |
| 🔔 **System Notifications** | A native OS notification pops up when a script finishes — no need to watch the window |
| 🧹 **One-click Close** | The Execution Outputs panel offers a one-click "close all outputs" |
| ℹ️ **System Info** | App Info shows the current Shell type, path, version, and more |
| 🔄 **Auto Update** | Checks for new versions on launch; changelog is presented GitHub-Release style |
| 📤 **Import / Export Config** | Export your script list as JSON for backup/migration; import JSON to fully restore, with bad formats auto-rejected |
| 🗑️ **Batch Delete** | Check scripts and batch-delete with one click; a confirmation dialog prevents accidents |
| 🌗 **Theme Switch** | Toolbar (left of App Info) cycles Follow System / Light / Dark with one click; defaults to Follow System and remembers your choice |

---

## How to Use

### 1. Install

- **Windows**: Download the installer (`.exe`, NSIS) and double-click to install; or grab the ZIP portable build and extract to run.
- **macOS**: Download the `.dmg` installer (both Intel and Apple Silicon builds provided).
- **Linux**: (package provided per build configuration)

> After installation, the app icon appears in the Start Menu / Applications / taskbar.

### 2. Create & Write a Script

1. Click **New Script** (or a similar entry).
2. Give the script a name, e.g. "Start Backend Service".
3. Choose a group (Backend / Frontend). To run this script with a specific Shell interpreter instead of the global one, pick it from the **Shell Interpreter** dropdown; leaving it empty follows the global shell config.
4. Write your Shell commands in the editor, for example:

   ```bash
   cd /path/to/project
   npm run dev
   ```

5. Save. The script now shows up in the left-side list.

### 3. Run a Script

- Click **Run** (▶) on a script. The **Execution Outputs** panel below shows the execution log in real time — same experience as a terminal.
- When the script finishes, a system notification reminds you.

### 4. Batch Execution

- Check multiple scripts and click **Batch Execute**; they run concurrently, each with its own output panel.

### 5. Import / Export Script Config

On the right side of the toolbar, to the left of the "Check for Updates" (↻) button, there are two icon buttons:

- **Export (↓)**: Export the entire current script list to a `.json` file with an identifying header, for backup and cross-device migration.
- **Import (↑)**: Pick a local `.json` file to **fully overwrite** the current config. The file must conform to the format:
  - The root can be a script array `[ { name, content, ... } ]`, or a wrapper object `{ "scripts": [ ... ] }`;
  - Each script must contain a valid `name` (non-empty string) and `content` (string); `group` is limited to `backend` / `frontend`, and `orderNum` must be a number.
  - Each script may include an optional `shellId` (string): the id of a specific Shell interpreter; empty or omitted means follow the global config.
  - Malformed files are **rejected outright** with a specific reason — nothing gets written. A confirmation dialog appears before import to avoid accidental overwrites.

### 6. Batch Delete

- Check the boxes before multiple scripts on the left, then click the toolbar's **Delete Selected (N)** button to batch-delete; a confirmation dialog guards against accidental deletion.
- Scripts currently running cannot be batch-deleted (the button auto-disables).

### 7. Reorder & Regroup

- Simply **drag** a script entry to reorder it, or drag it into another group.

### 8. View Info & Updates

- Open **App Info** from the menu to see: app version, **Server Port** (with a Copy button), current Shell type / version / executable path (also one-click copy), and more.
- Use the menu's **Check for Updates** to manually trigger a version check and view the changelog.

### 9. Output Panel Controls

Every **Execution Outputs** window has independent controls:

- **Maximize**: Click the top-right icon to enlarge that output to a full-screen view, handy for long logs.
- **Force Stop**: While a script runs, a Stop button appears; clicking it terminates the current execution immediately — it kills that script precisely by backend `runId`, never affecting other scripts running in the same batch.
- **Re-run**: After a script finishes (not running), the same button becomes Re-run — click to run it again with the same config.
- **Auto-scroll**: Each panel can independently enable/disable "stick to bottom". When off, scrolling through history won't be pushed down by new output.
- **Close all**: A "Close all" entry at the top of the panel clears every output window at once.

---

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| Windows 10/11 | ✅ | NSIS installer + ZIP portable build |
| macOS (Intel) | ✅ | `.dmg` |
| macOS (Apple Silicon) | ✅ | `.dmg` |
| Linux | 🔧 | Provided per build configuration |

On Windows the app automatically recognizes **Git Bash / WSL** as the execution environment — no manual configuration needed.

---

## FAQ

**Q: Will a terminal window pop up when a script runs?**
No. On Windows the app runs the Shell with a hidden window; the execution only shows in the in-app output panel — no black box or Windows Terminal will appear.

**Q: Which Shell runs my scripts?**
The app auto-detects the current environment: Windows uses Git Bash / WSL (bash-syntax scripts), macOS / Linux use bash. You can view the actual Shell in use via App Info. If no usable Shell is available on the machine (including manually enabling "No Shell Mode" in App Info), the main UI shows a prominent warning: on Windows it prompts installing WSL / Git Bash, on macOS it prompts installing Xcode Command Line Tools (`xcode-select --install`), on Linux it prompts installing bash; scripts cannot run in this state.

**Q: Can I customize / switch the bash path used to run scripts?**
Yes. Open **App Info** → **Shells** section:
- **Switch Shell**: The list shows auto-detected available Shells (e.g. Git Bash, WSL, system bash). Click **Use** on an item to make it the Shell that runs your scripts (the active one shows **Active**).
- **Add a custom path**: Some bash installs live in unusual paths the auto-detector can't find. Type the path in the input below (e.g. `C:\tools\git\bin\bash.exe` or `/opt/homebrew/bin/bash`), or click **Browse…** to pick an executable from the system, then click **Add**. The path is validated as a working bash before it's added.
- **Remove custom items**: Paths you added (marked custom) can be removed via **Remove**; auto-detected ones cannot.

**Q: Where is my data stored?**
Script config is saved under the app data directory; the exact path is viewable in **App Info**:
- **Scripts Config**: Full path of the script list (`scripts.json`), with a Copy button.
- **Shell Config**: Full path of the Shell detection config file (also one-click copy).

Before uninstalling, back up the file at the **Scripts Config** path shown in App Info as needed.

**Q: Using a script to SSH into a remote server — first run hangs or reports a host key error?**
The first time you SSH into a new host, SSH interactively asks "trust this host and add its fingerprint to known_hosts (yes/no)". The script execution inside the app is **non-interactive** and can't answer that question, so it hangs or fails.
Please **first connect to that host manually once from your system terminal** (macOS/Linux Terminal, Windows Git Bash / WSL), e.g.:

```bash
ssh user@your-server-ip
```

Type `yes` as prompted to add the host fingerprint to `~/.ssh/known_hosts`, then return to this tool and the SSH script will connect normally without interactive confirmation.
(Similarly, if the server was reinstalled and the fingerprint changed, first run `ssh-keygen -R your-server-ip` to clear the old record, then connect manually once to re-trust.)

---

## License

This project is licensed under the [MIT License](LICENSE).
