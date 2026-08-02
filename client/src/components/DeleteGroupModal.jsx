import { useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey.js';

/**
 * 删除分组确认框（纯 UI）。
 *  - 警告该分组下的脚本数量；
 *  - 勾选项「Also delete the N script(s) in this group」默认不勾选：
 *    不勾选 → 删除分组时其下脚本自动挪到默认分组（不丢失）；
 *    勾选   → 连同脚本一并删除。
 *  - 默认分组不可删（由调用方保证不会以 isDefault 打开本框）。
 */
export default function DeleteGroupModal({ open, groupName, scriptCount, onClose, onConfirm }) {
  const [deleteScripts, setDeleteScripts] = useState(false);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setDeleteScripts(false); // 每次打开重置为默认（不勾选）
    const t = setTimeout(() => confirmRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEscapeKey(open, onClose);

  if (!open) return null;

  const handleConfirm = () => onConfirm(deleteScripts);

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Delete Group">
        <div className="modal__head">
          <span className="modal__title">Delete Group</span>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body">
          <p className="modal__text">
            Delete group <strong>{groupName}</strong>? It contains <strong>{scriptCount}</strong>{' '}
            script{scriptCount === 1 ? '' : 's'}.
          </p>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={deleteScripts}
              onChange={(e) => setDeleteScripts(e.target.checked)}
            />
            <span>
              Also delete the {scriptCount} script{scriptCount === 1 ? '' : 's'} in this group
            </span>
          </label>
          {!deleteScripts && (
            <p className="modal__hint">
              Unchecked: scripts will be moved to the <strong>Default</strong> group instead of
              being deleted.
            </p>
          )}
        </div>

        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button ref={confirmRef} className="btn btn--red" onClick={handleConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
