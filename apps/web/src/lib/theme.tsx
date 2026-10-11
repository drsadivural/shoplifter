// Theme: light / dark / system. Applied as <html data-theme="...">; CSS tokens switch on
// [data-theme=dark] and, for "system", on prefers-color-scheme (see styles/tokens.css).
// Persisted in localStorage (rg.theme) and, when signed in, on the server (me.user.theme).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemePreference } from '../api/types';

export const THEME_STORAGE_KEY = 'rg.theme';

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

export function readStoredTheme(): ThemePreference | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

interface ThemeContextValue {
  preference: ThemePreference;
  /** The theme actually rendered. */
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference, opts?: { persist?: boolean }) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initial }: { children: ReactNode; initial?: ThemePreference }) {
  const [preference, setPref] = useState<ThemePreference>(() => initial ?? readStoredTheme() ?? 'system');
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', preference);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference, opts?: { persist?: boolean }) => {
    setPref(p);
    if (opts?.persist !== false) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, p);
      } catch {
        /* storage unavailable */
      }
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved: preference === 'system' ? (systemDark ? 'dark' : 'light') : preference, setPreference }),
    [preference, systemDark, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
