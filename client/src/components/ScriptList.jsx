import { useState } from 'react';
import ScriptItem from './ScriptItem.jsx';
import { IconEdit, IconTrash } from './Icons.jsx';
import { computeGroupReorder } from '../groupOrder.js';
import { computeAfterAnchor } from '../scriptOrder.js';

// 根据鼠标在目标元素的上/下半区，决定投放位置：上半区=before（放到目标上面），
// 下半区=after（放到目标下面）。dragover 事件携带 clientY，目标元素用 currentTarget。
function positionFromEvent(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  return e.clientY <= mid ? 'before' : 'after';
}

/**
 * 左侧脚本列表：按 groups（显式分组列表）渲染；每组含标题、计数与表头。
 * groups 由 App 通过 props 注入（初始 BACKEND/Frontend，新增分组亦可为空），
 * 本组件为受控纯渲染：脚本按 group 字段过滤到对应分组下。
 * 每个分组的收起/展开由本地 collapsed 集合控制（独立开关）。
 *
 * 拖拽排序 / 换组（原生 HTML5 DnD）：
 *  - 拖动某行可重排（同组内）；拖到别的组的行或分组标题/区域 → 换组。
 *  - 拖动分组头可重排分组顺序（含默认分组，均可拖动、落位不限）。
 *  - dragId 记录当前被拖脚本；groupDragName 记录当前被拖分组；dragOverGroup
 *    仅用于高亮投放目标分组（脚本与分组拖拽共用）。
 *  - 实际数据改动统一上抛：脚本换组 onMoveScript(dragId, targetGroup, beforeId)；
 *    分组排序 onReorderGroups(newOrder)。分组拖拽统一在 .script-group 容器层处理
 *    dragover/drop（进行中始终 preventDefault），避免嵌套子元素不拦截导致 drop 被拒。
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
  onReorderGroups,
  onRenameGroup,
  onDeleteGroup,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dragId, setDragId] = useState(null); // 被拖的脚本
  const [groupDragName, setGroupDragName] = useState(null); // 被拖的分组
  const [dragOverGroup, setDragOverGroup] = useState(null);
  const [dragOverScriptId, setDragOverScriptId] = useState(null); // 当前悬停的脚本行（用于行插入线）
  const [dropPosition, setDropPosition] = useState(null); // 'before' | 'after'：放入目标上/下

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
    setDragOverScriptId(null);
    setDropPosition(null);
    // 关键：必须清理被拖分组名。否则拖拽结束后 groupDragName 仍等于该组，
    // isDragging(=groupDragName===group) 恒真 → 该组永久挂 is-group-dragging（变灰）。
    setGroupDragName(null);
  };

  const handleRowDragOver = (script, e) => {
    // 分组拖拽落到行上由容器级 drop 兜底（重排分组），行本身不处理
    if (groupDragName) return;
    if (!dragId || dragId === script.id) return;
    e.preventDefault();
    e.stopPropagation(); // 阻断冒泡到容器，避免容器覆盖 dropPosition
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroup(script.group);
    setDragOverScriptId(script.id);
    // 行上半区=before（插到该脚本上面），下半区=after（插到该脚本下面）
    setDropPosition(positionFromEvent(e));
  };

  const handleRowDrop = (script, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (groupDragName) {
      // 分组拖拽落到某行所在分组 → 重排该分组（支持 before/after）
      onReorderGroups(
        computeGroupReorder(groups, groupDragName, script.group, dropPosition || 'before'),
      );
      handleReorderEnd();
      return;
    }
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    if (id && id !== script.id) {
      const pos = dropPosition || 'before';
      // after：插入到"目标之后同组的下一个脚本"之前；若无则用 null（追加到组末尾）
      const beforeId =
        pos === 'after' ? computeAfterAnchor(scripts, script.id, id) : script.id;
      onMoveScript(id, script.group, beforeId);
    }
    handleReorderEnd();
  };

  // ---- 分组拖拽排序（含默认分组，均可拖动、落位不限）----
  // 统一在 .script-group 容器层处理 dragover/drop：拖拽进行中始终 preventDefault，
  // 杜绝旧实现中"悬停在被拖分组自身 / 嵌套子元素不 preventDefault → drop 被浏览器拒绝"
  // 的间歇性失效。computeGroupReorder（见 groupOrder.js）为纯函数，任何分组均可落位。

  const handleGroupReorderStart = (group, e) => {
    setGroupDragName(group);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `group:${group}`);
  };

  // 容器级 dragover：任何进行中的拖拽都 preventDefault，确保 drop 一定被允许。
  const handleContainerDragOver = (group, e) => {
    if (!dragId && !groupDragName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroup(group);
    if (groupDragName) {
      // 分组拖拽：按容器（含分组头与行）上/下半区判定 before/after
      setDropPosition(positionFromEvent(e));
    } else if (dragId) {
      // 脚本拖拽落在分组区域（非具体行）：默认进组末尾 → after；交由行级处理器覆盖更精确位置
      setDragOverScriptId(null);
      setDropPosition('after');
    }
  };

  // 容器级 drop：分组拖拽 → 重排（支持 before/after）；脚本拖拽落在分组空白区 → 追加到末尾。
  const handleContainerDrop = (group, e) => {
    if (!dragId && !groupDragName) return;
    e.preventDefault();
    e.stopPropagation();
    if (groupDragName) {
      onReorderGroups(computeGroupReorder(groups, groupDragName, group, dropPosition || 'before'));
    } else if (dragId) {
      // 落在分组空白区：dropPosition 已被容器 dragover 设为 'after'（进组末尾）
      onMoveScript(dragId, group, null);
    }
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
        const isDragOver = dragOverGroup === group && (dragId || groupDragName);
        const isDragging = groupDragName === group;
        // 分组拖拽时的插入指示：仅当正在拖分组且本组是悬停目标时，按 dropPosition 显示上/下插入线
        const isDropBefore = groupDragName && dragOverGroup === group && dropPosition === 'before';
        const isDropAfter = groupDragName && dragOverGroup === group && dropPosition === 'after';
        return (
          <div
            className={`script-group ${isCollapsed ? 'is-collapsed' : ''} ${
              isDragOver ? 'is-dragover' : ''
            } ${isDragging ? 'is-group-dragging' : ''} ${
              isDropBefore ? 'is-drop-before' : ''
            } ${isDropAfter ? 'is-drop-after' : ''}`}
            key={group}
            onDragOver={(e) => handleContainerDragOver(group, e)}
            onDrop={(e) => handleContainerDrop(group, e)}
          >
            <div
              className="script-group__head"
              draggable
              onDragStart={(e) => handleGroupReorderStart(group, e)}
              // 拖拽结束时（无论是否成功 drop）统一清理拖拽态，避免状态泄漏导致分组永久变灰
              onDragEnd={() => handleReorderEnd()}
            >
              <svg
                className="script-group__grip"
                viewBox="0 0 10 16"
                width="10"
                height="16"
                aria-hidden="true"
                title="Drag to reorder"
              >
                  <g fill="currentColor">
                    <circle cx="2" cy="3" r="1.2" />
                    <circle cx="7" cy="3" r="1.2" />
                    <circle cx="2" cy="8" r="1.2" />
                    <circle cx="7" cy="8" r="1.2" />
                    <circle cx="2" cy="13" r="1.2" />
                    <circle cx="7" cy="13" r="1.2" />
                  </g>
                </svg>
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
                {items.length > 0 && (
                  <div className="script-group__cols">
                    <span />
                    <span />
                    <span className="col-name">Name</span>
                    <span className="col-actions">Actions</span>
                  </div>
                )}
                <div
                  className="script-group__rows"
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
                        dropEdge={dragId && dragOverScriptId === s.id ? dropPosition : null}
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
