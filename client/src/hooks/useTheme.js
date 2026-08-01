/**
 * 主题切换 hook：三态（system / dark / light），循环切换。
 *
 * 行为：
 *  - state 持久化到 localStorage（key=easy-ops.theme）
 *  - 'system' 时实时跟随 `prefers-color-scheme: dark`
 *  - 通过给 <html data-theme="..."> 设值切换主题；CSS 用变量覆盖实现亮/暗
 *  - 首次渲染（SSR / 闪屏）由 main.jsx 在 React 启动前调用 applyStoredTheme()，
 *    避免出现「白屏闪一下再变暗」。
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'easy-ops.theme';
const MODES = /** @type {const} */ (['system', 'dark', 'light']);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolveTheme(mode) {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyToDom(mode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme(mode);
}

/**
 * 在 React 启动前同步应用一次主题，避免页面闪烁。
 * main.jsx 在 import 后、render 前调用即可。
 */
export function applyStoredTheme() {
  applyToDom(readStored());
}

export function useTheme() {
  const [theme, setTheme] = useState(readStored);

  // 应用主题 + 持久化
  useEffect(() => {
    applyToDom(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* localStorage 不可用（如隐私模式）静默忽略 */
    }
  }, [theme]);

  // 跟随系统：仅当 mode==='system' 时监听 OS 偏好
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyToDom('system');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((prev) => {
      const i = MODES.indexOf(prev);
      return MODES[(i + 1) % MODES.length];
    });
  }, []);

  return { theme, cycleTheme };
}
