import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IconRefresh, IconExpand, IconStop } from './Icons.jsx';
import { resolveShellPath } from '../shellUtils.js';
import { mockOutputFor } from '../data/mockScripts.js';
import { ptyClient } from '../ptyClient.js';

// Xterm 配色：跟随应用主题（dark / light），采用 VS Code 风格 ANSI 色板，
// 保证深色 / 浅色下 ANSI 转义色都可读，不再写死黑底。
const XTERM_THEME = {
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
    scrollbarSliderBackground: '#d1d5db',
    scrollbarSliderHoverBackground: '#9ca3af',
    scrollbarSliderActiveBackground: '#6b7280',
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2937',
    cursor: '#1f2937',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#948b12',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ceb8',
    brightYellow: '#948b12',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#ffffff',
    scrollbarSliderBackground: '#d1d5db',
    scrollbarSliderHoverBackground: '#9ca3af',
    scrollbarSliderActiveBackground: '#6b7280',
  },
};

// 读取当前生效主题（useTheme 已把真实 dark/light 写到 <html data-theme>）
function readDomTheme() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * 单个脚本的执行输出卡：
 *  头部分两段：
 *    左：[分组徽章] [脚本名] [耗时] [相对时间]
 *    右：重新执行↻  停止■  最大化⤢  Close
 *  体：真实 PTY 模式下用 xterm 渲染流式输出；非 Electron 环境回退为文本 <pre>。
 *  滚动：xterm 保持其自然行为（视口在底部时新输出自动跟进）；文本回退模式每次新输出后
 *    直接滚到底部。旧版"回到底部"浮钮已移除。
 *
 * 平台差异（Unix 进程组 / Windows 进程树）已封死在主进程 pty-host，
 * 本卡只负责"渲染 + 触发 onStop"，不感知任何平台分支。
 */
export default function ExecutionCard({ exec, globalShellPath, shells, onClose, onRerun, onStop }) {
  const outRef = useRef(null); // 文本回退模式的滚动容器
  const termRef = useRef(null); // xterm 容器
  const termObj = useRef(null);
  const fitObj = useRef(null);
  const sessionIdRef = useRef(exec.sessionId || null);
  const prevSessionRef = useRef(undefined); // 记录上一次 sessionId，区分"首次挂载"与"重跑"
  // 仅当运行在 Electron 且会话为真实 PTY 时才挂载 xterm
  const usingXterm = exec.mode === 'pty' && ptyClient.available;

  // —— 运行状态自治：status / lines 由本卡自己维护，App 不再持有 ——
  const [status, setStatus] = useState('running'); // running | exited
  const [lines, setLines] = useState([]); // mock 模式的流式输出
  const stoppedRef = useRef(false); // mock 流停止标记（Stop 点击 / 卸载时置位）

  // 订阅 PTY 退出事件：仅当与当前会话一致才翻 exited，忽略"重跑杀旧会话"的残留 exit
  useEffect(() => {
    const off = ptyClient.onExit(({ execId, sessionId }) => {
      if (
        execId !== exec.id ||
        (sessionId && sessionIdRef.current && sessionId !== sessionIdRef.current)
      )
        return;
      setStatus('exited');
    });
    return off;
  }, [exec.id]);

  // mock 模式：模拟输出流自管。依赖 exec.sessionId（运行实例 id）——初次挂载与重跑
  // 都会触发新实例从而重启流；bootError 存在时直接显示错误并以 exited 结束。
  useEffect(() => {
    if (usingXterm) return; // PTY 模式由 xterm + onExit 接管
    stoppedRef.current = false;
    setStatus('running');
    if (exec.bootError) {
      setLines([exec.bootError]);
      setStatus('exited');
      return;
    }
    const seq = mockOutputFor(exec.name);
    setLines([seq[0]]);
    let i = 1;
    let timer;
    const tick = () => {
      if (stoppedRef.current) return;
      if (i >= seq.length) {
        setStatus('exited');
        return;
      }
      setLines(seq.slice(0, i + 1));
      i += 1;
      timer = setTimeout(tick, 80);
    };
    timer = setTimeout(tick, 120);
    return () => {
      clearTimeout(timer);
      stoppedRef.current = true;
    };
  }, [usingXterm, exec.sessionId, exec.bootError, exec.name]);

  useEffect(() => {
    sessionIdRef.current = exec.sessionId || null;
  }, [exec.sessionId]);

  // 文本回退模式：每次有新输出后直接滚到底部（始终跟随最新输出）。
  useEffect(() => {
    const el = outRef.current;
    if (!el || usingXterm) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, usingXterm]);

  // xterm 生命周期：挂载时建实例、订阅本卡流式输出；卸载/换会话时清理
  useEffect(() => {
    if (!usingXterm || !termRef.current) return undefined;
    const hostEl = termRef.current; // 整个 effect 生命周期内稳定，统一用它挂/卸监听
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: 1.2,
      cursorBlink: true,
      theme: XTERM_THEME[readDomTheme()],
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostEl);
    termObj.current = term;
    fitObj.current = fit;
    try {
      fit.fit();
    } catch {
      /* 容器未布局时可能失败，忽略 */
    }

    // 容器尺寸变化（仅一张卡占满整列、其它卡关闭/打开、窗口缩放、最大化等）时
    // 重新 fit：否则 xterm 仍按首次挂载高度渲染，终端下方留白且不随卡片变高而撑大。
    let resizeObserver;
    try {
      resizeObserver = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* 容器未布局时可能失败，忽略 */
        }
      });
      resizeObserver.observe(hostEl);
    } catch {
      /* 旧环境无 ResizeObserver，退化为不自动重适配（不影响功能） */
    }

    const offData = ptyClient.onData(({ execId, data }) => {
      if (execId !== exec.id) return;
      // 仅写入数据；是否跟随由 xterm 自然行为决定（见上方说明）。
      term.write(data);
    });

    // 输入回环：屏幕上的按键 → 进程（交互支持）。
    // sessionId 用 ref 读最新值（Re-run 后 session 会变，本 effect 不重挂载）。
    const offInput = term.onData((d) => {
      if (sessionIdRef.current) ptyClient.write(sessionIdRef.current, d);
    });

    // 点击终端聚焦，否则 xterm 收不到键盘（默认不自动聚焦，避免抢焦点）
    const container = hostEl;
    const focusTerm = () => term.focus();
    container.addEventListener('click', focusTerm);

    return () => {
      offData();
      offInput.dispose();
      container.removeEventListener('click', focusTerm);
      if (resizeObserver) resizeObserver.disconnect();
      try {
        term.dispose();
      } catch {
        /* noop */
      }
      termObj.current = null;
      fitObj.current = null;
    };
  }, [usingXterm, exec.id]);

  // 重新执行（同一卡片、sessionId 变化）：清空旧终端输出，新会话从干净界面开始。
  // exec.id 不变 → xterm 实例不重建，仅 reset 屏幕，实现"当前窗口内重跑脚本"。
  // 用 prevSessionRef 区分首次挂载（不误清初始化输出）与真正的 re-run。
  useEffect(() => {
    const term = termObj.current;
    const prev = prevSessionRef.current;
    prevSessionRef.current = exec.sessionId;
    if (!usingXterm) return; // mock 由上方 mock effect 管 running/exited
    setStatus('running'); // 新会话 / 重跑：回到运行中（PTY 自治）
    if (!term) return;
    if (prev != null && exec.sessionId && prev !== exec.sessionId) {
      term.reset();
    }
  }, [exec.sessionId, usingXterm]);

  // 主题跟随：监听 <html data-theme> 变化（含手动切换与 system 跟随 OS），
  // 实时更新已挂载 xterm 的配色；不重建终端，仅改 options.theme。
  useEffect(() => {
    if (!usingXterm) return undefined;
    const apply = () => {
      const t = readDomTheme();
      if (termObj.current) termObj.current.options.theme = XTERM_THEME[t];
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [usingXterm]);

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

  const groupLabel = exec.group || 'Ungrouped';

  // Stop：PTY 交给 App 的 onStop 去 kill 会话；mock 由本卡本地终止自己的流并翻 exited
  const handleStop = () => {
    onStop(exec.id);
    stoppedRef.current = true;
    setStatus('exited');
  };

  // 统一只显示具体解释器名称（移除原 'global' 概念；旧 'global' 数据经 resolveShellPath 仍解析为全局壳）。
  // 找不到匹配名称时，从路径取 basename（如 /bin/zsh → zsh），而非显示完整路径；
  // 完整路径保留在 title 上便于溯源。
  const effectivePath = resolveShellPath(exec.shell, globalShellPath);
  const matchedShell = effectivePath ? shells.find((s) => s.path === effectivePath) : null;
  const shellName =
    matchedShell?.name || (effectivePath ? effectivePath.split(/[\\/]/).pop() : 'system default');

  // 标题栏状态指示：bootError 视为 Error，否则按 running/exited 显示。
  const statusInfo = exec.bootError
    ? { label: 'Error', tone: 'err' }
    : status === 'running'
      ? { label: 'Running', tone: 'run' }
      : { label: 'Exited', tone: 'done' };

  return (
    <article className={`exec-card ${exec.maximized ? 'is-max' : ''}`}>
      <header className="exec-card__head">
        <div className="exec-card__head-left">
          <span className={`badge badge--${badgeVariant(groupLabel)}`}>{groupLabel}</span>
          <span className="exec-card__name">{exec.name}</span>
          <span
            className={`exec-card__status exec-card__status--${statusInfo.tone}`}
            title={statusInfo.label}
          >
            <span className="exec-card__status-dot" />
            {statusInfo.label}
          </span>
          <span
            className="exec-card__meta exec-card__meta--shell"
            title={effectivePath || 'system default'}
          >
            {shellName}
          </span>
        </div>
        <div className="exec-card__head-right">
          <button className="icon-btn" title="Re-run" onClick={() => onRerun(exec.id)}>
            <IconRefresh />
          </button>
          {status === 'running' && (
            <button className="icon-btn icon-btn--stop" title="Stop" onClick={handleStop}>
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

      <div className="exec-card__view">
        {usingXterm ? (
          <div className="exec-card__term">
            <div className="exec-card__term-host" ref={termRef} />
          </div>
        ) : (
          <div className="exec-card__body" ref={outRef}>
            <pre className="exec-card__output">{lines.join('\n')}</pre>
          </div>
        )}
      </div>
    </article>
  );
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
