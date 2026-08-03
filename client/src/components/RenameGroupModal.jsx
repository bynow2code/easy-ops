import { useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey.js';

const MIN_LEN = 1;
const MAX_LEN = 10; // 须与后端 scripts-store 的 GROUP_NAME_MAX 一致

/**
 * 重命名分组模态框（纯 UI，与 AddGroupModal 同规则：1–10 字符、不与现有分组重名）。
 *  - defaultGroup ：传入当前默认分组名；该组重命名时允许「改成自身」（视为无变化）。
 *  - existing     ：除「当前分组本身」外的其他分组名，用于重名校验。
 * 父级通过 onConfirm(newName) 拿到合法新名。
 */
export default function RenameGroupModal({ open, oldName, existing = [], onClose, onConfirm }) {
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setName(oldName || '');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, oldName]);

  useEscapeKey(open, onClose);

  if (!open) return null;

  const trimmed = name.trim();
  const len = trimmed.length;
  const tooShort = len < MIN_LEN;
  const tooLong = name.length > MAX_LEN;
  const duplicate = trimmed !== oldName && existing.includes(trimmed);
  const unchanged = trimmed === oldName;
  const valid = !tooShort && !tooLong && !duplicate;

  const handleConfirm = () => {
    if (!valid || unchanged) {
      onClose();
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Rename Group">
        <div className="modal__head">
          <span className="modal__title">Rename Group</span>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">New Group Name</span>
            <input
              ref={inputRef}
              className={`field__input ${tooShort && name.length > 0 ? 'is-error' : ''}`}
              type="text"
              value={name}
              maxLength={MAX_LEN}
              placeholder="e.g. QA"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') onClose();
              }}
            />
          </label>

          <div className="field__meta">
            <span className={`field__hint ${!valid && (tooShort || duplicate) ? 'is-error' : ''}`}>
              {duplicate
                ? 'Group already exists'
                : tooShort
                  ? `At least ${MIN_LEN} character`
                  : `${trimmed === oldName ? 'Unchanged' : `Max ${MAX_LEN} characters`}`}
            </span>
            <span className={`field__counter ${tooLong ? 'is-error' : ''}`}>
              {name.length}/{MAX_LEN}
            </span>
          </div>
        </div>

        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--blue" disabled={!valid || unchanged} onClick={handleConfirm}>
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
