import ScriptItem from './ScriptItem.jsx';

/**
 * 左侧脚本列表：按 groups（显式分组列表）渲染；每组含标题、计数与表头。
 * groups 由 App 通过 props 注入（初始 BACKEND/Frontend，新增分组亦可为空），
 * 本组件为受控纯渲染：脚本按 group 字段过滤到对应分组下。
 */
export default function ScriptList({
  groups,
  scripts,
  selectedSet,
  onToggle,
  onSelectGroup,
  onExecute,
  onEdit,
  onRemove,
  onLocate,
}) {
  return (
    <section className="panel panel--list">
      {groups.map((group) => {
        const items = scripts.filter((s) => s.group === group);
        const allSelected = items.length > 0 && items.every((i) => selectedSet.has(i.id));
        return (
          <div className="script-group" key={group}>
            <div className="script-group__head">
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
            <div className="script-group__cols">
              <span /><span className="col-name">Name</span>
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
                    onLocate={onLocate}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
