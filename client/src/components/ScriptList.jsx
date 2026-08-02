import { useState } from 'react';
import ScriptItem from './ScriptItem.jsx';
import { IconEdit, IconTrash } from './Icons.jsx';

/**
 * 左侧脚本列表：按 groups（显式分组列表）渲染；每组含标题、计数与表头。
 * groups 由 App 通过 props 注入（初始 BACKEND/Frontend，新增分组亦可为空），
 * 本组件为受控纯渲染：脚本按 group 字段过滤到对应分组下。
 * 每个分组的收起/展开由本地 collapsed 集合控制（独立开关）。
 *
 * 拖拽排序 / 换组（原生 HTML5 DnD）：
 *  - 拖动某行可重排（同组内）；拖到别的组的行或分组标题/区域 → 换组。
 *  - dragId 记录当前被拖脚本；dragOverGroup 仅用于高亮投放目标分组。
 *  - 实际数据改动统一上抛 onMoveScript(dragId, targetGroup, beforeId)。
 */
export default function ScriptList({
  style,
  groups,
  scripts,
  selectedSet,
  defaultGroup,
  onToggle,
  onSelectGroup,
  onExecute,
  onEdit,
  onRemove,
  onMoveScript,
  onRenameGroup,
  onDeleteGroup,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dragId, setDragId] = useState(null);
  const [dragOverGroup, setDragOverGroup] = useState(null);

  const toggleGroup = (group) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleReorderStart = (script, e) => {
    setDragId(script.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', script.id);
  };

  const handleReorderEnd = () => {
    setDragId(null);
    setDragOverGroup(null);
  };

  const handleRowDragOver = (script, e) => {
    if (!dragId || dragId === script.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroup(script.group);
  };

  const handleRowDrop = (script, e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    if (id && id !== script.id) onMoveScript(id, script.group, script.id);
    handleReorderEnd();
  };

  const handleGroupDragOver = (group, e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroup(group);
  };

  const handleGroupDrop = (group, e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    if (id) onMoveScript(id, group, null);
    handleReorderEnd();
  };

  return (
    <section className="panel panel--list" style={style}>
      {groups.length === 0 && (
        <div className="script-list__empty">
          No groups yet. Click <strong>Add Group</strong> at the top to create one.
        </div>
      )}
      {groups.map((group) => {
        const items = scripts.filter((s) => s.group === group);
        const allSelected = items.length > 0 && items.every((i) => selectedSet.has(i.id));
        const isCollapsed = collapsed.has(group);
        const isDragOver = dragOverGroup === group && dragId;
        return (
          <div
            className={`script-group ${isCollapsed ? 'is-collapsed' : ''} ${
              isDragOver ? 'is-dragover' : ''
            }`}
            key={group}
          >
            <div
              className="script-group__head"
              onDragOver={(e) => handleGroupDragOver(group, e)}
              onDrop={(e) => handleGroupDrop(group, e)}
            >
              <button
                type="button"
                className="script-group__toggle"
                onClick={() => toggleGroup(group)}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? `Expand ${group}` : `Collapse ${group}`}
                title={isCollapsed ? 'Expand' : 'Collapse'}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    d="M5 3.5 L11 8 L5 12.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div className="script-group__title">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={items.length === 0}
                  onChange={() => onSelectGroup(group, items, !allSelected)}
                  aria-label={`Select all in ${group}`}
                />
                <span>{group}</span>
              </div>
              <div className="script-group__count">{items.length}</div>
              <div className="script-group__actions">
                <button
                  type="button"
                  className="script-group__action"
                  title="Rename group"
                  aria-label={`Rename group ${group}`}
                  onClick={() => onRenameGroup(group)}
                >
                  <IconEdit />
                </button>
                <button
                  type="button"
                  className="script-group__action"
                  title={
                    group === defaultGroup ? 'Default group cannot be deleted' : 'Delete group'
                  }
                  aria-label={`Delete group ${group}`}
                  disabled={group === defaultGroup}
                  onClick={() => onDeleteGroup(group)}
                >
                  <IconTrash />
                </button>
              </div>
            </div>
            {!isCollapsed && (
              <>
                <div className="script-group__cols">
                  <span />
                  <span />
                  <span className="col-name">Name</span>
                  <span className="col-actions">Actions</span>
                </div>
                <div
                  className="script-group__rows"
                  onDragOver={(e) => handleGroupDragOver(group, e)}
                  onDrop={(e) => handleGroupDrop(group, e)}
                >
                  {items.length === 0 ? (
                    <div className="script-group__empty">No scripts in this group</div>
                  ) : (
                    items.map((s) => (
                      <ScriptItem
                        key={s.id}
                        script={s}
                        selected={selectedSet.has(s.id)}
                        dragging={dragId === s.id}
                        onToggle={onToggle}
                        onExecute={onExecute}
                        onEdit={onEdit}
                        onRemove={onRemove}
                        onReorderStart={handleReorderStart}
                        onReorderEnd={handleReorderEnd}
                        onReorderOver={handleRowDragOver}
                        onReorderDrop={handleRowDrop}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
