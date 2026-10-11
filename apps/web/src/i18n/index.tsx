// i18n: English/Japanese catalogs keyed by the English source text.
//   t('Open alerts')                 -> "Open alerts" | "未対応アラート"   (design/ja.json)
//   t('nav|Incidents')               -> "Incidents"   | "事案記録"          (context-qualified key)
//   t('{count} unread notifications', { count: 3 })                       (interpolation)
// Missing Japanese falls back to English; missing English falls back to the key text after "|".
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '../api/types';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelative,
  formatTime,
  type DateFormatOptions,
} from '../lib/format';
import { APP_EN, APP_JA } from './app';
import { APP_EN_B, APP_JA_B } from './app-b';
import { APP_EN_C, APP_JA_C } from './app-c';
import { APP_EN_D, APP_JA_D } from './app-d';
import designJa from './design-ja.generated.json';

export const LOCALES: readonly Locale[] = ['en', 'ja'];
export const LOCALE_STORAGE_KEY = 'rg.locale';

export const CATALOGS: Record<Locale, Readonly<Record<string, string>>> = {
  en: { ...APP_EN, ...APP_EN_B, ...APP_EN_C, ...APP_EN_D },
  ja: { ...(designJa as Record<string, string>), ...APP_JA, ...APP_JA_B, ...APP_JA_C, ...APP_JA_D },
};

export type TVars = Record<string, string | number>;

function stripContext(key: string): string {
  const i = key.lastIndexOf('|');
  return i >= 0 ? key.slice(i + 1) : key;
}

function interpolate(s: string, vars?: TVars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Pure translate function (usable outside React, e.g. in tests). */
export function translate(locale: Locale, key: string, vars?: TVars): string {
  const ja = locale === 'ja' ? CATALOGS.ja[key] : undefined;
  const s = ja ?? CATALOGS.en[key] ?? stripContext(key);
  return interpolate(s, vars);
}

export function hasTranslation(locale: Locale, key: string): boolean {
  return CATALOGS[locale][key] !== undefined;
}

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'ja';
}

/**
 * Initial language. Order: explicit server preference (me.user.locale) > explicit local
 * preference (localStorage, used while signed out) > browser languages (any ja* -> ja) > en.
 * Never inferred from IP address or geography.
 */
export function detectLocale(input: {
  serverLocale?: string | null;
  storedLocale?: string | null;
  navigatorLanguages?: readonly string[] | null;
}): Locale {
  if (isLocale(input.serverLocale)) return input.serverLocale;
  if (isLocale(input.storedLocale)) return input.storedLocale;
  const langs = input.navigatorLanguages ?? [];
  if (langs.some((l) => l.toLowerCase() === 'ja' || l.toLowerCase().startsWith('ja-'))) return 'ja';
  return 'en';
}

export function readStoredLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

export interface I18nContextValue {
  locale: Locale;
  /** Change language. persist=true (default) stores the explicit choice in localStorage. */
  setLocale: (l: Locale, opts?: { persist?: boolean }) => void;
  t: (key: string, vars?: TVars) => string;
  /** Formatting bound to the current language. Pass the STORE timezone for timestamps. */
  fmt: {
    dateTime: (iso: string | null | undefined, timeZone: string, opts?: DateFormatOptions) => string;
    time: (iso: string | null | undefined, timeZone: string, opts?: DateFormatOptions) => string;
    date: (iso: string | null | undefined, timeZone: string) => string;
    relative: (iso: string | null | undefined, now?: Date) => string;
    duration: (seconds: number | null | undefined) => string;
    number: (n: number | null | undefined, opts?: Intl.NumberFormatOptions) => string;
    currency: (n: number | null | undefined, currency?: string) => string;
  };
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? detectLocale({ storedLocale: readStoredLocale(), navigatorLanguages: browserLanguages() }),
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale, opts?: { persist?: boolean }) => {
    setLocaleState(l);
    if (opts?.persist !== false) {
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, l);
      } catch {
        /* storage unavailable */
      }
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: string, vars?: TVars) => translate(locale, key, vars);
    return {
      locale,
      setLocale,
      t,
      fmt: {
        dateTime: (iso, tz, o) => formatDateTime(iso, tz, o),
        time: (iso, tz, o) => formatTime(iso, tz, o),
        date: (iso, tz) => formatDate(iso, tz),
        relative: (iso, now) => formatRelative(iso, locale, now),
        duration: (s) => formatDuration(s, locale),
        number: (n, o) => formatNumber(n, locale, o),
        currency: (n, c) => formatCurrency(n, locale, c),
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
