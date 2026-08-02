import { useLayoutEffect, useRef, useState } from 'react';

// 自定义 tooltip：替代浏览器原生 title（原生延迟是 OS 级的，无法调小）。
//  - hover / focus 150ms 后显示；leave / blur 立即隐藏；卸载时清 timer。
//  - 显示在目标元素下方（top: 100% + 6px）。
//  - 默认居中对齐；如果贴近视口右/左边缘，自动改为贴右/贴左对齐，
//    避免 tooltip 延伸到 viewport 外导致 body 出现横向滚动条。
//  - 样式复用应用主题变量（--bg-panel / --border / --text），浅深主题通用。
//  - 保留 aria-label 供读屏；tooltip 本身用 role="tooltip"。
export default function Tooltip({ label, children, delay = 150 }) {
  const [show, setShow] = useState(false);
  const [align, setAlign] = useState('center');
  const timer = useRef(null);
  const wrapRef = useRef(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const open = () => {
    clear();
    timer.current = setTimeout(() => setShow(true), delay);
  };
  const close = () => {
    clear();
    setShow(false);
  };

  useLayoutEffect(() => {
    if (!show || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    // 粗估 tooltip 宽度：每字符 ~7px + padding 16px，最小 40px
    const estWidth = Math.max(40, label.length * 7 + 16);
    const half = estWidth / 2;
    const margin = 4;
    // 居中情况下 tooltip 的左右边界
    const centerLeft = rect.left + rect.width / 2 - half;
    const centerRight = centerLeft + estWidth;
    if (centerRight > window.innerWidth - margin) {
      setAlign('right');
    } else if (centerLeft < margin) {
      setAlign('left');
    } else {
      setAlign('center');
    }
  }, [show, label]);

  return (
    <span
      ref={wrapRef}
      className={`tooltip-wrap tooltip-wrap--${align}`}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}
      {show && (
        <span className="tooltip-bubble" role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}