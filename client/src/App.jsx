import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import ScriptList from './components/ScriptList.jsx';
import ExecutionPanel from './components/ExecutionPanel.jsx';
import AddGroupModal from './components/AddGroupModal.jsx';
import AddScriptPanel from './components/AddScriptPanel.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { useTheme } from './hooks/useTheme.js';
import { readFrontendShells, readFrontendNoShellMode } from './shellStore.js';
import { resolveShellPath } from './shellUtils.js';
import { ptyClient } from './ptyClient.js';
import { shellApi } from './shellApi.js';
import { scriptsApi } from './scriptsApi.js';
import {
  readFrontendScripts,
  writeFrontendScripts,
  removeGroupFromRepo,
  renameGroupInRepo,
  importIntoRepo,
} from './scriptsStore.js';
import { DEFAULT_GROUP } from './constants.js';
import { readSplit, writeSplit } from './uiStore.js';
import DeleteGroupModal from './components/DeleteGroupModal.jsx';
import RenameGroupModal from './components/RenameGroupModal.jsx';

/**
 * 应用根组件：管理三个顶层状态
 *  - scripts:     脚本列表（初始为空，由用户在 UI 中添加；挂载时从后端 /api/scripts 拉取，失败回退 localStorage）
 *  - selectedSet: 已勾选脚本 id 集合
 *  - executions:  当前运行/已完成的输出卡
 *
 * 纯函数式业务：派生 selectedCount / 分组结果等。脚本与分组的持久化统一走后端
 * scriptsApi（scripts.json 唯一写方），后端不可达时退化到 localStorage。
 */
// No Shell Mode 下执行 / 重跑脚本时，给卡片的统一失败提示（复用同一条文案）
const NO_SHELL_MESSAGE =
  'No shell available — No Shell Mode is on. Turn it off in Settings to run scripts.';

export default function App() {
  const [scripts, setScripts] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [executions, setExecutions] = useState([]);
  // 分组列表（初始为空；挂载时由后端 /api/scripts 拉取，新增/移除经 /api/groups 持久化）
  const [groups, setGroups] = useState([]);
  // 系统内置默认分组名（脚本无分组时归入此处；不可删除，可重命名）
  const [defaultGroup, setDefaultGroup] = useState(DEFAULT_GROUP);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  // 删除 / 重命名分组的模态框状态
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(null);
  const [renameGroupOpen, setRenameGroupOpen] = useState(false);
  const [renamingGroup, setRenamingGroup] = useState(null);
  const [addScriptOpen, setAddScriptOpen] = useState(false);
  const [editingScript, setEditingScript] = useState(null); // null = 新增模式
  const [settingsOpen, setSettingsOpen] = useState(false); // 设置（Settings）面板

  // Shell 列表（检测到的 + 自定义的）与全局 shell 路径，供"添加/编辑脚本"选择解释器，
  // 以及执行时把 'global' 解析成实际路径。未挂载 Electron 时保持为空/默认，UI 优雅退化。
  const [shells, setShells] = useState([]);
  const [globalShellPath, setGlobalShellPath] = useState(null);
  // No Shell Mode：模拟"无可用解释器"。开启时执行/重跑脚本直接给出明确失败，
  // 而非用 null 路径假装运行（mock 模式下甚至会照常跑出模拟输出 → 模式"未生效"）。
  const [noShellMode, setNoShellMode] = useState(false);

  // 从「仓库形态」回填三个顶层状态（后端 res 与前端 fallback 同形）。
  // 按字段是否存在决定回填，避免后端只回部分字段时把其余状态清零。
  const applyRepo = useCallback((repo) => {
    if (!repo) return;
    if (Array.isArray(repo.scripts)) setScripts(repo.scripts);
    if (Array.isArray(repo.groups)) setGroups(repo.groups);
    if (repo.defaultGroup) setDefaultGroup(repo.defaultGroup);
  }, []);

  // 拉取 shell 列表（检测到的 + 自定义的）与全局 shell 路径；供"添加/编辑脚本"的
  // 解释器下拉、以及执行时把 'global' 解析成实际路径。未挂载 Electron 时为无操作。
  // 抽成独立函数：挂载时调一次，Settings 关闭时也调一次，确保设置里新增/移除的
  // 自定义 shell 能实时反映到 Add/Edit Script 的下拉（否则会停留在挂载时的快照）。
  const reloadShells = useCallback(() => {
    // 通过 HTTP 从后端拉取（检测到的 + 自定义的）shell 与全局路径；
    // 后端不可达时退化到前端态 localStorage，保证 UI 不崩。
    shellApi
      .list()
      .then((shellState) => {
        setShells(Array.isArray(shellState.shells) ? shellState.shells : []);
        setGlobalShellPath(shellState.activeShellPath || shellState.shells?.[0]?.path || null);
        setNoShellMode(Boolean(shellState.noShellMode));
      })
      .catch(() => {
        const localShells = readFrontendShells();
        setShells(localShells);
        setGlobalShellPath(localShells[0]?.path || null);
        setNoShellMode(readFrontendNoShellMode());
      });
  }, []);

  // 拉取已保存的脚本与分组：优先走后端 /api/scripts；后端不可达时退化到
  // localStorage（scriptsStore），保证无主进程 / 离线时 UI 也能恢复上次数据。
  const loadScripts = useCallback(() => {
    scriptsApi
      .list()
      .then(applyRepo)
      .catch(() => applyRepo(readFrontendScripts()));
  }, [applyRepo]);

  useEffect(() => {
    reloadShells();
    loadScripts();
  }, [reloadShells, loadScripts]);

  // 后端调用成功则 apply(repo)；失败则在前端 localStorage 复刻同一变换（transform
  // 接收当前前端仓库、返回新仓库，与 server 纯函数同源语义），回写后再 apply。
  const persistWithFallback = (apiCall, transform, apply) => {
    apiCall
      .then((repo) => apply(repo))
      .catch(() => {
        const localRepo = readFrontendScripts();
        const next = transform(localRepo) || localRepo;
        writeFrontendScripts(next);
        apply(next);
      });
  };

  // 仅把变更写入前端 localStorage（用于「内存已乐观更新、只差落盘」的脚本级操作）。
  const persistLocal = (mutate) => {
    const fe = readFrontendScripts();
    mutate(fe);
    writeFrontendScripts(fe);
  };

  // 把 'global' / 脚本指定解释器解析成实际路径，统一 runScript / handleRerun 的解析逻辑
  const resolveScriptShell = (script) => {
    const shellChoice = script.shell || 'global';
    return { shellChoice, shellPath: resolveShellPath(shellChoice, globalShellPath) };
  };

  // 开真实 PTY 会话并把 sessionId 同步回对应执行卡；创建失败则降级为 mock 错误卡
  // （ExecutionCard 检测 bootError 显示并翻 exited，避免 xterm 黑屏吞错）。
  const startPtySession = (execId, script, shellPath) => {
    ptyClient
      .open({ execId, scriptId: script.id, content: script.content || '', shell: shellPath })
      .then((res) => {
        setExecutions((prev) =>
          prev.map((e) => (e.id === execId ? { ...e, sessionId: res?.sessionId || null } : e)),
        );
      })
      .catch((err) => {
        const msg = String((err && err.message) || err);
        setExecutions((prev) =>
          prev.map((e) =>
            e.id === execId
              ? { ...e, mode: 'mock', sessionId: `mock-${execId}`, bootError: msg }
              : e,
          ),
        );
      });
  };

  // 若是 pty 模式就按 execId 杀会话，避免孤儿进程（mock 卡由各自卡片卸载时停定时器）。
  // 主进程在 openSession 里同步注册了 execId→sessionId，渲染层本地的 sessionId 在 IPC
  // 返回前可能是 null（开会话中），不能据此跳过；killByExec 找不到则说明已结束，是无害 no-op。
  const killPty = (execId, mode) => {
    if (mode === 'pty') ptyClient.kill(execId);
  };

  // 主题：三态循环（system → dark → light → system），通过 <html data-theme> 切换
  const { theme, cycleTheme } = useTheme();

  // 左右分栏比例（脚本列表宽度占比 %），支持拖动中线调节；持久化到 localStorage，
  // 重开程序后恢复上次位置（读不到则回退默认 50%，即正中）。
  const [split, setSplit] = useState(() => readSplit() ?? 50);
  const [dragging, setDragging] = useState(false);
  const mainRef = useRef(null);

  const startDrag = (e) => {
    e.preventDefault();
    setDragging(true);
    let lastPct = split; // 拖拽起点值，避免首帧跳变
    const move = (ev) => {
      const rect = mainRef.current?.getBoundingClientRect();
      if (!rect) return;
      let pct = ((ev.clientX - rect.left) / rect.width) * 100;
      pct = Math.min(80, Math.max(20, pct)); // 限制 20%~80%，避免某一栏被压没
      lastPct = pct;
      setSplit(pct);
    };
    const up = () => {
      setDragging(false);
      writeSplit(lastPct); // 拖完落盘，下次打开保持
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const selectedCount = selected.size;

  // 工具：操作 selected 集合（不可变）
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectGroup = (group, items, wantAll) =>
    setSelected((prev) => {
      const next = new Set(prev);
      items.forEach((i) => (wantAll ? next.add(i.id) : next.delete(i.id)));
      return next;
    });

  // 按 id 局部更新某条脚本（不可变）
  const patchScript = (id, patch) =>
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  // 执行入口（单脚本/批量）
  //  - Electron 内：开真实 PTY 会话，脚本内容直接喂给解释器（无临时文件），
  //    输出经 IPC 流式回到 ExecutionCard 的 xterm。
  //  - 非 Electron（浏览器 dev / 单测）：回退到 mock 流式输出，保证 UI 可用。
  const runScript = (script) => {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // No Shell Mode：模拟"无可用解释器"，直接给出明确失败卡，
    // 而非用 null 路径去开 PTY（Electron 下报含糊错误 / mock 下照常跑出模拟输出）。
    if (noShellMode) {
      setExecutions((prev) => [
        {
          id,
          scriptId: script.id,
          group: script.group,
          name: script.name,
          shell: script.shell || 'global',
          shellPath: null,
          sessionId: `mock-${id}`,
          maximized: false,
          mode: 'mock',
          bootError: NO_SHELL_MESSAGE,
        },
        ...prev,
      ]);
      return;
    }

    // 'global' 解析为当前应用全局 shell 路径；否则用脚本指定的解释器路径
    const { shellChoice, shellPath } = resolveScriptShell(script);

    if (ptyClient.available) {
      setExecutions((prev) => [
        {
          id,
          scriptId: script.id,
          group: script.group,
          name: script.name,
          shell: shellChoice,
          shellPath,
          sessionId: null,
          maximized: false,
          mode: 'pty',
        },
        ...prev,
      ]);
      startPtySession(id, script, shellPath);
      return;
    }

    // 回退：mock 模式。状态与模拟输出流均由 ExecutionCard 自己维护
    // （它订阅 ptyClient.onExit 翻 exited，并自跑 mock 流）；App 只创建静态卡片，
    // 并给定运行实例 id（sessionId）供卡片区分"初次挂载 vs 重跑"。
    const exec = {
      id,
      scriptId: script.id,
      group: script.group,
      name: script.name,
      shell: shellChoice,
      shellPath,
      sessionId: `mock-${id}`,
      maximized: false,
      mode: 'mock',
    };
    setExecutions((prev) => [exec, ...prev]);
  };

  const handleExecuteSelected = () => {
    const ids = selected;
    scripts.filter((s) => ids.has(s.id)).forEach(runScript);
    setSelected(new Set());
  };

  const handleDeleteSelected = () => {
    const ids = selected;
    if (ids.size === 0) return;
    const n = ids.size;
    // 二次确认（与单删 handleRemove 同风格，用原生 confirm）；批量提示数量
    if (!window.confirm(`Delete ${n} selected script${n > 1 ? 's' : ''}?`)) return;
    // 乐观更新内存
    setScripts((prev) => prev.filter((s) => !ids.has(s.id)));
    setSelected(new Set());
    // 持久化：逐条 DELETE /api/scripts/:id；后端不可达时回退 localStorage（与单删一致）
    ids.forEach((id) => {
      scriptsApi.remove(id).catch(() =>
        persistLocal((fe) => {
          fe.scripts = fe.scripts.filter((s) => s.id !== id);
        }),
      );
    });
  };

  const handleAddScript = () => {
    setEditingScript(null);
    setAddScriptOpen(true);
  };

  // 关闭编辑器面板：同时清掉编辑态，确保下次打开是干净的新增模式
  const handleCloseScriptPanel = () => {
    setAddScriptOpen(false);
    setEditingScript(null);
  };

  const handleSaveScript = ({ id, name, group, content, shell }) => {
    // 规整后的数据记录（仅持久化字段，不含运行期 status）
    const finalId = id || `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      id: finalId,
      name,
      group,
      content: content || '',
      shell: shell || 'global',
    };
    const isEdit = Boolean(id);

    // 乐观更新内存：新增追加 / 编辑原地替换
    if (isEdit) {
      patchScript(finalId, record);
    } else {
      setScripts((prev) => [...prev, record]);
    }

    // 持久化：优先后端 /api/scripts；失败回退 localStorage
    scriptsApi.save(record).catch(() =>
      persistLocal((fe) => {
        const exists = fe.scripts.some((s) => s.id === finalId);
        fe.scripts = exists
          ? fe.scripts.map((s) => (s.id === finalId ? record : s))
          : [...fe.scripts, record];
      }),
    );

    setAddScriptOpen(false);
    setEditingScript(null);
  };

  const handleAddGroup = () => setAddGroupOpen(true);
  const handleOpenSettings = () => setSettingsOpen(true);
  const handleCloseSettings = () => {
    setSettingsOpen(false);
    // 把设置里新增/移除的自定义 shell 同步到 Add/Edit Script 的下拉
    reloadShells();
  };

  // 拖拽排序 / 换组：把 dragId 的脚本移动到 targetGroup，
  //  beforeId 为 null → 追加到该组末尾；否则插入到 beforeId 之前。
  const handleMoveScript = (dragId, targetGroup, beforeId) => {
    let movedRecord = null;
    setScripts((prev) => {
      const dragged = prev.find((s) => s.id === dragId);
      if (!dragged) return prev;
      if (beforeId === dragId) return prev;
      const without = prev.filter((s) => s.id !== dragId);
      const moved = { ...dragged, group: targetGroup };
      movedRecord = {
        id: moved.id,
        name: moved.name,
        group: moved.group,
        content: moved.content || '',
        shell: moved.shell || 'global',
      };
      if (beforeId == null) {
        // 追加到目标组最后一条之后（目标组为空则放到数组末尾）
        let insertAt = without.length;
        for (let i = without.length - 1; i >= 0; i--) {
          if (without[i].group === targetGroup) {
            insertAt = i + 1;
            break;
          }
        }
        without.splice(insertAt, 0, moved);
      } else {
        const idx = without.findIndex((s) => s.id === beforeId);
        without.splice(idx === -1 ? without.length : idx, 0, moved);
      }
      return without;
    });
    // 持久化换组结果（移动只改 group）：优先后端，失败回退 localStorage
    if (movedRecord) {
      scriptsApi.save(movedRecord).catch(() =>
        persistLocal((fe) => {
          fe.scripts = fe.scripts.map((s) => (s.id === movedRecord.id ? movedRecord : s));
        }),
      );
    }
  };

  const handleSaveGroup = (name) => {
    // 乐观更新内存
    setGroups((prev) => (prev.includes(name) ? prev : [...prev, name]));
    // 持久化：优先后端 /api/groups；失败回退 localStorage
    scriptsApi
      .addGroup(name)
      .then((res) => {
        if (res && Array.isArray(res.groups)) setGroups(res.groups);
      })
      .catch(() =>
        persistLocal((fe) => {
          if (!fe.groups.includes(name)) fe.groups.push(name);
        }),
      );
    setAddGroupOpen(false);
  };

  // 删除分组：默认分组不可删；打开确认框（含「一并删除脚本」勾选，默认不勾选）。
  const handleDeleteGroup = (name) => {
    if (name === defaultGroup) return;
    setDeletingGroup(name);
    setDeleteGroupOpen(true);
  };

  const handleConfirmDeleteGroup = (deleteScripts) => {
    const name = deletingGroup;
    setDeleteGroupOpen(false);
    setDeletingGroup(null);
    if (!name) return;
    // 优先后端；失败回退 localStorage（本地复刻后端变换）
    persistWithFallback(
      scriptsApi.removeGroup(name, deleteScripts),
      (fe) => removeGroupFromRepo(fe, name, deleteScripts),
      applyRepo,
    );
  };

  // 重命名分组（默认分组与普通分组都允许；默认分组重命名会同步更新 defaultGroup）。
  const handleRenameGroup = (name) => {
    setRenamingGroup(name);
    setRenameGroupOpen(true);
  };

  const handleConfirmRenameGroup = (newName) => {
    const oldName = renamingGroup;
    setRenameGroupOpen(false);
    setRenamingGroup(null);
    if (!oldName || !newName || newName === oldName) return;
    // 重命名只动 groups + defaultGroup（不影响 scripts 列表）
    persistWithFallback(
      scriptsApi.renameGroup(oldName, newName),
      (fe) => renameGroupInRepo(fe, oldName, newName),
      (repo) => {
        if (Array.isArray(repo.groups)) setGroups(repo.groups);
        if (repo.defaultGroup) setDefaultGroup(repo.defaultGroup);
      },
    );
  };

  // 导出脚本：以「新版本为主」，文件只需 name + content（兼容旧导入/导出格式）。
  const handleExport = () => {
    const payload = {
      type: 'easyops-scripts-config',
      version: 1,
      exportedAt: new Date().toISOString(),
      scripts: scripts.map((s) => ({ id: s.id, name: s.name, content: s.content || '' })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `easyops-scripts-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 导入脚本：兼容旧裸数组与包装格式，只需 name + content（其他字段不强行兼容）。
  const handleImport = async (file) => {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.scripts)
          ? parsed.scripts
          : null;
      if (!incoming) {
        window.alert('Invalid file: expected an easyops-scripts-config export or a scripts array.');
        return;
      }
      const records = incoming
        .filter((it) => it && typeof it.name === 'string' && it.name.trim())
        .map((it) => ({
          id: it.id,
          name: it.name.trim(),
          content: typeof it.content === 'string' ? it.content : '',
        }));
      if (records.length === 0) {
        window.alert('No valid scripts found in the file.');
        return;
      }
      // 优先后端批量导入；失败回退 localStorage（本地复刻后端变换）
      persistWithFallback(
        scriptsApi.importScripts(records),
        (fe) => importIntoRepo(fe, records),
        applyRepo,
      );
    } catch {
      window.alert('Failed to read file: not valid JSON.');
    }
  };

  const handleEdit = (script) => {
    setEditingScript(script);
    setAddScriptOpen(true);
  };

  const handleRemove = (script) => {
    if (!window.confirm(`Delete script ${script.name}?`)) return;
    // 乐观更新内存
    setScripts((prev) => prev.filter((s) => s.id !== script.id));
    // 持久化：优先后端 DELETE /api/scripts；失败回退 localStorage
    scriptsApi.remove(script.id).catch(() =>
      persistLocal((fe) => {
        fe.scripts = fe.scripts.filter((s) => s.id !== script.id);
      }),
    );
  };

  const handleClose = (execId) => {
    const exec = executions.find((e) => e.id === execId);
    if (!exec) return;
    killPty(execId, exec.mode);
    setExecutions(executions.filter((e) => e.id !== execId));
  };

  const handleCloseAll = () => {
    executions.forEach((exec) => killPty(exec.id, exec.mode));
    setExecutions([]);
  };

  // 停止某次执行：PTY 模式通过 execId 让主进程精准 kill（跨平台一致）；
  // mock 模式由卡片自身管理（点击 Stop 即本地终止自己的模拟流）。状态翻转交给 ExecutionCard。
  const handleStop = (execId) => {
    const exec = executions.find((e) => e.id === execId);
    if (!exec) return;
    killPty(execId, exec.mode);
    // mock 模式无需 App 介入：ExecutionCard 的 Stop 处理会本地终止自身流并翻 exited。
  };

  const handleRerun = (execId, mode) => {
    if (mode === 'max') {
      setExecutions((prev) =>
        prev.map((e) => (e.id === execId ? { ...e, maximized: !e.maximized } : e)),
      );
      return;
    }
    // 重新执行：复用同一张卡片（exec.id 不变），在当前终端内重跑，而非新建卡片。
    // 状态与 mock 流交由 ExecutionCard 自己维护（它靠 sessionId 变化判"重跑"并清屏/重启流）。
    const exec = executions.find((e) => e.id === execId);
    if (!exec) return;
    const script = scripts.find((s) => s.id === exec.scriptId);
    if (!script) return;

    // No Shell Mode：重跑同样明确失败（复用同一卡片，避免假装重跑）。
    if (noShellMode) {
      setExecutions((prev) =>
        prev.map((e) =>
          e.id === execId
            ? {
                ...e,
                shell: script.shell || 'global',
                shellPath: null,
                sessionId: `mock-${execId}`,
                mode: 'mock',
                bootError: NO_SHELL_MESSAGE,
              }
            : e,
        ),
      );
      return;
    }

    // 1) 终止正在运行的旧 PTY 会话，避免孤儿进程 / 输出串台
    //    （mock 旧流无需单独停：下方改 sessionId 会让卡片 effect cleanup 清掉旧定时器）
    killPty(execId, exec.mode);

    const { shellChoice, shellPath } = resolveScriptShell(script);

    // 2) 重置为"新运行实例"：先把 sessionId 置空（使"杀旧会话"产生的残留 exit 事件
    //    不再匹配），ExecutionCard 靠 sessionId 变化判"重跑"并清屏/重启流；
    //    sessionId 待新会话返回时覆盖。mock 模式直接给定新实例 id。
    setExecutions((prev) =>
      prev.map((e) =>
        e.id === execId
          ? {
              ...e,
              shell: shellChoice,
              shellPath,
              sessionId: ptyClient.available ? null : `mock-${execId}-${Date.now()}`,
              mode: ptyClient.available ? 'pty' : 'mock',
            }
          : e,
      ),
    );

    if (ptyClient.available) {
      startPtySession(execId, script, shellPath);
    }
    // mock 模式：sessionId 已在上方设为新值，ExecutionCard 的 mock effect 会自动重启流。
  };

  return (
    <div className="app">
      <TopBar
        selectedCount={selectedCount}
        onExecuteSelected={handleExecuteSelected}
        onAddScript={handleAddScript}
        onAddGroup={handleAddGroup}
        onDeleteSelected={handleDeleteSelected}
        theme={theme}
        onCycleTheme={cycleTheme}
        onOpenSettings={handleOpenSettings}
        onExport={handleExport}
        onImport={handleImport}
      />
      <main className={`main ${dragging ? 'is-dragging' : ''}`} ref={mainRef}>
        <ScriptList
          style={{ flex: `0 0 ${split}%` }}
          groups={groups}
          scripts={scripts}
          selectedSet={selected}
          defaultGroup={defaultGroup}
          onToggle={toggle}
          onSelectGroup={selectGroup}
          onExecute={runScript}
          onEdit={handleEdit}
          onRemove={handleRemove}
          onMoveScript={handleMoveScript}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
        />
        <div
          className="v-splitter"
          onMouseDown={startDrag}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
        />
        <div className="right-region">
          {/* 执行面板始终挂载：编辑脚本时打开 AddScriptPanel 只覆盖其上、不卸载本面板，
              从而保留各卡片 xterm 实例里已累积的输出（输出只在 term 实例内存中，
              卸载即随 term.dispose() 丢失。AddScriptPanel 以 absolute 浮层覆盖本区域）。 */}
          <ExecutionPanel
            executions={executions}
            globalShellPath={globalShellPath}
            shells={shells}
            onClose={handleClose}
            onCloseAll={handleCloseAll}
            onRerun={handleRerun}
            onStop={handleStop}
          />
          {addScriptOpen && (
            <AddScriptPanel
              open={addScriptOpen}
              groups={groups}
              script={editingScript}
              shells={shells}
              globalShellPath={globalShellPath}
              onClose={handleCloseScriptPanel}
              onSave={handleSaveScript}
            />
          )}
        </div>
      </main>

      <AddGroupModal
        open={addGroupOpen}
        existing={groups}
        onClose={() => setAddGroupOpen(false)}
        onSave={handleSaveGroup}
      />

      <DeleteGroupModal
        open={deleteGroupOpen}
        groupName={deletingGroup}
        scriptCount={deletingGroup ? scripts.filter((s) => s.group === deletingGroup).length : 0}
        onClose={() => {
          setDeleteGroupOpen(false);
          setDeletingGroup(null);
        }}
        onConfirm={handleConfirmDeleteGroup}
      />

      <RenameGroupModal
        open={renameGroupOpen}
        oldName={renamingGroup}
        existing={groups}
        onClose={() => {
          setRenameGroupOpen(false);
          setRenamingGroup(null);
        }}
        onConfirm={handleConfirmRenameGroup}
      />

      <SettingsModal open={settingsOpen} onClose={handleCloseSettings} />
    </div>
  );
}
