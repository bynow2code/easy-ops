import { useEffect, useRef, useState } from 'react';
import { monaco } from '../monaco/setup';

const MAX_NAME = 60;

/**
 * 添加脚本模态框：
 *  - Script Name：必填，最长 60 字符
 *  - Group：从现有分组下拉选择（脚本将出现在对应分组下）
 *  - Script Content：monaco-editor（shell 语法高亮）编辑脚本正文
 *
 * 受控 UI + 派生校验，父级通过 onSave({ name, group, content }) 拿到合法数据。
 */
export default function AddScriptModal({ open, groups = [], onClose, onSave }) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState(groups[0] || '');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  const nameRef = useRef(null);
  const editorRef = useRef(null);
  const containerRef = useRef(null);

  // 创建 / 销毁 Monaco 编辑器（仅在 open 时挂载 DOM；monaco 已随模块同步可用）
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'shell',
      theme: 'vs',
      minimap: { enabled: false },
      automaticLayout: true,
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      tabSize: 2,
      renderWhitespace: 'none',
      fontFamily: "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace",
    });
    editorRef.current = editor;
    setReady(true);
    return () => {
      editor.dispose();
      editorRef.current = null;
      setReady(false);
    };
  }, [open]);

  // 打开时重置表单并聚焦名称
  useEffect(() => {
    if (!open) return;
    setName('');
    setGroup(groups[0] || '');
    setError('');
    const t = setTimeout(() => nameRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, groups]);

  if (!open) return null;

  const trimmed = name.trim();
  const nameEmpty = trimmed.length === 0;
  const nameTooLong = name.length > MAX_NAME;
  const groupEmpty = !group;
  const valid = !nameEmpty && !nameTooLong && !groupEmpty;
  const canSave = valid && ready;

  const handleSave = () => {
    if (!valid) {
      setError(
        nameEmpty
          ? 'Script name is required'
          : nameTooLong
            ? `Name too long (max ${MAX_NAME})`
            : 'Please select a group',
      );
      return;
    }
    const content = editorRef.current?.getValue() ?? '';
    onSave({ name: trimmed, group, content });
  };

  const handleOverlay = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={handleOverlay}>
      <div className="modal modal--script" role="dialog" aria-modal="true" aria-label="Add Script">
        <div className="modal__head">
          <span className="modal__title">Add Script</span>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">Script Name</span>
            <input
              ref={nameRef}
              className={`field__input ${nameEmpty && error ? 'is-error' : ''}`}
              type="text"
              value={name}
              maxLength={MAX_NAME}
              placeholder="e.g. deploy.sh"
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') onClose();
              }}
            />
          </label>

          <label className="field">
            <span className="field__label">Group</span>
            <select
              className="field__input"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              {groups.length === 0 ? (
                <option value="">（无分组）</option>
              ) : (
                groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="field">
            <span className="field__label">Script Content</span>
            <div className="monaco-host" ref={containerRef} />
          </div>

          {error && <div className="modal__error">{error}</div>}
        </div>

        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--blue" disabled={!canSave} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
