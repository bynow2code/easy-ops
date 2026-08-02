import { useState } from 'react';
import { IconDrag } from './Icons.jsx';

/**
 * 单个脚本行（拖拽柄 · 勾选 · 名称 · 操作四件套）
 * 拖动行为：
 *  - 仅在按下左侧拖拽柄（script-row__drag）后才允许拖动整行（armed 模式），
 *    避免与勾选/按钮的点击冲突；
 *  - 拖动整行作为拖拽影像，拖到同组其他行前 → 重排；拖到其他分组 → 换组。
 */
export default function ScriptItem({
  script,
  selected,
  dragging,
  onToggle,
  onExecute,
  onEdit,
  onRemove,
  onReorderStart,
  onReorderEnd,
  onReorderOver,
  onReorderDrop,
}) {
  const [armed, setArmed] = useState(false);

  return (
    <div
      className={`script-row ${dragging ? 'is-dragging' : ''}`}
      draggable={armed}
      onDragStart={(e) => {
        onReorderStart(script, e);
      }}
      onDragEnd={() => {
        setArmed(false);
        onReorderEnd();
      }}
      onMouseUp={() => setArmed(false)}
      onDragOver={(e) => onReorderOver(script, e)}
      onDrop={(e) => onReorderDrop(script, e)}
    >
      <div
        className="script-row__drag"
        title="Drag to reorder, or drop onto another group to move"
        onMouseDown={() => setArmed(true)}
        onMouseUp={() => setArmed(false)}
      >
        <IconDrag />
      </div>
      <div className="script-row__check">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(script.id)}
          aria-label={`Select ${script.name}`}
        />
      </div>
      <div className="script-row__name" title={script.name}>
        {script.name}
      </div>
      <div className="script-row__actions">
        <button className="btn btn--blue" onClick={() => onExecute(script)}>
          Execute
        </button>
        <button className="btn btn--orange" onClick={() => onEdit(script)}>
          Edit
        </button>
        <button className="btn btn--red" onClick={() => onRemove(script)}>
          Delete
        </button>
      </div>
    </div>
  );
}
