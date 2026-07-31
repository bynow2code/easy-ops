import { useMemo } from 'react';
import ScriptItem from './ScriptItem.jsx';

/**
 * 左侧脚本列表：按 group 分组渲染；每组含标题、计数与表头。
 * 数据由 App 通过 props 注入，保持本组件为受控的纯渲染。
 */
export default function ScriptList({
  scripts,
  selectedSet,
  onToggle,
  onSelectGroup,
  onExecute,
  onEdit,
  onRemove,
  onLocate,
}) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const s of scripts) {
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group).push(s);
    }
    return Array.from(map.entries());
  }, [scripts]);

  return (
    <section className="panel panel--list">
      {groups.map(([group, items]) => {
        const allSelected = items.every((i) => selectedSet.has(i.id));
        return (
          <div className="script-group" key={group}>
            <div className="script-group__head">
              <div className="script-group__title">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onSelectGroup(group, items, !allSelected)}
                  aria-label={`Select all in ${group}`}
                />
                <span>{group}</span>
              </div>
              <div className="script-group__count">{items.length}</div>
            </div>
            <div className="script-group__cols">
              <span /><span className="col-name">Name</span>
              <span className="col-status">Status</span>
              <span className="col-actions">Actions</span>
            </div>
            <div className="script-group__rows">
              {items.map((s) => (
                <ScriptItem
                  key={s.id}
                  script={s}
                  selected={selectedSet.has(s.id)}
                  onToggle={onToggle}
                  onExecute={onExecute}
                  onEdit={onEdit}
                  onRemove={onRemove}
                  onLocate={onLocate}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
