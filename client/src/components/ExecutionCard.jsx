import { useEffect, useRef, useState } from 'react';
import { IconArrowDown, IconRefresh, IconExpand } from './Icons.jsx';

/**
 * 单个脚本的执行输出卡（按截图）：
 *  头部分两段：
 *    左：[分组徽章] [脚本名] [耗时] [相对时间]
 *    右：Exit: 0  贴底↓  重新执行↻  最大化⤢  Close
 *  体：输出文本区，超出高度出现自定义滚动条；底部状态条
 */
export default function ExecutionCard({ exec, onClose, onRerun, onToggleStick }) {
  const [now, setNow] = useState(Date.now());
  const outRef = useRef(null);

  // 时间"多久前"每秒刷新
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 贴底：内容变化或贴底开关打开时滚到底
  useEffect(() => {
    const el = outRef.current;
    if (!el) return;
    if (exec.stickToBottom) el.scrollTop = el.scrollHeight;
  }, [exec.lines.length, exec.stickToBottom]);

  const ago = formatAgo(now - exec.startedAt);
  const groupBadge = exec.group.startsWith('BACKEND') ? 'BE' : 'FE';

  return (
    <article className={`exec-card ${exec.maximized ? 'is-max' : ''}`}>
      <header className="exec-card__head">
        <div className="exec-card__head-left">
          <span className={`badge badge--${groupBadge.toLowerCase()}`}>{groupBadge}</span>
          <span className="exec-card__name">{exec.name}</span>
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
          <button className="icon-btn" title="Maximize" onClick={() => onRerun(exec.id, 'max')}>
            <IconExpand />
          </button>
          <button className="exec-card__close" onClick={() => onClose(exec.id)}>
            Close
          </button>
        </div>
      </header>

      <div className="exec-card__body" ref={outRef}>
        <pre className="exec-card__output">{exec.lines.join('\n')}</pre>
      </div>

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
