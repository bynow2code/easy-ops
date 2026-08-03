/**
 * 单个脚本行（勾选 · 名称 · 操作）。
 * 整行可拖动：原生 HTML5 DnD，draggable={true}。
 * 拖到同组其他行上半区=插到其前、下半区=插到其后 → 重排；
 * 拖到其他分组 → 换组（dropEdge 指示当前将插入的上/下位置）。
 * 没有专门的"拖把"区域，整行都能作为拖拽源。
 */
export default function ScriptItem({
  script,
  selected,
  dragging,
  dropEdge = null, // 'before' | 'after' | null：拖拽悬停时在本行上/下显示插入指示线
  onToggle,
  onExecute,
  onEdit,
  onRemove,
  onReorderStart,
  onReorderEnd,
  onReorderOver,
  onReorderDrop,
}) {
  return (
    <div
      className={`script-row ${dragging ? 'is-dragging' : ''} ${
        dropEdge === 'before' ? 'is-drop-before' : ''
      } ${dropEdge === 'after' ? 'is-drop-after' : ''}`}
      draggable
      onDragStart={(e) => onReorderStart(script, e)}
      onDragEnd={() => onReorderEnd()}
      onDragOver={(e) => onReorderOver(script, e)}
      onDrop={(e) => onReorderDrop(script, e)}
    >
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
