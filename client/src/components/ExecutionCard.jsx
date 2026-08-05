import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IconRefresh, IconExpand, IconStop } from './Icons.jsx';
import { resolveDisplayShell } from '../shellUtils.js';
import { mockOutputFor } from '../data/mockScripts.js';
import { ptyClient } from '../ptyClient.js';
import { filterSentinelChunk } from '../sentinelFilter.js';

// Git Bash / mintty 风格调色板：鲜艳的 16 色 ANSI + 黑底浅灰前景。
// 终端里彩色的提示符（user@host 绿、路径蓝）、彩色 ls 列表，全靠这套 ANSI 色板——
// 否则即使 shell 输出了 ANSI 转义码，xterm 也只按默认灰白上色，“花花绿绿”出不来。
const GITBASH_THEME = {
  background: '#000000',
  foreground: '#bfbfbf',
  cursor: '#bfbfbf',
  cursorAccent: '#000000',
  selectionBackground: '#555555',
  black: '#000000',
  red: '#cd0000',
  green: '#00cd00',
  yellow: '#cdcd00',
  blue: '#0000ee',
  magenta: '#cd00cd',
  cyan: '#00cdcd',
  white: '#e5e5e5',
  brightBlack: '#555555',
  brightRed: '#ff0000',
  brightGreen: '#00ff00',
  brightYellow: '#ffff00',
  brightBlue: '#0000ff',
  brightMagenta: '#ff00ff',
  brightCyan: '#00ffff',
  brightWhite: '#ffffff',
};

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
  const [status, setStatus] = useState('running'); // running | completed | exited
  const [lines, setLines] = useState([]); // mock 模式的流式输出
  const stoppedRef = useRef(false); // mock 流停止标记（Stop 点击 / 卸载时置位）

  // 完成探测：PTY 主机在脚本首条输入后写入唯一哨兵 token，渲染层识别即翻 Completed。
  // 下列 ref 在 onData 回调里读取最新值，避免闭包陈旧。
  const doneTokenRef = useRef(exec.doneToken || null); // 哨兵 token（每会话唯一）
  const filterBufRef = useRef(''); // 跨 chunk 重组哨兵用的不完整尾行
  const filterConsumeRef = useRef(0); // 哨兵吸收模式剩余吸收完整行数（跨 chunk 续传）
  const detectedRef = useRef(false); // 是否已识别哨兵（脚本结束）
  const statusRef = useRef(status); // 回调里读最新 status

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

  // 同步最新 doneToken 到 ref：startPtySession 异步返回后 exec.doneToken 才就位，
  // 而 onData 回调闭包无法感知后续渲染，故用 ref 持有最新值。
  useEffect(() => {
    doneTokenRef.current = exec.doneToken || null;
  }, [exec.doneToken]);

  // 回调里读取最新 status，避免闭包陈旧导致 completed 误判/漏判
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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
    // Git Bash / mintty 风格：Consolas 字体 + 鲜艳 ANSI 调色板 + 闪烁方块光标，
    // 与平时在 Git Bash 窗口里看到的“花花绿绿”一致。
    const term = new Terminal({
      fontFamily: 'Consolas, "Cascadia Code", "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: GITBASH_THEME,
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
      // 完成探测：识别哨兵 token 即翻 Completed，并剔除哨兵回显/输出行，保持终端干净。
      const token = doneTokenRef.current;
      if (!token) {
        term.write(data);
        return;
      }
      const { text, buf: nextBuf, detected, consumeLines } = filterSentinelChunk(
        data,
        token,
        filterBufRef.current,
        { consumeLines: filterConsumeRef.current },
      );
      filterBufRef.current = nextBuf;
      filterConsumeRef.current = consumeLines;
      if (text) term.write(text);
      if (detected && !detectedRef.current) {
        detectedRef.current = true;
        if (statusRef.current === 'running') setStatus('completed');
      }
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
    detectedRef.current = false; // 重跑是"新一次脚本"，重置哨兵识别
    filterBufRef.current = '';
    filterConsumeRef.current = 0;
    if (!term) return;
    if (prev != null && exec.sessionId && prev !== exec.sessionId) {
      term.reset();
    }
  }, [exec.sessionId, usingXterm]);

  // 停止/退出后终端不再接受输入，光标也不应闪烁（仅运行中闪烁）。
  // status 运行中为 'running'、停止或自然退出为 'exited'，随其切换 cursorBlink。
  useEffect(() => {
    if (!usingXterm || !termObj.current) return;
    termObj.current.options.cursorBlink = status === 'running';
  }, [status, usingXterm]);

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
  // 展示用解释器冻结为运行时解析路径（exec.shellPath），切换全局默认不影响已打开窗口
  const effectivePath = resolveDisplayShell(exec.shell, exec.shellPath, globalShellPath);
  const matchedShell = effectivePath ? shells.find((s) => s.path === effectivePath) : null;
  const shellName =
    matchedShell?.name || (effectivePath ? effectivePath.split(/[\\/]/).pop() : 'system default');

  // 标题栏状态指示：bootError 视为 Error；否则 running / completed / exited。
  // completed = 脚本已结束、会话未关，终端仍可继续交互。
  const statusInfo = exec.bootError
    ? { label: 'Error', tone: 'err' }
    : status === 'running'
      ? { label: 'Running', tone: 'run' }
      : status === 'completed'
        ? { label: 'Completed', tone: 'complete' }
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
          {status === 'completed' && (
            <button className="exec-card__end" title="End Session" onClick={handleStop}>
              End Session
            </button>
          )}
          <button
            className={`icon-btn ${exec.maximized ? 'is-active' : ''}`}
            title={exec.maximized ? 'Restore' : 'Maximize'}
            onClick={() => onRerun(exec.id, 'max')}
          >
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
