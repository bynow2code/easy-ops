import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IconArrowDown, IconRefresh, IconExpand, IconStop } from './Icons.jsx';
import { resolveShellPath } from '../shellUtils.js';
import { ptyClient } from '../ptyClient.js';

/**
 * 单个脚本的执行输出卡（按截图）：
 *  头部分两段：
 *    左：[分组徽章] [脚本名] [耗时] [相对时间]
 *    右：Exit: 0  贴底↓  重新执行↻  停止■  最大化⤢  Close
 *  体：真实 PTY 模式下用 xterm 渲染流式输出；非 Electron 环境回退为文本 <pre>。
 *
 * 平台差异（Unix 进程组 / Windows 进程树）已封死在主进程 pty-host，
 * 本卡只负责"渲染 + 触发 onStop"，不感知任何平台分支。
 */
export default function ExecutionCard({
  exec,
  globalShellPath,
  shells,
  onClose,
  onRerun,
  onToggleStick,
  onStop,
}) {
  const [now, setNow] = useState(Date.now());
  const outRef = useRef(null); // 文本回退模式的滚动容器
  const termRef = useRef(null); // xterm 容器
  const termObj = useRef(null);
  const fitObj = useRef(null);
  const sessionIdRef = useRef(exec.sessionId || null);

  // 仅当运行在 Electron 且会话为真实 PTY 时才挂载 xterm
  const usingXterm = exec.mode === 'pty' && ptyClient.available;

  useEffect(() => {
    sessionIdRef.current = exec.sessionId || null;
  }, [exec.sessionId]);

  // 时间"多久前"每秒刷新
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 文本回退模式：贴底滚动（xterm 自带滚动，无需处理）
  useEffect(() => {
    const el = outRef.current;
    if (!el || usingXterm) return;
    if (exec.stickToBottom) el.scrollTop = el.scrollHeight;
  }, [exec.lines?.length, exec.stickToBottom, usingXterm]);

  // xterm 生命周期：挂载时建实例、订阅本卡流式输出；卸载/换会话时清理
  useEffect(() => {
    if (!usingXterm || !termRef.current) return undefined;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      cursorBlink: false,
      theme: { background: '#1e1e1e' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    termObj.current = term;
    fitObj.current = fit;
    try {
      fit.fit();
    } catch {
      /* 容器未布局时可能失败，忽略 */
    }

    const offData = ptyClient.onData(({ execId, data }) => {
      if (execId === exec.id) term.write(data);
    });

    return () => {
      offData();
      try {
        term.dispose();
      } catch {
        /* noop */
      }
      termObj.current = null;
      fitObj.current = null;
    };
  }, [usingXterm, exec.id]);

  // 容器尺寸变化：同步 cols/rows 给主进程会话
  useEffect(() => {
    if (!usingXterm || !termRef.current) return undefined;
    const ro = new ResizeObserver(() => {
      try {
        fitObj.current?.fit();
        if (sessionIdRef.current) {
          ptyClient.resize(sessionIdRef.current, termObj.current.cols, termObj.current.rows);
        }
      } catch {
        /* noop */
      }
    });
    ro.observe(termRef.current);
    return () => ro.disconnect();
  }, [usingXterm]);

  const ago = formatAgo(now - exec.startedAt);
  const groupLabel = exec.group || 'Ungrouped';

  const effectivePath = resolveShellPath(exec.shell, globalShellPath);
  const matchedShell = effectivePath ? shells.find((s) => s.path === effectivePath) : null;
  const shellName = matchedShell?.name || effectivePath || 'system default';

  return (
    <article className={`exec-card ${exec.maximized ? 'is-max' : ''}`}>
      <header className="exec-card__head">
        <div className="exec-card__head-left">
          <span className={`badge badge--${badgeVariant(groupLabel)}`}>{groupLabel}</span>
          <span className="exec-card__name">{exec.name}</span>
          <span
            className="exec-card__meta exec-card__meta--shell"
            title={effectivePath || 'system default'}
          >
            {exec.shell === 'global' ? 'Global' : 'Shell'}: {shellName}
          </span>
          <span className="exec-card__meta">{formatDuration(exec.duration)}</span>
          <span className="exec-card__meta">{ago}</span>
        </div>
        <div className="exec-card__head-right">
          <span
            className={`exec-card__exit ${exec.exit != null && exec.exit !== 0 ? 'is-fail' : 'is-ok'}`}
          >
            Exit: {exec.exit ?? '-'}
          </span>
          <button
            className={`icon-btn ${exec.stickToBottom ? 'is-on' : ''}`}
            title={exec.stickToBottom ? 'Stick to bottom' : 'Stick to bottom (off)'}
            onClick={() => onToggleStick(exec.id)}
          >
            <IconArrowDown />
          </button>
          <button className="icon-btn" title="Re-run" onClick={() => onRerun(exec.id)}>
            <IconRefresh />
          </button>
          {exec.status === 'running' && (
            <button
              className="icon-btn icon-btn--stop"
              title="Stop"
              onClick={() => onStop(exec.id)}
            >
              <IconStop />
            </button>
          )}
          <button className="icon-btn" title="Maximize" onClick={() => onRerun(exec.id, 'max')}>
            <IconExpand />
          </button>
          <button className="exec-card__close" onClick={() => onClose(exec.id)}>
            Close
          </button>
        </div>
      </header>

      {usingXterm ? (
        <div className="exec-card__term" ref={termRef} />
      ) : (
        <div className="exec-card__body" ref={outRef}>
          <pre className="exec-card__output">{exec.lines.join('\n')}</pre>
        </div>
      )}

      <footer className="exec-card__foot">
        <span className={`status-pill status-pill--${exec.status}`}>
          {exec.status === 'running' ? 'Running' : exec.status === 'idle' ? 'Idle' : 'Exited'}
        </span>
        <span className="exec-card__foot-meta">
          scroll to bottom: {exec.stickToBottom ? 'on' : 'off'}
        </span>
      </footer>
    </article>
  );
}

function formatDuration(ms) {
  if (!ms) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatAgo(ms) {
  if (ms < 1000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// 由分组名确定性地映射到一组配色变体，使同一分组视觉一致、不同分组可区分。
function badgeVariant(group) {
  const palette = ['1', '2', '3', '4'];
  let h = 0;
  for (let i = 0; i < group.length; i++) {
    h = (h * 31 + group.charCodeAt(i)) >>> 0;
  }
  return palette[h % palette.length];
}
