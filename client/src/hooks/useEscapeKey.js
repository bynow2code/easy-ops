import { useEffect } from 'react';

/**
 * 仅在弹窗/面板打开时监听 Escape 键关闭（项目约定：
 * 所有弹窗只能通过 ESC 与 Close 按钮关闭）。
 *
 * @param {boolean} open   面板是否打开
 * @param {() => void} onClose 关闭回调
 */
export function useEscapeKey(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}
