import { useState } from 'react';
import ScriptItem from './ScriptItem.jsx';

/**
 * 左侧脚本列表：按 groups（显式分组列表）渲染；每组含标题、计数与表头。
 * groups 由 App 通过 props 注入（初始 BACKEND/Frontend，新增分组亦可为空），
 * 本组件为受控纯渲染：脚本按 group 字段过滤到对应分组下。
 * 每个分组的收起/展开由本地 collapsed 集合控制（独立开关）。
 */
export default function ScriptList({
  style,
  groups,
  scripts,
  selectedSet,
  onToggle,
  onSelectGroup,
  onExecute,
  onEdit,
  onRemove,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());

  const toggleGroup = (group) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <section className="panel panel--list" style={style}>
      {groups.map((group) => {
        const items = scripts.filter((s) => s.group === group);
        const allSelected = items.length > 0 && items.every((i) => selectedSet.has(i.id));
        const isCollapsed = collapsed.has(group);
        return (
          <div className={`script-group ${isCollapsed ? 'is-collapsed' : ''}`} key={group}>
            <div className="script-group__head">
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
            </div>
            {!isCollapsed && (
              <>
                <div className="script-group__cols">
                  <span />
                  <span />
                  <span className="col-name">Name</span>
                  <span className="col-status">Status</span>
                  <span className="col-actions">Actions</span>
                </div>
                <div className="script-group__rows">
                  {items.length === 0 ? (
                    <div className="script-group__empty">No scripts in this group</div>
                  ) : (
                    items.map((s) => (
                      <ScriptItem
                        key={s.id}
                        script={s}
                        selected={selectedSet.has(s.id)}
                        onToggle={onToggle}
                        onExecute={onExecute}
                        onEdit={onEdit}
                        onRemove={onRemove}
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
