import { useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import ScriptList from './components/ScriptList.jsx';
import ExecutionPanel from './components/ExecutionPanel.jsx';
import AddGroupModal from './components/AddGroupModal.jsx';
import AddScriptPanel from './components/AddScriptPanel.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { useTheme } from './hooks/useTheme.js';
import { mockOutputFor } from './data/mockScripts.js';
import { readFrontendShells } from './shellStore.js';
import { resolveShellPath } from './shellUtils.js';

/**
 * 应用根组件：管理三个顶层状态
 *  - scripts:     脚本列表（初始为空，由用户在 UI 中添加；后续接 /api/scripts）
 *  - selectedSet: 已勾选脚本 id 集合
 *  - executions:  当前运行/已完成的输出卡（模拟输出，后续接真实 PTY）
 *
 * 纯函数式业务：派生 selectedCount / 分组结果等。
 */
export default function App() {
  const [scripts, setScripts] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [executions, setExecutions] = useState([]);
  // 分组列表（初始为空，由"Add Group"创建；后续接后端时由 /api/groups 替换）
  const [groups, setGroups] = useState([]);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [addScriptOpen, setAddScriptOpen] = useState(false);
  const [editingScript, setEditingScript] = useState(null); // null = 新增模式
  const [settingsOpen, setSettingsOpen] = useState(false); // 设置（App Info）面板

  // Shell 列表（检测到的 + 自定义的）与全局 shell 路径，供"添加/编辑脚本"选择解释器，
  // 以及执行时把 'global' 解析成实际路径。未挂载 Electron 时保持为空/默认，UI 优雅退化。
  const [shells, setShells] = useState([]);
  const [globalShellPath, setGlobalShellPath] = useState(null);

  // 拉取 shell 列表（检测到的 + 自定义的）与全局 shell 路径；供"添加/编辑脚本"的
  // 解释器下拉、以及执行时把 'global' 解析成实际路径。未挂载 Electron 时为无操作。
  // 抽成独立函数：挂载时调一次，Settings 关闭时也调一次，确保设置里新增/移除的
  // 自定义 shell 能实时反映到 Add/Edit Script 的下拉（否则会停留在挂载时的快照）。
  const reloadShells = () => {
    const api = typeof window !== 'undefined' ? window.easyOps : null;
    if (api?.shell?.list) {
      api.shell
        .list()
        .then((st) => {
          setShells(Array.isArray(st.shells) ? st.shells : []);
          setGlobalShellPath(st.activeShellPath || st.shells?.[0]?.path || null);
        })
        .catch(() => {
          /* 忽略：保留默认值 */
        });
      return;
    }
    // 无 Electron 后端：从 localStorage 读取前端态自定义 shell，
    // 否则关闭 Settings 后 Add/Edit Script 的 Shell 下拉仍是空快照
    const fe = readFrontendShells();
    setShells(fe);
    setGlobalShellPath(fe[0]?.path || null);
  };

  useEffect(() => {
    reloadShells();
  }, []);

  // 主题：三态循环（system → dark → light → system），通过 <html data-theme> 切换
  const { theme, cycleTheme } = useTheme();

  // 左右分栏比例（脚本列表宽度占比 %），支持拖动中线调节
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const mainRef = useRef(null);

  const startDrag = (e) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev) => {
      const rect = mainRef.current?.getBoundingClientRect();
      if (!rect) return;
      let pct = ((ev.clientX - rect.left) / rect.width) * 100;
      pct = Math.min(80, Math.max(20, pct)); // 限制 20%~80%，避免某一栏被压没
      setSplit(pct);
    };
    const up = () => {
      setDragging(false);
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
  const runScript = (script) => {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lines = mockOutputFor(script.name);
    const startedAt = Date.now();
    // 'global' 解析为当前应用全局 shell 路径；否则用脚本指定的解释器路径
    const shellChoice = script.shell || 'global';
    const shellPath = resolveShellPath(shellChoice, globalShellPath);
    const exec = {
      id,
      scriptId: script.id,
      group: script.group,
      name: script.name,
      startedAt,
      duration: 0,
      status: 'running',
      exit: null,
      shell: shellChoice,
      shellPath,
      lines: [lines[0]], // 先输出一行，模拟流式
      maximized: false,
      stickToBottom: true,
    };
    setExecutions((prev) => [exec, ...prev]);
    patchScript(script.id, { status: 'running' });

    // 模拟流式输出 + 完成
    const tick = (i) => {
      if (i >= lines.length) {
        const duration = Date.now() - startedAt;
        setExecutions((prev) =>
          prev.map((e) => (e.id === id ? { ...e, status: 'exited', exit: 0, duration } : e)),
        );
        patchScript(script.id, { status: 'exited' });
        return;
      }
      setExecutions((prev) =>
        prev.map((e) => (e.id === id ? { ...e, lines: lines.slice(0, i + 1) } : e)),
      );
      setTimeout(() => tick(i + 1), 80);
    };
    setTimeout(() => tick(1), 120);
  };

  const handleExecuteSelected = () => {
    const ids = selected;
    scripts.filter((s) => ids.has(s.id)).forEach(runScript);
    setSelected(new Set());
  };

  const handleDeleteSelected = () => {
    setScripts((prev) => prev.filter((s) => !selected.has(s.id)));
    setSelected(new Set());
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
    if (id) {
      // 编辑模式：原地更新
      patchScript(id, { name, group, content: content || '', shell });
    } else {
      // 新增模式
      const newId = `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setScripts((prev) => [
        ...prev,
        { id: newId, name, group, content: content || '', shell, status: 'idle' },
      ]);
    }
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
    setScripts((prev) => {
      const dragged = prev.find((s) => s.id === dragId);
      if (!dragged) return prev;
      if (beforeId === dragId) return prev;
      const without = prev.filter((s) => s.id !== dragId);
      const moved = { ...dragged, group: targetGroup };
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
  };

  const handleSaveGroup = (name) => {
    // 静态：仅写入本地分组列表（空分组，不接后端）
    setGroups((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setAddGroupOpen(false);
  };

  const handleEdit = (script) => {
    setEditingScript(script);
    setAddScriptOpen(true);
  };

  const handleRemove = (script) => {
    if (!window.confirm(`Delete script ${script.name}?`)) return;
    setScripts((prev) => prev.filter((s) => s.id !== script.id));
  };

  const handleClose = (execId) => setExecutions((prev) => prev.filter((e) => e.id !== execId));

  const handleCloseAll = () => setExecutions([]);

  const handleToggleStick = (execId) =>
    setExecutions((prev) =>
      prev.map((e) => (e.id === execId ? { ...e, stickToBottom: !e.stickToBottom } : e)),
    );

  const handleRerun = (execId, mode) => {
    if (mode === 'max') {
      setExecutions((prev) =>
        prev.map((e) => (e.id === execId ? { ...e, maximized: !e.maximized } : e)),
      );
      return;
    }
    const exec = executions.find((e) => e.id === execId);
    const script = scripts.find((s) => s.id === exec?.scriptId);
    if (script) runScript(script);
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
      />
      <main className={`main ${dragging ? 'is-dragging' : ''}`} ref={mainRef}>
        <ScriptList
          style={{ flex: `0 0 ${split}%` }}
          groups={groups}
          scripts={scripts}
          selectedSet={selected}
          onToggle={toggle}
          onSelectGroup={selectGroup}
          onExecute={runScript}
          onEdit={handleEdit}
          onRemove={handleRemove}
          onMoveScript={handleMoveScript}
        />
        <div
          className="v-splitter"
          onMouseDown={startDrag}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
        />
        {addScriptOpen ? (
          <AddScriptPanel
            open={addScriptOpen}
            groups={groups}
            script={editingScript}
            shells={shells}
            globalShellPath={globalShellPath}
            onClose={handleCloseScriptPanel}
            onSave={handleSaveScript}
          />
        ) : (
          <ExecutionPanel
            executions={executions}
            globalShellPath={globalShellPath}
            shells={shells}
            onClose={handleClose}
            onCloseAll={handleCloseAll}
            onRerun={handleRerun}
            onToggleStick={handleToggleStick}
          />
        )}
      </main>

      <AddGroupModal
        open={addGroupOpen}
        existing={groups}
        onClose={() => setAddGroupOpen(false)}
        onSave={handleSaveGroup}
      />

      <SettingsModal open={settingsOpen} onClose={handleCloseSettings} />
    </div>
  );
}
