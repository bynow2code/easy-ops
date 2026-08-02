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
import { ptyClient } from './ptyClient.js';
import { shellApi } from './shellApi.js';
import { scriptsApi } from './scriptsApi.js';
import { readFrontendScripts, writeFrontendScripts } from './scriptsStore.js';

/**
 * 应用根组件：管理三个顶层状态
 *  - scripts:     脚本列表（初始为空，由用户在 UI 中添加；挂载时从后端 /api/scripts 拉取，失败回退 localStorage）
 *  - selectedSet: 已勾选脚本 id 集合
 *  - executions:  当前运行/已完成的输出卡
 *
 * 纯函数式业务：派生 selectedCount / 分组结果等。脚本与分组的持久化统一走后端
 * scriptsApi（scripts.json 唯一写方），后端不可达时退化到 localStorage。
 */
export default function App() {
  const [scripts, setScripts] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [executions, setExecutions] = useState([]);
  // 分组列表（初始为空；挂载时由后端 /api/scripts 拉取，新增/移除经 /api/groups 持久化）
  const [groups, setGroups] = useState([]);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [addScriptOpen, setAddScriptOpen] = useState(false);
  const [editingScript, setEditingScript] = useState(null); // null = 新增模式
  const [settingsOpen, setSettingsOpen] = useState(false); // 设置（Settings）面板

  // Shell 列表（检测到的 + 自定义的）与全局 shell 路径，供"添加/编辑脚本"选择解释器，
  // 以及执行时把 'global' 解析成实际路径。未挂载 Electron 时保持为空/默认，UI 优雅退化。
  const [shells, setShells] = useState([]);
  const [globalShellPath, setGlobalShellPath] = useState(null);

  const abortRef = useRef(new Set()); // mock 模式的终止令牌
  // 镜像最新 executions，供 onExit 判断\"对应输出卡是否还在\"（Close All 已清卡片后，
  // 不应再由 onExit 把脚本状态覆盖回 exited）。
  const executionsRef = useRef(executions);
  useEffect(() => {
    executionsRef.current = executions;
  }, [executions]);

  // 拉取 shell 列表（检测到的 + 自定义的）与全局 shell 路径；供"添加/编辑脚本"的
  // 解释器下拉、以及执行时把 'global' 解析成实际路径。未挂载 Electron 时为无操作。
  // 抽成独立函数：挂载时调一次，Settings 关闭时也调一次，确保设置里新增/移除的
  // 自定义 shell 能实时反映到 Add/Edit Script 的下拉（否则会停留在挂载时的快照）。
  const reloadShells = () => {
    // 通过 HTTP 从后端拉取（检测到的 + 自定义的）shell 与全局路径；
    // 后端不可达时退化到前端态 localStorage，保证 UI 不崩。
    shellApi
      .list()
      .then((st) => {
        setShells(Array.isArray(st.shells) ? st.shells : []);
        setGlobalShellPath(st.activeShellPath || st.shells?.[0]?.path || null);
      })
      .catch(() => {
        const fe = readFrontendShells();
        setShells(fe);
        setGlobalShellPath(fe[0]?.path || null);
      });
  };

  useEffect(() => {
    reloadShells();
    loadScripts();
  }, []);

  // 拉取已保存的脚本与分组：优先走后端 /api/scripts；后端不可达时退化到
  // localStorage（scriptsStore），保证无主进程 / 离线时 UI 也能恢复上次数据。
  const loadScripts = () => {
    scriptsApi
      .list()
      .then((repo) => {
        setScripts(
          Array.isArray(repo.scripts) ? repo.scripts.map((s) => ({ ...s, status: 'idle' })) : [],
        );
        setGroups(Array.isArray(repo.groups) ? repo.groups : []);
      })
      .catch(() => {
        const fe = readFrontendScripts();
        setScripts(fe.scripts.map((s) => ({ ...s, status: 'idle' })));
        setGroups(fe.groups);
      });
  };

  // 真实 PTY 模式：订阅主进程抛来的"执行结束"事件，把对应输出卡翻成 exited
  // 并回填退出码；同时同步脚本级状态。平台差异已在主进程封死，这里零分支。
  // 关键：exit 事件携带 sessionId，仅当与当前卡片的 sessionId 一致才生效——
  // 否则是"重跑时杀掉旧会话"产生的残留 exit，应忽略，否则会把刚设回 running 的
  // 状态误翻成 exited（重跑场景的竞态 bug）。
  useEffect(() => {
    if (!ptyClient.available) return undefined;
    return ptyClient.onExit(({ execId, scriptId, exitCode, sessionId }) => {
      setExecutions((prev) =>
        prev.map((e) =>
          e.id === execId && e.sessionId === sessionId
            ? { ...e, status: 'exited', exit: exitCode ?? null }
            : e,
        ),
      );
      const cur = executionsRef.current.find((e) => e.id === execId);
      if (scriptId && cur && cur.sessionId === sessionId) {
        setScripts((prev) =>
          prev.map((s) => (s.id === scriptId ? { ...s, status: 'exited' } : s)),
        );
      }
    });
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
  //  - Electron 内：开真实 PTY 会话，脚本内容直接喂给解释器（无临时文件），
  //    输出经 IPC 流式回到 ExecutionCard 的 xterm。
  //  - 非 Electron（浏览器 dev / 单测）：回退到 mock 流式输出，保证 UI 可用。
  const runScript = (script) => {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // 'global' 解析为当前应用全局 shell 路径；否则用脚本指定的解释器路径
    const shellChoice = script.shell || 'global';
    const shellPath = resolveShellPath(shellChoice, globalShellPath);

    if (ptyClient.available) {
      const exec = {
        id,
        scriptId: script.id,
        group: script.group,
        name: script.name,
        status: 'running',
        exit: null,
        shell: shellChoice,
        shellPath,
        sessionId: null,
        lines: [],
        maximized: false,
        mode: 'pty',
      };
      setExecutions((prev) => [exec, ...prev]);
      patchScript(script.id, { status: 'running' });
      ptyClient
        .open({ execId: id, scriptId: script.id, content: script.content || '', shell: shellPath })
        .then((res) => {
          setExecutions((prev) =>
            prev.map((e) => (e.id === id ? { ...e, sessionId: res?.sessionId || null } : e)),
          );
        })
        .catch((err) => {
          const msg = String((err && err.message) || err);
          // 真实 PTY 会话创建失败：降级为文本模式，把错误直接显示在卡片里，
          // 否则 ExecutionCard 仍按 pty 渲染 xterm 黑屏，错误信息会被吞掉。
          setExecutions((prev) =>
            prev.map((e) =>
              e.id === id
                ? { ...e, status: 'exited', exit: 1, mode: 'mock', lines: [msg] }
                : e,
            ),
          );
          patchScript(script.id, { status: 'exited' });
        });
      return;
    }

    // 回退：mock 流式输出
    const lines = mockOutputFor(script.name);
    const exec = {
      id,
      scriptId: script.id,
      group: script.group,
      name: script.name,
      status: 'running',
      exit: null,
      shell: shellChoice,
      shellPath,
      lines: [lines[0]],
      maximized: false,
      mode: 'mock',
    };
    setExecutions((prev) => [exec, ...prev]);
    patchScript(script.id, { status: 'running' });

    const tick = (i) => {
      if (abortRef.current.has(id)) return; // 被停止则中断
      if (i >= lines.length) {
        setExecutions((prev) =>
          prev.map((e) => (e.id === id ? { ...e, status: 'exited', exit: 0 } : e)),
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
    // 规整后的数据记录（仅持久化字段，不含运行期 status）
    const finalId =
      id || `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      setScripts((prev) => [...prev, { ...record, status: 'idle' }]);
    }

    // 持久化：优先后端 /api/scripts；失败回退 localStorage
    scriptsApi
      .save(record)
      .catch(() => {
        const fe = readFrontendScripts();
        const exists = fe.scripts.some((s) => s.id === finalId);
        fe.scripts = exists
          ? fe.scripts.map((s) => (s.id === finalId ? record : s))
          : [...fe.scripts, record];
        writeFrontendScripts(fe);
      });

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
      scriptsApi
        .save(movedRecord)
        .catch(() => {
          const fe = readFrontendScripts();
          fe.scripts = fe.scripts.map((s) => (s.id === movedRecord.id ? movedRecord : s));
          writeFrontendScripts(fe);
        });
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
      .catch(() => {
        const fe = readFrontendScripts();
        if (!fe.groups.includes(name)) fe.groups.push(name);
        writeFrontendScripts(fe);
      });
    setAddGroupOpen(false);
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
    scriptsApi
      .remove(script.id)
      .catch(() => {
        const fe = readFrontendScripts();
        fe.scripts = fe.scripts.filter((s) => s.id !== script.id);
        writeFrontendScripts(fe);
      });
  };

  const handleClose = (execId) => {
    const exec = executions.find((e) => e.id === execId);
    if (!exec) return;
    const scriptId = exec.scriptId;
    const wasRunning = exec.status === 'running';
    // 关闭仍运行中的 PTY 卡时先杀掉会话，避免孤儿进程
    if (exec.mode === 'pty' && exec.status === 'running' && exec.sessionId) {
      ptyClient.kill(execId);
    }
    abortRef.current.delete(execId);
    const remaining = executions.filter((e) => e.id !== execId);
    setExecutions(remaining);
    // 该脚本已无其它"运行中"的输出卡 → 复位脚本状态，避免左侧列表卡在 Running
    // （与 handleCloseAll 语义一致；同脚本存在多张卡时不会误复位）。
    if (scriptId && wasRunning && !remaining.some((e) => e.scriptId === scriptId && e.status === 'running')) {
      setScripts((prev) => prev.map((s) => (s.id === scriptId ? { ...s, status: 'idle' } : s)));
    }
  };

  const handleCloseAll = () => {
    executions.forEach((exec) => {
      // 关闭仍运行中的 PTY 卡时先杀掉会话，避免孤儿进程；mock 模式标记中断令牌
      if (exec.mode === 'pty' && exec.status === 'running' && exec.sessionId) {
        ptyClient.kill(exec.id);
      } else if (exec.mode === 'mock') {
        abortRef.current.add(exec.id);
      }
    });
    // 复位所有被标记为 running 的脚本状态：Close All 后列表不应再显示 Running。
    // 上方已 kill/abort 运行会话，onExit 会因卡片已清而被上面的守卫跳过，不会覆盖本处复位。
    setScripts((prev) => prev.map((s) => (s.status === 'running' ? { ...s, status: 'idle' } : s)));
    setExecutions([]);
  };

  // 停止某次执行：PTY 模式通过 execId 让主进程精准 kill（跨平台一致）；
  // mock 模式标记中断令牌。kill 后 onExit 会再回填退出码。
  const handleStop = (execId) => {
    const exec = executions.find((e) => e.id === execId);
    if (!exec) return;
    if (exec.mode === 'pty' && exec.sessionId) {
      ptyClient.kill(execId);
    } else if (exec.mode === 'mock') {
      abortRef.current.add(execId);
    }
    setExecutions((prev) =>
      prev.map((e) => (e.id === execId ? { ...e, status: 'exited' } : e)),
    );
    // 同步把脚本状态翻回非 running：PTY 模式 onExit 会再补一次（幂等）；
    // mock 模式无 exit 事件，必须在此兜底，否则脚本列表仍显示 Running。
    if (exec.scriptId) patchScript(exec.scriptId, { status: 'exited' });
  };

  const handleRerun = (execId, mode) => {
    if (mode === 'max') {
      setExecutions((prev) =>
        prev.map((e) => (e.id === execId ? { ...e, maximized: !e.maximized } : e)),
      );
      return;
    }
    // 重新执行：复用同一张卡片（exec.id 不变），在当前终端内重跑，
    // 而不是新建卡片 / 新终端。
    const exec = executions.find((e) => e.id === execId);
    if (!exec) return;
    const script = scripts.find((s) => s.id === exec.scriptId);
    if (!script) return;

    // 1) 终止正在运行的旧会话，避免孤儿进程 / 输出串台
    if (exec.mode === 'pty' && exec.sessionId) {
      ptyClient.kill(execId);
    } else if (exec.mode === 'mock') {
      abortRef.current.add(execId);
    }

    const shellChoice = script.shell || 'global';
    const shellPath = resolveShellPath(shellChoice, globalShellPath);

    // 2) 重置卡片状态（保留 exec.id；先把 sessionId 置空，使"杀旧会话"产生的残留
    //    exit 事件（仍携带旧 sessionId）不再匹配，避免把刚设回 running 的状态误翻成 exited。
    //    sessionId 待新会话返回时覆盖，ExecutionCard 靠其变化判"重跑"并清屏）。
    setExecutions((prev) =>
      prev.map((e) =>
        e.id === execId
          ? {
              ...e,
              status: 'running',
              exit: null,
              shell: shellChoice,
              shellPath,
              sessionId: null,
              lines: [],
              mode: ptyClient.available ? 'pty' : 'mock',
            }
          : e,
      ),
    );
    patchScript(script.id, { status: 'running' });

    if (ptyClient.available) {
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
                ? { ...e, status: 'exited', exit: 1, mode: 'mock', lines: [msg] }
                : e,
            ),
          );
          patchScript(script.id, { status: 'exited' });
        });
    } else {
      // 回退：mock 流式输出（复用同卡片）
      const lines = mockOutputFor(script.name);
      const tick = (i) => {
        if (abortRef.current.has(execId)) return;
        if (i >= lines.length) {
          setExecutions((prev) =>
            prev.map((e) =>
              e.id === execId ? { ...e, status: 'exited', exit: 0 } : e,
            ),
          );
          patchScript(script.id, { status: 'exited' });
          return;
        }
        setExecutions((prev) =>
          prev.map((e) => (e.id === execId ? { ...e, lines: lines.slice(0, i + 1) } : e)),
        );
        setTimeout(() => tick(i + 1), 80);
      };
      setTimeout(() => tick(0), 120);
    }
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
            onStop={handleStop}
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
