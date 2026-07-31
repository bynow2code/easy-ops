import { useEffect, useMemo, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import ScriptList from './components/ScriptList.jsx';
import ExecutionPanel from './components/ExecutionPanel.jsx';
import AddGroupModal from './components/AddGroupModal.jsx';
import { initialScripts, mockOutputFor } from './data/mockScripts.js';

/**
 * 应用根组件：管理三个顶层状态
 *  - scripts:     脚本列表（来自 mock，后续接 /api/scripts）
 *  - selectedSet: 已勾选脚本 id 集合
 *  - executions:  当前运行/已完成的输出卡
 *
 * 纯函数式业务：派生 selectedCount / 分组结果等。
 */
export default function App() {
  const [scripts, setScripts] = useState(initialScripts);
  const [selected, setSelected] = useState(() => new Set());
  const [executions, setExecutions] = useState([]);
  // 分组列表（静态：仅本地 state，后续接后端时由 /api/groups 替换）
  const [groups, setGroups] = useState(['BACKEND SCRIPTS', 'FRONTEND SCRIPTS']);
  const [addGroupOpen, setAddGroupOpen] = useState(false);

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

  // 执行入口（单脚本/批量）
  const runScript = (script) => {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lines = mockOutputFor(script.name);
    const startedAt = Date.now();
    const exec = {
      id,
      scriptId: script.id,
      group: script.group,
      name: script.name,
      startedAt,
      duration: 0,
      status: 'running',
      exit: null,
      lines: [lines[0]], // 先输出一行，模拟流式
      stickToBottom: true,
      maximized: false,
    };
    setExecutions((prev) => [exec, ...prev]);
    // 脚本侧状态切到 running
    setScripts((prev) =>
      prev.map((s) => (s.id === script.id ? { ...s, status: 'running' } : s))
    );

    // 模拟流式输出 + 完成
    const tick = (i) => {
      if (i >= lines.length) {
        const duration = Date.now() - startedAt;
        setExecutions((prev) =>
          prev.map((e) => (e.id === id ? { ...e, status: 'done', exit: 0, duration } : e))
        );
        setScripts((prev) =>
          prev.map((s) => (s.id === script.id ? { ...s, status: 'done' } : s))
        );
        return;
      }
      setExecutions((prev) =>
        prev.map((e) => (e.id === id ? { ...e, lines: lines.slice(0, i + 1) } : e))
      );
      setTimeout(() => tick(i + 1), 80);
    };
    setTimeout(() => tick(1), 120);
  };

  const handleExecute = (script) => runScript(script);

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
    // TODO(下一步): 接入新增脚本表单
    window.alert('TODO: 新增脚本表单（下一步接入）');
  };

  const handleAddGroup = () => setAddGroupOpen(true);

  const handleSaveGroup = (name) => {
    // 静态：仅写入本地分组列表（空分组，不接后端）
    setGroups((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setAddGroupOpen(false);
  };

  const handleEdit = (script) => {
    window.alert(`TODO: 编辑脚本 ${script.name}（下一步接入）`);
  };

  const handleRemove = (script) => {
    if (!window.confirm(`删除脚本 ${script.name} ?`)) return;
    setScripts((prev) => prev.filter((s) => s.id !== script.id));
  };

  const handleLocate = (script) => {
    window.alert(`TODO: 定位脚本 ${script.name}（下一步接入）`);
  };

  const handleClose = (execId) =>
    setExecutions((prev) => prev.filter((e) => e.id !== execId));

  const handleCloseAll = () => setExecutions([]);

  const handleRerun = (execId, mode) => {
    if (mode === 'max') {
      setExecutions((prev) =>
        prev.map((e) => (e.id === execId ? { ...e, maximized: !e.maximized } : e))
      );
      return;
    }
    const exec = executions.find((e) => e.id === execId);
    const script = scripts.find((s) => s.id === exec?.scriptId);
    if (script) runScript(script);
  };

  const handleToggleStick = (execId) =>
    setExecutions((prev) =>
      prev.map((e) => (e.id === execId ? { ...e, stickToBottom: !e.stickToBottom } : e))
    );

  // 演示用：进入应用时自动跑两个脚本，复现截图中的运行态
  useEffect(() => {
    const be = scripts.find((s) => s.name === 'PMS-后端-TEST');
    const fe = scripts.find((s) => s.name === 'PMS-后端-DEV');
    if (be) setTimeout(() => runScript(be), 200);
    if (fe) setTimeout(() => runScript(fe), 600);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <TopBar
        selectedCount={selectedCount}
        onExecuteSelected={handleExecuteSelected}
        onAddScript={handleAddScript}
        onAddGroup={handleAddGroup}
        onDeleteSelected={handleDeleteSelected}
      />
      <main className="main">
        <ScriptList
          groups={groups}
          scripts={scripts}
          selectedSet={selected}
          onToggle={toggle}
          onSelectGroup={selectGroup}
          onExecute={handleExecute}
          onEdit={handleEdit}
          onRemove={handleRemove}
          onLocate={handleLocate}
        />
        <ExecutionPanel
          executions={executions}
          onClose={handleClose}
          onCloseAll={handleCloseAll}
          onRerun={handleRerun}
          onToggleStick={handleToggleStick}
        />
      </main>

      <AddGroupModal
        open={addGroupOpen}
        existing={groups}
        onClose={() => setAddGroupOpen(false)}
        onSave={handleSaveGroup}
      />
    </div>
  );
}
