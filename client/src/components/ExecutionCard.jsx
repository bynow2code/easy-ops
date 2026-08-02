import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IconArrowDown, IconRefresh, IconExpand, IconStop } from './Icons.jsx';
import { resolveShellPath } from '../shellUtils.js';
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
 *  贴底（scroll to bottom）：由 xterm 自然行为承担（视口在底部时新输出自动跟进，
 *    上翻看历史时停在原处）；视口不在底部时浮出"回到底部"按钮（监听 scroll 判定）。
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
  onStop,
}) {
  const outRef = useRef(null); // 文本回退模式的滚动容器
  const termRef = useRef(null); // xterm 容器
  const termObj = useRef(null);
  const fitObj = useRef(null);
  const sessionIdRef = useRef(exec.sessionId || null);
  const prevSessionRef = useRef(undefined); // 记录上一次 sessionId，区分"首次挂载"与"重跑"
  const [atBottom, setAtBottom] = useState(true); // 视口是否在底部（决定是否显示"回到底部"按钮）
  const atBottomRef = useRef(true); // 供 scroll 回调 / 输出写入读取最新值
  const markAtBottom = (v) => {
    atBottomRef.current = v;
    setAtBottom(v);
  };

  // 仅当运行在 Electron 且会话为真实 PTY 时才挂载 xterm
  const usingXterm = exec.mode === 'pty' && ptyClient.available;

  useEffect(() => {
    sessionIdRef.current = exec.sessionId || null;
  }, [exec.sessionId]);

  // 文本回退模式：仅在"当前处于底部"时跟随最新输出（与 xterm 自然行为一致）；
  // 用户上翻看历史时不强制滚动，由下方 scroll 监听维持 atBottom 状态。
  useEffect(() => {
    const el = outRef.current;
    if (!el || usingXterm) return;
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [exec.lines?.length, usingXterm]);

  // 文本回退模式：监听容器滚动，维持 atBottom 状态（与 xterm 分支对称）
  useEffect(() => {
    if (usingXterm) return undefined;
    const el = outRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      markAtBottom(distance < 2);
    };
    el.addEventListener('scroll', onScroll);
    markAtBottom(true); // 初始在底部
    return () => el.removeEventListener('scroll', onScroll);
  }, [usingXterm]);

  // xterm 生命周期：挂载时建实例、订阅本卡流式输出；卸载/换会话时清理
  useEffect(() => {
    if (!usingXterm || !termRef.current) return undefined;
    const hostEl = termRef.current; // 整个 effect 生命周期内稳定，统一用它挂/卸监听
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: 1.2,
      cursorBlink: false,
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

    // 监听视口滚动，判定是否在底部：仅当不在底部时显示"回到底部"按钮（VS Code 式）。
    // 跟随完全交给 xterm 自然行为（视口在底部时新输出自动滚到底，上翻后停在原处）。
    // 用捕获阶段监听稳定的 host（termRef），每次重新查当前 .xterm-viewport，
    // 以兼容 fit()/reset() 重建视口 DOM 导致旧监听失效、按钮永不出现的问题。
    const onViewportScroll = () => {
      const vEl = hostEl.querySelector('.xterm-viewport');
      if (!vEl) return;
      const distance = vEl.scrollHeight - vEl.scrollTop - vEl.clientHeight;
      markAtBottom(distance < 2);
    };
    hostEl.addEventListener('scroll', onViewportScroll, true);
    markAtBottom(true); // 初始在底部

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
      hostEl.removeEventListener('scroll', onViewportScroll, true);
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
    if (!term || !usingXterm) return;
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

  // 回到底部：xterm 用 scrollToBottom，文本回退直接设 scrollTop；滚动监听会隐藏按钮
  const scrollToBottom = () => {
    if (usingXterm && termObj.current) {
      try {
        termObj.current.scrollToBottom();
      } catch {
        /* noop */
      }
      markAtBottom(true);
    } else {
      const el = outRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
        markAtBottom(true);
      }
    }
  };

  const groupLabel = exec.group || 'Ungrouped';

  // 统一只显示具体解释器路径/名称（移除原 'global' 概念；旧 'global' 数据经 resolveShellPath 仍解析为全局壳）
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
            Shell: {shellName}
          </span>
        </div>
        <div className="exec-card__head-right">
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

      <div className="exec-card__view">
        {usingXterm ? (
          <div className="exec-card__term">
            <div className="exec-card__term-host" ref={termRef} />
          </div>
        ) : (
          <div className="exec-card__body" ref={outRef}>
            <pre className="exec-card__output">{exec.lines.join('\n')}</pre>
          </div>
        )}
        {/* 仅当视口不在底部时显示"回到底部"按钮（VS Code 式）：跟随由 xterm 自然承担 */}
        {!atBottom && (
          <button
            type="button"
            className="exec-card__scroll-bottom"
            title="Scroll to bottom"
            onClick={scrollToBottom}
          >
            <IconArrowDown />
            <span>回到底部</span>
          </button>
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
