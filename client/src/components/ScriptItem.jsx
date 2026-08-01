import { IconDrag } from './Icons.jsx';

/**
 * 单个脚本行（按截图：拖拽柄 · 勾选 · 名称 · 状态 · 操作四件套）
 */
export default function ScriptItem({ script, selected, onToggle, onExecute, onEdit, onRemove }) {
  const status = script.status;
  return (
    <div className="script-row">
      <div className="script-row__drag" title="Drag to reorder">
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
      <div className="script-row__status">
        <StatusBadge status={status} />
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

function StatusBadge({ status }) {
  if (status === 'running') return <span className="status status--run">Running</span>;
  if (status === 'exited') return <span className="status status--ok">Exited</span>;
  return <span className="status status--idle">Idle</span>;
}
