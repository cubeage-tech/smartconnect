import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getThemePreference, resolveTheme, setThemePreference, subscribeTheme, THEME_STORAGE_KEY, useThemePreference, watchSystemTheme } from './theme';

const mockSystemDark = (dark: boolean) => {
  const listeners = new Set<() => void>();
  const mql = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  return {
    flip(next: boolean) {
      mql.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
};

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
});

describe('theme preference (P2 Phase J)', () => {
  it('defaults to following the system and ignores unknown stored values', () => {
    expect(getThemePreference()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(getThemePreference()).toBe('system');
  });

  it('resolves system to the OS setting and keeps explicit choices', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('persists a choice and applies it to the document', () => {
    mockSystemDark(false);
    setThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    setThemePreference('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('follows OS changes only while on "system", and notifies subscribers', () => {
    const os = mockSystemDark(false);
    const seen: string[] = [];
    const stop = subscribeTheme((t) => seen.push(t));
    const unwatch = watchSystemTheme();
    applyTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    os.flip(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    setThemePreference('light');
    os.flip(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(seen).toContain('dark');
    expect(seen[seen.length - 1]).toBe('light');
    stop();
    unwatch();
  });

  it("keeps this page's choice when storage is unavailable", () => {
    mockSystemDark(false);
    const blocked = () => {
      throw new Error('blocked');
    };
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    setThemePreference('dark');
    expect(getThemePreference()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    get.mockRestore();
    set.mockRestore();
  });
});

describe('useThemePreference — the one source every switcher reads', () => {
  it('re-renders on every change, even when the colours on screen stay the same', () => {
    mockSystemDark(true);
    const { result } = renderHook(() => useThemePreference());
    expect(result.current).toBe('system');
    act(() => void setThemePreference('dark')); // "system" on a dark OS → "dark": same colours, new choice
    expect(result.current).toBe('dark');
    act(() => void setThemePreference('system'));
    expect(result.current).toBe('system');
  });

  it('follows a choice saved in another tab', () => {
    mockSystemDark(false);
    const unwatch = watchSystemTheme();
    const { result } = renderHook(() => useThemePreference());
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark'); // what the other tab wrote
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    });
    expect(result.current).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    unwatch();
  });
});
