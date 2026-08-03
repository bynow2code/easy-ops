import { useEffect, useRef, useState } from 'react';
import { monaco } from '../monaco/setup';
import { useEscapeKey } from '../hooks/useEscapeKey.js';

const MAX_NAME = 20;

// 读取当前生效主题，映射为 Monaco 内置主题名（跟随 <html data-theme>）
function readMonacoTheme() {
  if (typeof document === 'undefined') return 'vs';
  return document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs';
}

/**
 * 添加 / 编辑脚本：停靠在主区右侧的编辑器面板（非居中弹窗）。
 *  - 新增模式：script 为 null，表单清空。
 *  - 编辑模式：script 为已有脚本，名称/分组/内容预填，Save 时回传 id 由父级更新。
 *  - Script Name：必填，最长 10 字符
 *  - Group：必填，从现有分组下拉选择（编辑时若原分组已不存在也保留可选项）
 *  - Shell：可选解释器；默认选中当前激活的 shell，下拉仅列出检测/自定义到的真实 shell
 *  - Script Content：monaco-editor（shell 语法高亮 + 代码提示），占满面板剩余高度
 *
 * 受控 UI + 派生校验，父级通过 onSave({ id, name, group, content, shell }) 拿到合法数据
 * （新增时 id 为 undefined，编辑时为原脚本 id；shell 为某个 shell 路径，默认 = 当前激活 shell）。
 */
export default function AddScriptPanel({
  open,
  groups = [],
  script = null,
  shells = [],
  globalShellPath = null,
  onClose,
  onSave,
}) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  // 默认选中「当前激活的 shell」：优先 globalShellPath（须在 shells 列表内），否则列表首个；
  // 都为空则 ''（运行时由 resolveShellPath 回退到应用全局/系统默认 shell）。
  const defaultShellChoice =
    shells.find((s) => s.path === globalShellPath)?.path ?? shells[0]?.path ?? '';
  const [shellChoice, setShellChoice] = useState(defaultShellChoice);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  const nameRef = useRef(null);
  const editorRef = useRef(null);
  const containerRef = useRef(null);

  // 创建 / 销毁 Monaco 编辑器（挂载即建；monaco 已随模块同步可用）
  // 编辑模式用 script.content 预填；script 变化（切换编辑对象）时重建以刷新内容
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: script?.content ?? '',
      language: 'shell',
      theme: readMonacoTheme(),
      minimap: { enabled: false },
      automaticLayout: true,
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      tabSize: 2,
      renderWhitespace: 'none',
      // 代码提示：输入即弹出、触发字符（含 `$`）时弹出
      // fixedOverflowWidgets: 让补全/悬浮等浮层以 position:fixed 挂到 body，
      // 避免被 .monaco-host 的 overflow:hidden 裁掉导致"提示不显示"
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: 'currentDocument',
      fixedOverflowWidgets: true,
      fontFamily: "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace",
    });
    editorRef.current = editor;
    setReady(true);
    return () => {
      editor.dispose();
      editorRef.current = null;
      setReady(false);
    };
  }, [open, script]);

  // 主题跟随：监听 <html data-theme> 变化，实时切换 Monaco 的 dark / light 主题
  useEffect(() => {
    if (!open) return undefined;
    const apply = () => editorRef.current?.updateOptions({ theme: readMonacoTheme() });
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [open]);

  // 打开时初始化表单并聚焦名称：
  //  - 编辑模式（script 存在）预填名称/分组/解释器；新增模式清空（默认 = 当前激活 shell）。
  //  - 不把 groups 放入依赖，否则新增分组会误清空正在填写的内容。
  //  - defaultShellChoice 刻意不列入依赖：shells 可能在面板开启后被 reloadShells 更新，
  //    若纳入依赖会在用户填写中途重置表单。
  useEffect(() => {
    if (!open) return;
    setName(script ? script.name : '');
    setGroup(script ? script.group : '');
    setShellChoice(script?.shell || defaultShellChoice);
    setError('');
    const t = setTimeout(() => nameRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, script]);

  // 仅允许 ESC 与 Close 按钮关闭
  useEscapeKey(open, onClose);

  if (!open) return null;

  const trimmed = name.trim();
  const nameEmpty = trimmed.length === 0;
  const nameTooLong = name.length > MAX_NAME;
  const groupEmpty = !group;
  const valid = !nameEmpty && !nameTooLong && !groupEmpty;
  const canSave = valid && ready;

  // 按校验优先级返回第一条错误（无错误返回 null）
  const buildNameError = () => {
    if (nameEmpty) return 'Script name is required';
    if (nameTooLong) return `Name too long (max ${MAX_NAME})`;
    return 'Please select a group';
  };

  const handleSave = () => {
    if (!valid) {
      setError(buildNameError());
      return;
    }
    const content = editorRef.current?.getValue() ?? '';
    onSave({
      id: script ? script.id : undefined,
      name: trimmed,
      group,
      content,
      shell: shellChoice,
    });
  };

  return (
    <aside className="editor-panel" role="region" aria-label="Add or edit script">
      <div className="editor-panel__head">
        <span className="editor-panel__title">{script ? 'Edit Script' : 'Add Script'}</span>
        <button className="modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="editor-panel__body">
        <label className="field">
          <span className="field__label">Script Name</span>
          <input
            ref={nameRef}
            className={`field__input ${nameEmpty && error ? 'is-error' : ''}`}
            type="text"
            value={name}
            maxLength={MAX_NAME}
            placeholder="e.g. deploy-build"
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') onClose();
            }}
          />
          <div className="field__meta">
            <span className="field__hint">Required · max {MAX_NAME} characters</span>
            <span className={`field__counter ${nameTooLong ? 'is-error' : ''}`}>
              {name.length}/{MAX_NAME}
            </span>
          </div>
        </label>

        <label className="field">
          <span className="field__label">Group</span>
          <select
            className={`field__input ${groupEmpty && error ? 'is-error' : ''}`}
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              if (error) setError('');
            }}
          >
            {groups.length === 0 && !group ? (
              <option value="" disabled>
                (Add a group first from the top bar)
              </option>
            ) : (
              <>
                <option value="">Select a group…</option>
                {/* 编辑模式下若原分组已不在 groups 列表，也保留为可选项 */}
                {[...new Set([group, ...groups].filter(Boolean))].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </>
            )}
          </select>
          <div className="field__meta">
            <span className="field__hint">
              {groups.length === 0 ? 'No groups yet — add one first' : 'Required'}
            </span>
          </div>
        </label>

        <label className="field">
          <span className="field__label">Shell</span>
          <select
            className="field__input"
            value={shellChoice}
            onChange={(e) => setShellChoice(e.target.value)}
          >
            {shells.length === 0 ? (
              <option value="" disabled>
                (No shell detected — uses system default)
              </option>
            ) : (
              shells.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.name || s.path}
                </option>
              ))
            )}
          </select>
          <div className="field__meta">
            <span className="field__hint">
              {shellChoice
                ? 'Uses this specific interpreter for this script'
                : `Uses the app global shell (${globalShellPath ? globalShellPath : 'system default'})`}
            </span>
          </div>
        </label>

        <div className="field editor-panel__editor">
          <span className="field__label">Script Content</span>
          <div className="monaco-host" ref={containerRef} />
        </div>

        {error && <div className="modal__error">{error}</div>}
      </div>

      <div className="editor-panel__foot">
        <button className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn btn--blue" disabled={!canSave} onClick={handleSave}>
          Save
        </button>
      </div>
    </aside>
  );
}
