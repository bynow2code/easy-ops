import { useEffect, useRef, useState } from 'react';

const MIN_LEN = 1;
const MAX_LEN = 6;

/**
 * 添加 Group 模态框（静态界面，暂不接后端）。
 * 校验：Group name 至少 1 个字符、至多 6 个字符，且不能与已有分组重名。
 *
 * 纯函数式 UI：受控输入 + 派生校验状态，父级通过 onSave(name) 拿到合法名称。
 */
export default function AddGroupModal({ open, existing = [], onClose, onSave }) {
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  // 打开时清空并聚焦，关闭时无需处理
  useEffect(() => {
    if (!open) return;
    setName('');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const trimmed = name.trim();
  const len = trimmed.length;
  const tooShort = len < MIN_LEN;
  const tooLong = name.length > MAX_LEN; // 输入层 maxLength 已拦截，兜底
  const duplicate = existing.includes(trimmed);
  const valid = !tooShort && !tooLong && !duplicate;

  const handleSave = () => {
    if (!valid) return;
    onSave(trimmed);
  };

  // 点击遮罩关闭（仅当点在遮罩本身）
  const handleOverlay = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={handleOverlay}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add Group">
        <div className="modal__head">
          <span className="modal__title">Add Group</span>
          <button className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">Group Name</span>
            <input
              ref={inputRef}
              className={`field__input ${tooShort && name.length > 0 ? 'is-error' : ''}`}
              type="text"
              value={name}
              maxLength={MAX_LEN}
              placeholder="e.g. QA SCRIPTS"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
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
                  : `Max ${MAX_LEN} characters`}
            </span>
            <span className={`field__counter ${tooLong ? 'is-error' : ''}`}>
              {name.length}/{MAX_LEN}
            </span>
          </div>
        </div>

        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--blue" disabled={!valid} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
