import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStoredTheme, useTheme } from './useTheme.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  // jsdom 默认没有 matchMedia，mock 一个返回 dark=true
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTheme', () => {
  it('defaults to system and applies dark when OS prefers dark', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('cycles system → dark → light → system', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('system');
  });

  it('persists choice to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.cycleTheme()); // -> dark
    expect(localStorage.getItem('easy-ops.theme')).toBe('dark');
    act(() => result.current.cycleTheme()); // -> light
    expect(localStorage.getItem('easy-ops.theme')).toBe('light');
  });

  it('reads stored value on next mount', () => {
    localStorage.setItem('easy-ops.theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('applyStoredTheme runs synchronously without React', () => {
    localStorage.setItem('easy-ops.theme', 'dark');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to light when system mode and OS prefers light', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false, // not dark
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    localStorage.setItem('easy-ops.theme', 'system');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
