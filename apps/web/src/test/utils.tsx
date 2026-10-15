// Test helpers: providers with a fake session, and a fetch mock keyed by "METHOD /path".
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { Locale, Me, Permission } from '../api/types';
import { ToastProvider } from '../components/Toast';
import { I18nProvider } from '../i18n';
import { ThemeProvider } from '../lib/theme';
import { SessionContext, type SessionContextValue } from '../session/SessionProvider';

export const ALL_PERMISSIONS: Permission[] = [
  'dashboard.read', 'incident.read', 'incident.create', 'incident.respond', 'incident.reopen', 'case.read', 'case.manage',
  'export.create', 'search.metadata', 'search.photo', 'profile.read', 'staff.manage', 'watchlist.manage', 'watchlist.approve',
  'photo.read', 'camera.read', 'camera.manage', 'edge.manage', 'store.read', 'store.manage', 'policy.manage',
  'integration.manage', 'report.read', 'audit.read', 'user.manage', 'org.manage', 'model.manage', 'privacy.manage',
  'health.read', 'support.create',
];

export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    user: {
      id: 'u-1',
      email: 'manager@example.test',
      display_name: 'Store Manager',
      role: 'store_admin',
      locale: null,
      theme: null,
      mfa_enabled: true,
      mfa_required: true,
      notification_prefs: {
        behavior: true, watchlist: true, checkout: true, rfid: false, sound: true, private_preview: true, quiet_hours: null, store_ids: [],
      },
    },
    org: { id: 'o-1', name: 'Test Org', timezone: 'Asia/Tokyo', region: 'jp' },
    stores: [{ id: 's-1', name: 'Store One', timezone: 'Asia/Tokyo', region: 'Kanto' }],
    permissions: ALL_PERMISSIONS,
    session: { id: 'sess-1', expires_at: '2030-01-01T00:00:00Z', mfa_verified: true },
    unread_notifications: 0,
    ...overrides,
  };
}

export function fakeSession(me: Me = makeMe(), overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  const perms = new Set<string>(me.permissions);
  const store = me.stores[0];
  return {
    me,
    status: 'ready',
    error: undefined,
    reload: () => undefined,
    can: (p) => !p || perms.has(p),
    stores: me.stores,
    store,
    setStoreId: () => undefined,
    timeZone: store?.timezone ?? me.org.timezone,
    savePreferences: async () => undefined,
    signOut: async () => undefined,
    setUnread: () => undefined,
    ...overrides,
  };
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { route?: string; locale?: Locale; session?: SessionContextValue } = {},
): RenderResult {
  return render(
    <ThemeProvider initial="light">
      <I18nProvider initialLocale={opts.locale ?? 'en'}>
        <ToastProvider>
          <SessionContext.Provider value={opts.session ?? fakeSession()}>
            <MemoryRouter initialEntries={[opts.route ?? '/web/dashboard']}>{ui}</MemoryRouter>
          </SessionContext.Provider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Stubs global fetch. Routes are "METHOD /path" (query string ignored). Unmatched -> 404. */
export function mockFetch(routes: Record<string, MockResponse | ((init: RequestInit | undefined, url: string) => MockResponse)>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.split('?')[0];
    const entry = routes[`${method} ${path}`];
    const r = typeof entry === 'function' ? entry(init, url) : entry ?? { status: 404, body: { code: 'not_found', message: 'Not found', request_id: 'req-404', retriable: false } };
    const status = r.status ?? 200;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': `req-${method}-${path}`, ...r.headers },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
