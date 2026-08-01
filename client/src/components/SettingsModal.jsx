import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconExternal } from './Icons.jsx';
import { readFrontendShells, writeFrontendShells } from '../shellStore.js';

/**
 * 设置（App Info）模态框
 * ------------------------------------------------------------------
 * 通过 window.easyOps（由 electron/preload.js 暴露）与主进程通信：
 *  - app.getInfo      版本 / GitHub / 路径
 *  - app.checkUpdates 拉 GitHub releases API 比对最新版
 *  - shell.list/choose/add/setActive/getNoShellMode/setNoShellMode
 *  - app.copyToClipboard / app.openExternal
 *
 * 设计要点：
 *  - 关闭方式遵循项目约定：仅 ESC 与 × 按钮
 *  - 全部数值由主进程提供；未挂载 Electron 时（如 npm run dev 单独起 Vite）优雅退化
 *    到 "—" 占位，避免页面崩溃
 *  - 路径旁 Copy 按钮使用 Electron 剪贴板；浏览器回退用 navigator.clipboard
 */

const GITHUB_FALLBACK = 'https://github.com/bynow2code/easy-ops';

export default function SettingsModal({ open, onClose }) {
  const api = typeof window !== 'undefined' ? window.easyOps : null;

  const [appInfo, setAppInfo] = useState(null);
  const [shellState, setShellState] = useState({
    noShellMode: false,
    shells: [],
    activeShellPath: null,
  });
  const [customPath, setCustomPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // { kind: 'ok'|'err'|'info', text }
  const [updateResult, setUpdateResult] = useState(null); // { hasUpdate, latest, current, releaseUrl, error }
  const fileInputRef = useRef(null); // 无后端时用于 <input type="file"> 前端选路径

  // 打开时拉取数据；关闭时清空避免下次残留
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (api?.app?.getInfo) {
        const info = await api.app.getInfo();
        if (!cancelled) setAppInfo(info);
      }
      if (api?.shell?.list) {
        const st = await api.shell.list();
        if (!cancelled) setShellState(st);
      } else {
        // 无 Electron 后端：从 localStorage 恢复前端态自定义 shell,
        // 否则列表为空、关闭后 Add/Edit Script 选不到这些 shell
        if (!cancelled) {
          setShellState({
            noShellMode: false,
            shells: readFrontendShells(),
            activeShellPath: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, api]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const showFlash = (kind, text) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash((f) => (f && f.text === text ? null : f)), 1800);
  };

  // 仅负责写入剪贴板，返回是否成功；成功反馈由各自按钮就地显示，
  // 不再占用底部 flash（否则"Copied"会显示在 Close 按钮所在的页脚栏）。
  const copy = async (text) => {
    try {
      if (api?.app?.copyToClipboard) {
        await api.app.copyToClipboard(text);
      } else if (navigator?.clipboard) {
        await navigator.clipboard.writeText(String(text ?? ''));
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const openLink = async (url) => {
    try {
      if (api?.app?.openExternal) {
        await api.app.openExternal(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      showFlash('err', 'Open failed');
    }
  };

  const reloadShells = async () => {
    if (!api?.shell?.list) return;
    setShellState(await api.shell.list());
  };

  const onCheckUpdates = async () => {
    if (!api?.app?.checkUpdates) return;
    setBusy(true);
    setUpdateResult(null);
    try {
      const res = await api.app.checkUpdates();
      setUpdateResult(res);
    } catch (err) {
      setUpdateResult({ hasUpdate: null, error: String((err && err.message) || err) });
    } finally {
      setBusy(false);
    }
  };

  const onToggleNoShell = async (e) => {
    if (!api?.shell?.setNoShellMode) return;
    const next = e.target.checked;
    await api.shell.setNoShellMode(next);
    await reloadShells();
  };

  // 把一条 shell 路径加入列表：优先走 Electron IPC（会落盘 shell-config.json）；
  // 无后端（如纯 Vite 开发）时本地入列表并提示"仅前端态、不持久化"。
  const addShellByPath = async (p) => {
    if (!p) return;
    if (api?.shell?.add) {
      const res = await api.shell.add(p);
      if (res?.ok) {
        setShellState((prev) => ({ ...prev, shells: res.shells }));
      } else if (res?.error) {
        showFlash('err', res.error);
      }
      return;
    }
    setShellState((prev) => {
      if (prev.shells.some((s) => s.path === p)) return prev;
      const name = p.split(/[\\/]/).pop() || p;
      const next = { ...prev, shells: [...prev.shells, { path: p, name, custom: true }] };
      writeFrontendShells(next.shells);
      return next;
    });
    showFlash('info', 'Added (frontend only — backend offline)');
  };

  const onBrowseShell = async () => {
    // 有 Electron 时用原生对话框（走 IPC）
    if (api?.shell?.choose) {
      const picked = await api.shell.choose();
      if (!picked) return; // 用户取消
      if (picked.probeFailed) showFlash('info', 'Saved (could not read --version)');
      await addShellByPath(picked.path);
      setCustomPath('');
      return;
    }
    // 无后端：用隐藏的 <input type="file"> 调起系统文件选择（前端即可用）
    fileInputRef.current?.click();
  };

  const onFilePicked = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    // Electron 下 file.path 为完整路径；纯浏览器环境仅有 file.name
    const p = file.path || file.name;
    await addShellByPath(p);
    setCustomPath('');
  };

  const onAddTypedPath = async () => {
    const p = customPath.trim();
    if (!p) return;
    await addShellByPath(p);
    setCustomPath('');
  };

  const onSetActive = async (path) => {
    if (!api?.shell?.setActive) return;
    const res = await api.shell.setActive(path || null);
    if (res?.ok) {
      setShellState({
        noShellMode: res.noShellMode,
        shells: res.shells,
        activeShellPath: res.activeShellPath,
      });
    } else if (res?.error) {
      showFlash('err', res.error);
    }
  };

  // 移除一条自定义 shell：激活的不可移除（后端也兜底拒绝）。
  const onRemoveShell = async (p) => {
    if (!p) return;
    if (api?.shell?.remove) {
      const res = await api.shell.remove(p);
      if (res?.ok) {
        setShellState({
          noShellMode: res.noShellMode,
          shells: res.shells,
          activeShellPath: res.activeShellPath,
        });
        showFlash('ok', 'Removed');
      } else if (res?.error) {
        showFlash('err', res.error);
      }
      return;
    }
    // 无后端：本地移除（仅前端态）；激活的同样不动
    setShellState((prev) => {
      if (prev.activeShellPath === p) return prev;
      const next = { ...prev, shells: prev.shells.filter((s) => s.path !== p) };
      writeFrontendShells(next.shells);
      return next;
    });
    showFlash('info', 'Removed (frontend only — backend offline)');
  };

  const githubUrl = appInfo?.githubUrl || GITHUB_FALLBACK;
  const version = appInfo?.version || '—';
  const currentShell = shellState.activeShellPath
    ? shellState.shells.find((s) => s.path === shellState.activeShellPath)
    : shellState.shells[0];
  const scriptsConfig = appInfo?.paths?.scriptsConfig || '—';
  const logFile = appInfo?.paths?.logFile || '—';

  return (
    <div className="modal-overlay">
      <div className="modal modal--settings" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal__head">
          <span className="modal__title">App Info</span>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body modal__body--settings">
          <Section label="Version">
            <div className="settings-row">
              <span className="settings-value">{version}</span>
              <button className="btn btn--ghost btn--sm" disabled={busy} onClick={onCheckUpdates}>
                {busy ? 'Checking…' : 'Check Updates'}
              </button>
            </div>
            {updateResult && <UpdateBanner result={updateResult} onOpen={openLink} />}
          </Section>

          <Section label="GitHub">
            <button
              type="button"
              className="settings-link"
              onClick={() => openLink(githubUrl)}
              title={githubUrl}
            >
              {githubUrl}
              <IconExternal />
            </button>
          </Section>

          <Section label="Shell">
            {currentShell ? (
              <>
                <div className="settings-current-shell">
                  <span className="settings-pill">{currentShell.name?.toUpperCase()}</span>
                  <span className="settings-muted">{currentShell.version || ''}</span>
                </div>
                <div className="settings-path-row">
                  <code className="settings-path">{currentShell.path}</code>
                  <CopyButton text={currentShell.path} onCopy={copy} />
                </div>
              </>
            ) : (
              <div className="settings-muted">No shell selected</div>
            )}
          </Section>

          <Section label="Shells">
            <div className="settings-warning">
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={shellState.noShellMode}
                  onChange={onToggleNoShell}
                />
                <span>No Shell Mode (simulate no bash installed)</span>
              </label>
              <p className="settings-warning__hint">
                For testing startup &amp; execution behavior when no shell is available.
              </p>
            </div>

            {shellState.shells.length === 0 ? (
              <div className="settings-muted settings-muted--pad">
                {shellState.noShellMode ? 'No shells (No Shell Mode is on)' : 'No shells detected'}
              </div>
            ) : (
              <ul className="settings-shell-list">
                {shellState.shells.map((s) => {
                  const active =
                    s.path === (shellState.activeShellPath || shellState.shells[0]?.path);
                  const removable = s.custom && !active;
                  return (
                    <li
                      key={s.path}
                      className={`settings-shell-card ${active ? 'is-active' : ''}`}
                      onClick={() => !s.custom && onSetActive(s.path)}
                      title={
                        s.custom
                          ? active
                            ? 'Active shell — cannot remove'
                            : 'Custom shell — click × to remove'
                          : 'Click to set as active'
                      }
                    >
                      <div className="settings-shell-card__head">
                        <span className="settings-pill">{s.name}</span>
                        <span className="settings-muted settings-shell-card__version">
                          {s.version || ''}
                        </span>
                        {active && (
                          <span className="settings-active-badge">
                            <IconCheck /> Active
                          </span>
                        )}
                        {removable && (
                          <button
                            type="button"
                            className="settings-shell-card__remove"
                            title="Remove this custom shell"
                            aria-label="Remove this custom shell"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveShell(s.path);
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <code className="settings-shell-card__path">{s.path}</code>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="settings-add-row">
              <input
                className="field__input"
                type="text"
                value={customPath}
                placeholder="Add a bash path, e.g. C:\\tools\\git\\bin\\bash.exe or /opt/homebrew/bin/bash"
                onChange={(e) => setCustomPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onAddTypedPath();
                  if (e.key === 'Escape') onClose();
                }}
              />
              <button className="btn btn--ghost btn--sm" onClick={onBrowseShell}>
                Browse
              </button>
              <button
                className="btn btn--blue btn--sm"
                onClick={onAddTypedPath}
                disabled={!customPath.trim()}
              >
                Add
              </button>
            </div>
            {/* 无后端时的前端文件选择回退；Electron 下优先走 dialog.showOpenDialog */}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={onFilePicked}
            />
          </Section>

          <Section label="Scripts Config">
            <div className="settings-path-row">
              <code className="settings-path">{scriptsConfig}</code>
              <CopyButton text={scriptsConfig} onCopy={copy} />
            </div>
          </Section>

          <Section label="Log File">
            <div className="settings-path-row">
              <code className="settings-path">{logFile}</code>
              <CopyButton text={logFile} onCopy={copy} />
            </div>
          </Section>
        </div>

        <div className="modal__foot modal__foot--settings">
          {flash && (
            <span className={`settings-flash settings-flash--${flash.kind}`}>{flash.text}</span>
          )}
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section__label">{label}</h3>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

// 就地显示复制反馈的按钮：点击后短暂变为 "✓ Copied"（失败则 "Copy failed"），
// 反馈紧贴按钮本身，避免占用页脚 flash 而与 Close 按钮位置混淆。
function CopyButton({ text, onCopy, label = 'Copy' }) {
  const [state, setState] = useState(null); // null | 'ok' | 'err'
  const onClick = async () => {
    const ok = await onCopy(text);
    setState(ok ? 'ok' : 'err');
    setTimeout(() => setState(null), ok ? 1500 : 1800);
  };
  return (
    <button
      type="button"
      className={`btn btn--ghost btn--sm ${state === 'ok' ? 'is-ok' : ''}`}
      onClick={onClick}
      title="Copy"
    >
      {state === 'ok' ? '✓ Copied' : state === 'err' ? 'Copy failed' : label}
    </button>
  );
}

function UpdateBanner({ result, onOpen }) {
  if (result.error) {
    return (
      <div className="settings-update settings-update--err">
        Update check failed: {result.error}
      </div>
    );
  }
  if (result.hasUpdate === true) {
    return (
      <div className="settings-update settings-update--new">
        New version <strong>v{result.latest}</strong> available.{' '}
        <button
          type="button"
          className="settings-link-inline"
          onClick={() => onOpen(result.releaseUrl)}
        >
          Open release
        </button>
      </div>
    );
  }
  if (result.hasUpdate === false) {
    return (
      <div className="settings-update settings-update--ok">
        You&apos;re up to date (v{result.current}).
      </div>
    );
  }
  return null;
}
