import { useEffect, useRef, useState } from 'react';
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
  // No Shell Mode：模拟"无可用解释器"。开启时执行/重跑脚本直接给出明确失败，
  // 而非用 null 路径假装运行（mock 模式下甚至会照常跑出模拟输出 → 模式"未生效"）。
  const [noShellMode, setNoShellMode] = useState(false);


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
        setNoShellMode(Boolean(st.noShellMode));
      })
      .catch(() => {
        const fe = readFrontendShells();
        setShells(fe);
        setGlobalShellPath(fe[0]?.path || null);
        setNoShellMode(readFrontendNoShellMode());
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
        setScripts(Array.isArray(repo.scripts) ? repo.scripts : []);
        setGroups(Array.isArray(repo.groups) ? repo.groups : []);
      })
      .catch(() => {
        const fe = readFrontendScripts();
        setScripts(fe.scripts);
        setGroups(fe.groups);
      });
  };


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
          bootError:
            'No shell available — No Shell Mode is on. Turn it off in Settings to run scripts.',
        },
        ...prev,
      ]);
      return;
    }

    // 'global' 解析为当前应用全局 shell 路径；否则用脚本指定的解释器路径
    const shellChoice = script.shell || 'global';
    const shellPath = resolveShellPath(shellChoice, globalShellPath);

    if (ptyClient.available) {
      const exec = {
        id,
        scriptId: script.id,
        group: script.group,
        name: script.name,
        shell: shellChoice,
        shellPath,
        sessionId: null,
        maximized: false,
        mode: 'pty',
      };
      setExecutions((prev) => [exec, ...prev]);
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
                ? { ...e, mode: 'mock', sessionId: `mock-${id}`, bootError: msg }
                : e,
            ),
          );
        });
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
      setScripts((prev) => [...prev, record]);
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
    // 关闭仍运行中的 PTY 卡时先杀掉会话，避免孤儿进程（mock 卡由各自卡片卸载时停定时器）
    if (exec.mode === 'pty' && exec.sessionId) {
      ptyClient.kill(execId);
    }
    setExecutions(executions.filter((e) => e.id !== execId));
  };

  const handleCloseAll = () => {
    executions.forEach((exec) => {
      // 关闭仍运行中的 PTY 卡时先杀掉会话，避免孤儿进程（mock 卡由各自卡片卸载时停定时器）
      if (exec.mode === 'pty' && exec.sessionId) {
        ptyClient.kill(exec.id);
      }
    });
    setExecutions([]);
  };

  // 停止某次执行：PTY 模式通过 execId 让主进程精准 kill（跨平台一致）；
  // mock 模式由卡片自身管理（点击 Stop 即本地终止自己的模拟流）。状态翻转交给 ExecutionCard。
  const handleStop = (execId) => {
    const exec = executions.find((e) => e.id === execId);
    if (!exec) return;
    if (exec.mode === 'pty' && exec.sessionId) {
      ptyClient.kill(execId);
    }
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
                bootError:
                  'No shell available — No Shell Mode is on. Turn it off in Settings to run scripts.',
              }
            : e,
        ),
      );
      return;
    }

    // 1) 终止正在运行的旧 PTY 会话，避免孤儿进程 / 输出串台
    //    （mock 旧流无需单独停：下方改 sessionId 会让卡片 effect cleanup 清掉旧定时器）
    if (exec.mode === 'pty' && exec.sessionId) {
      ptyClient.kill(execId);
    }

    const shellChoice = script.shell || 'global';
    const shellPath = resolveShellPath(shellChoice, globalShellPath);

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
      ptyClient
        .open({ execId, scriptId: script.id, content: script.content || '', shell: shellPath })
        .then((res) => {
          setExecutions((prev) =>
            prev.map((e) => (e.id === execId ? { ...e, sessionId: res?.sessionId || null } : e)),
          );
        })
        .catch((err) => {
          const msg = String((err && err.message) || err);
          // PTY 创建失败：降级为 mock 错误卡（ExecutionCard 检测 bootError 显示并翻 exited）
          setExecutions((prev) =>
            prev.map((e) =>
              e.id === execId
                ? { ...e, mode: 'mock', sessionId: `mock-${execId}`, bootError: msg }
                : e,
            ),
          );
        });
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
