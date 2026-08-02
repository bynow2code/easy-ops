import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconExternal } from './Icons.jsx';
import {
  readFrontendShells,
  writeFrontendShells,
  readFrontendNoShellMode,
  writeFrontendNoShellMode,
} from '../shellStore.js';
import { shellApi } from '../shellApi.js';

/**
 * 设置（Settings）模态框
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
  const [backendPort, setBackendPort] = useState(null); // 后端监听的实际端口（Electron 内由 port.txt 读出）
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
      // 通过 HTTP 拉取后端检测到的 shell（Electron 走端口、纯 dev 走代理）；
      // 后端不可达时退化到 localStorage 的前端态
      try {
        const st = await shellApi.list();
        if (!cancelled) setShellState(st);
      } catch {
        if (!cancelled) {
          setShellState({
            noShellMode: readFrontendNoShellMode(),
            shells: readFrontendShells(),
            activeShellPath: null,
          });
        }
      }
      // 后端实际端口：Electron 内由 port.txt 读出（getPort 带重试等后端就绪）；
      // 纯 Vite dev 无此 IPC，保持 null → 界面显示 "—"。
      if (api?.backend?.getPort) {
        let port = null;
        for (let i = 0; i < 20; i++) {
          port = await api.backend.getPort();
          if (port) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        if (!cancelled) setBackendPort(port);
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

  // 把路径转成 shell 可直接粘贴的写法：除 a-zA-Z0-9 / . _ - : @ + , 之外的字符
  // 用反斜杠前缀转义（POSIX shell 转义规则）。
  // 例：/Users/x/Application Support/a.log -> /Users/x/Application\ Support/a.log
  const shellQuote = (p) => {
    const s = String(p ?? '');
    if (!s || s === '—') return s;
    return s.replace(/([^a-zA-Z0-9/._\-:@+,])/g, '\\$1');
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
    try {
      setShellState(await shellApi.list());
    } catch {
      /* 保留当前态 */
    }
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

  const onInstallUpdate = async () => {
    if (!api?.updater?.install) return;
    try {
      await api.updater.install();
    } catch {
      showFlash('err', 'Failed to restart for update');
    }
  };

  const onToggleNoShell = async (e) => {
    const next = e.target.checked;
    try {
      await shellApi.setNoShellMode(next);
      await reloadShells();
    } catch (err) {
      // 后端不可达（纯 dev 没起 server）：本地兜底（仅前端态、不持久化到后端）
      if (err && err.isNetwork) {
        writeFrontendNoShellMode(next);
        setShellState((prev) => ({ ...prev, noShellMode: next }));
        showFlash('info', 'No Shell Mode (frontend only — backend offline)');
        return;
      }
      showFlash('err', 'Failed to toggle No Shell Mode');
    }
  };

  // 把一条 shell 路径加入列表：走后端 HTTP（会落盘 shell-config.json，且后端做完整校验）。
  //  - 后端显式拒绝（路径非法 / 已存在 等）：提示错误，绝不本地偷偷添加。
  //  - 仅当后端真的不可达（纯 dev 没起 server）才本地兜底，并明确标注"非持久化"。
  const addShellByPath = async (p) => {
    if (!p) return;
    try {
      const res = await shellApi.add(p);
      if (res?.ok) {
        setShellState((prev) => ({ ...prev, shells: res.shells }));
        return;
      }
      // 后端显式拒绝：直接提示，不兜底添加
      if (res?.error) {
        showFlash('err', res.error);
        return;
      }
    } catch (err) {
      if (err && err.isNetwork) {
        // 后端确实不可达：本地兜底（仅前端态、不持久化）
        setShellState((prev) => {
          if (prev.shells.some((s) => s.path === p)) return prev;
          const name = p.split(/[\\/]/).pop() || p;
          const next = { ...prev, shells: [...prev.shells, { path: p, name, custom: true }] };
          writeFrontendShells(next.shells);
          return next;
        });
        showFlash('info', 'Added (frontend only — backend offline)');
        return;
      }
      showFlash('err', (err && err.message) || 'Add failed');
    }
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
    try {
      const res = await shellApi.setActive(path || null);
      if (res?.ok) {
        setShellState({
          noShellMode: res.noShellMode,
          shells: res.shells,
          activeShellPath: res.activeShellPath,
        });
      } else if (res?.error) {
        showFlash('err', res.error);
      }
    } catch (err) {
      showFlash('err', (err && err.message) || 'Failed to set active');
    }
  };

  // 移除一条自定义 shell：激活的不可移除（后端也兜底拒绝）。
  // 后端显式拒绝（如"正在使用"）时提示错误，绝不本地偷偷移除。
  const onRemoveShell = async (p) => {
    if (!p) return;
    try {
      const res = await shellApi.remove(p);
      if (res?.ok) {
        setShellState({
          noShellMode: res.noShellMode,
          shells: res.shells,
          activeShellPath: res.activeShellPath,
        });
        showFlash('ok', 'Removed');
        return;
      }
      if (res?.error) {
        showFlash('err', res.error);
        return;
      }
    } catch (err) {
      if (err && err.isNetwork) {
        // 后端不可达：本地兜底移除（仅前端态）；激活的同样不动
        setShellState((prev) => {
          if (prev.activeShellPath === p) return prev;
          const next = { ...prev, shells: prev.shells.filter((s) => s.path !== p) };
          writeFrontendShells(next.shells);
          return next;
        });
        showFlash('info', 'Removed (frontend only — backend offline)');
        return;
      }
      showFlash('err', (err && err.message) || 'Failed to remove');
    }
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
          <span className="modal__title">Settings</span>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body modal__body--settings">
          <SettingsGroup title="About">
            <Section label="Version">
              <div className="settings-row">
                <span className="settings-value">{version}</span>
                <button className="btn btn--ghost btn--sm" disabled={busy} onClick={onCheckUpdates}>
                  {busy ? 'Checking…' : 'Check Updates'}
                </button>
              </div>
              {updateResult && (
                <UpdateBanner result={updateResult} onOpen={openLink} onInstall={onInstallUpdate} />
              )}
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
          </SettingsGroup>

          <SettingsGroup title="Shells">
            <Section label="No Shell Mode">
              <div className="settings-mode">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={shellState.noShellMode}
                    onChange={onToggleNoShell}
                  />
                  <span>No Shell Mode (simulate no bash installed)</span>
                </label>
                <p className="settings-mode__hint">
                  For testing startup &amp; execution behavior when no shell is available.
                </p>
              </div>
            </Section>

            <Section label="Active Shell">
              {currentShell ? (
                <>
                  <div className="settings-current-shell">
                    <span className="settings-pill">{currentShell.name?.toUpperCase()}</span>
                  </div>
                  <div className="settings-path-row">
                    <code className="settings-path">{shellQuote(currentShell.path)}</code>
                    <CopyButton text={shellQuote(currentShell.path)} onCopy={copy} />
                  </div>
                </>
              ) : (
                <div className="settings-muted">No shell selected</div>
              )}
            </Section>

            <Section label="Shell List">
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
              {flash && (
                <div className="settings-add-flash">
                  <span className={`settings-flash settings-flash--${flash.kind}`}>{flash.text}</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={onFilePicked}
              />
            </Section>
          </SettingsGroup>

          <SettingsGroup title="Paths & Ports">
            <Section label="Scripts Config">
              <div className="settings-path-row">
                <code className="settings-path">{shellQuote(scriptsConfig)}</code>
                <CopyButton text={shellQuote(scriptsConfig)} onCopy={copy} />
              </div>
            </Section>

            <Section label="Log File">
              <div className="settings-path-row">
                <code className="settings-path">{shellQuote(logFile)}</code>
                <CopyButton text={shellQuote(logFile)} onCopy={copy} />
              </div>
            </Section>

            <Section label="Backend">
              <div className="settings-path-row">
                <span className="settings-path">{backendPort ?? '—'}</span>
                {backendPort ? <CopyButton text={String(backendPort)} onCopy={copy} /> : null}
              </div>
            </Section>
          </SettingsGroup>
        </div>

        <div className="modal__foot modal__foot--settings">
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

function SettingsGroup({ title, children }) {
  return (
    <section className="settings-group">
      <h2 className="settings-group__title">{title}</h2>
      <div className="settings-group__body">{children}</div>
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

function UpdateBanner({ result, onOpen, onInstall }) {
  if (result.error) {
    return (
      <div className="settings-update settings-update--err">
        Update check failed: {result.error}
      </div>
    );
  }
  if (result.hasUpdate === true) {
    if (result.downloaded) {
      return (
        <div className="settings-update settings-update--new">
          Update <strong>v{result.latest}</strong> downloaded.{' '}
          <button
            type="button"
            className="settings-link-inline"
            onClick={() => onInstall && onInstall()}
          >
            Restart to update
          </button>
        </div>
      );
    }
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
