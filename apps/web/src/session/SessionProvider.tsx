// Signed-in session: GET /v1/me, permissions, selected store, and preference sync.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useApiQuery } from '../api/hooks';
import type { Locale, Me, Permission, StoreRef, ThemePreference } from '../api/types';
import { isLocale, useI18n } from '../i18n';
import { isThemePreference, useTheme } from '../lib/theme';

export const STORE_STORAGE_KEY = 'rg.store';

export interface SessionContextValue {
  me: Me | undefined;
  status: 'loading' | 'ready' | 'error';
  error: ApiError | undefined;
  reload: () => void;
  /** True when the signed-in user has the permission action (me.permissions). */
  can: (permission: Permission | undefined | null) => boolean;
  /** Stores the user can access (me.stores). */
  stores: StoreRef[];
  /** Currently selected store (persisted in localStorage; defaults to the first store). */
  store: StoreRef | undefined;
  setStoreId: (id: string) => void;
  /** Store timezone for formatting; falls back to the org timezone, then UTC. */
  timeZone: string;
  /** Persist language/theme locally and on the server (PATCH /v1/me/preferences). */
  savePreferences: (p: { locale?: Locale; theme?: ThemePreference }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Locally adjust the unread counter after marking notifications read. */
  setUnread: (n: number) => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

function readStoredStore(): string | null {
  try {
    return localStorage.getItem(STORE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const q = useApiQuery((signal) => endpoints.me.get({ signal }), []);
  const { setLocale } = useI18n();
  const { setPreference } = useTheme();
  const [storeId, setStoreIdState] = useState<string | null>(readStoredStore);
  const appliedPrefs = useRef(false);

  // Explicit server preferences win over local/browser defaults.
  useEffect(() => {
    const me = q.data;
    if (!me || appliedPrefs.current) return;
    appliedPrefs.current = true;
    if (isLocale(me.user.locale)) setLocale(me.user.locale);
    if (isThemePreference(me.user.theme)) setPreference(me.user.theme);
  }, [q.data, setLocale, setPreference]);

  const value = useMemo<SessionContextValue>(() => {
    const me = q.data;
    const stores = me?.stores ?? [];
    const store = stores.find((s) => s.id === storeId) ?? stores[0];
    const perms = new Set<string>(me?.permissions ?? []);
    return {
      me,
      status: q.status === 'success' ? 'ready' : q.status === 'error' ? 'error' : 'loading',
      error: q.error,
      reload: q.reload,
      can: (p) => !p || perms.has(p),
      stores,
      store,
      setStoreId: (id) => {
        setStoreIdState(id);
        try {
          localStorage.setItem(STORE_STORAGE_KEY, id);
        } catch {
          /* storage unavailable */
        }
      },
      timeZone: store?.timezone ?? me?.org.timezone ?? 'UTC',
      savePreferences: async (p) => {
        if (p.locale) setLocale(p.locale);
        if (p.theme) setPreference(p.theme);
        if (me) {
          const updated = await endpoints.me.updatePreferences(p);
          q.setData(updated);
        }
      },
      signOut: async () => {
        try {
          await endpoints.auth.logout();
        } finally {
          window.location.assign('/web/login');
        }
      },
      setUnread: (n) => q.setData((m) => (m ? { ...m, unread_notifications: n } : m)),
    };
  }, [q, storeId, setLocale, setPreference]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** Convenience: permission check hook. */
export function useCan(): SessionContextValue['can'] {
  return useSession().can;
}

/** Re-export for screens that only need the selected store. */
export function useSelectedStore(): { store: StoreRef | undefined; timeZone: string } {
  const { store, timeZone } = useSession();
  return { store, timeZone };
}
