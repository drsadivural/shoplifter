// Signed-in application shell: sidebar (228px; compact ≤1279px; drawer ≤1023px), header with
// breadcrumbs, store selector, unread count, language + theme toggles and the user menu.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery } from '../api/hooks';
import type { EdgeState, ThemePreference } from '../api/types';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { ErrorState, LoadingState } from '../components/states';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../i18n';
import { formatTime, tzAbbr } from '../lib/format';
import { useTheme } from '../lib/theme';
import { getScreen, NAV, ROUTE_META, screenForPath } from '../routes.meta';
import type { ScreenId } from '../screens.generated';
import { useSession } from '../session/SessionProvider';
import { useConnectivity } from '../hooks/useConnectivity';
import { EdgeTree } from './EdgeTree';

export function AppShell() {
  const { t } = useI18n();
  const session = useSession();
  const location = useLocation();
  const isDrawer = useMediaQuery(BREAKPOINTS.drawer);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const screen = screenForPath(location.pathname);
  const meta = screen ? ROUTE_META[screen.id as ScreenId] : undefined;
  const firstRender = useRef(true);

  // Close the drawer and move focus to the page title on navigation (not on first load).
  useEffect(() => {
    setDrawerOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = requestAnimationFrame(() => document.getElementById('page-title')?.focus());
    return () => cancelAnimationFrame(id);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    document.querySelector<HTMLElement>('.sidebar a')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const degradedAllowed = meta?.layout === 'app-degraded';
  let content: ReactNode;
  if (session.status === 'loading' && !degradedAllowed) {
    content = <LoadingState />;
  } else if (session.status === 'error' && !degradedAllowed) {
    // 401s are redirected by the API client; anything else is shown with Retry.
    content = session.error?.status === 401 ? <LoadingState /> : <ErrorState error={session.error} onRetry={session.reload} />;
  } else {
    content = <Outlet />;
  }

  return (
    <div className={`app ${drawerOpen ? 'drawer-open' : ''}`}>
      <a href="#main" className="skip-link">
        {t('Skip to content')}
      </a>
      <Sidebar activeScreenId={(meta?.navParent ?? screen?.id) as ScreenId | undefined} open={drawerOpen} isDrawer={isDrawer} />
      {drawerOpen ? <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} aria-hidden="true" /> : null}
      <div className="web-shell">
        <Header screenId={screen?.id as ScreenId | undefined} onMenu={() => setDrawerOpen((o) => !o)} drawerOpen={drawerOpen} />
        <main id="main" tabIndex={-1}>
          {screen?.id !== 'web-54' ? <ConnectionBanner /> : null}
          {content}
        </main>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Sidebar

function Sidebar({ activeScreenId, open, isDrawer }: { activeScreenId: ScreenId | undefined; open: boolean; isDrawer: boolean }) {
  const { t } = useI18n();
  const { can, me } = useSession();
  return (
    <aside
      className={`sidebar ${open ? 'open' : ''}`}
      id="sidebar"
      aria-label={t('Main navigation')}
      // Off-canvas drawer is removed from the tab order while closed.
      {...(isDrawer && !open ? { inert: true } : {})}
    >
      <Link to="/web/dashboard" className="brand" aria-label="RetailGuard by Ayonix">
        <span className="mark" aria-hidden="true">
          ◈
        </span>
        <span className="brand-name">RetailGuard</span>
      </Link>
      <div className="subbrand">BY AYONIX</div>
      <nav aria-label={t('Main navigation')}>
        {me
          ? NAV.map((group) => {
              const items = group.items.filter((it) => can(ROUTE_META[it.screenId].permission));
              if (items.length === 0) return null;
              return (
                <div key={group.labelKey} className="nav-group">
                  <div className="nav-head">{t(group.labelKey)}</div>
                  <ul>
                    {items.map((it) => {
                      const s = getScreen(it.screenId);
                      const active = activeScreenId === it.screenId;
                      return (
                        <li key={it.screenId}>
                          <Link to={s.route} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
                            <Icon name={it.icon} />
                            <span className="nav-label">{t(it.labelKey)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          : null}
        {me ? <EdgeTree /> : null}
      </nav>
      <EdgeFooter />
    </aside>
  );
}

const EDGE_TEXT: Record<EdgeState | 'unknown', { key: string; tone: 'ok' | 'warning' | 'critical' | 'neutral' }> = {
  online: { key: 'Store edge connected', tone: 'ok' },
  offline: { key: 'Store edge offline', tone: 'critical' },
  unpaired: { key: 'No edge appliance paired', tone: 'warning' },
  unknown: { key: 'Edge status unavailable', tone: 'neutral' },
};

function EdgeFooter() {
  const { t } = useI18n();
  const { store, can } = useSession();
  const stores = useApiQuery((signal) => endpoints.stores.list({ limit: 100 }, { signal }), [], {
    enabled: can('store.read'),
    pollMs: 60_000,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!store) return null;
  const edge = stores.data?.items.find((s) => s.id === store.id)?.edge_state ?? 'unknown';
  const info = EDGE_TEXT[edge];
  const city = store.timezone.split('/').pop()?.replace(/_/g, ' ') ?? store.timezone;
  return (
    <div className="aside-bottom" aria-live="polite">
      <div className="edge-state">
        <span className={`dot dot-${info.tone}`} aria-hidden="true" />
        {t(info.key)}
      </div>
      <div className="muted small">
        {city} · {formatTime(now, store.timezone)} {tzAbbr(store.timezone, now)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Header

function Header({ screenId, onMenu, drawerOpen }: { screenId: ScreenId | undefined; onMenu: () => void; drawerOpen: boolean }) {
  const { t, locale } = useI18n();
  const session = useSession();
  const { me, stores, store, setStoreId, savePreferences, signOut } = session;
  const { preference } = useTheme();
  const screen = screenId ? getScreen(screenId) : undefined;
  const meta = screenId ? ROUTE_META[screenId] : undefined;
  const parent = meta?.navParent ? getScreen(meta.navParent) : undefined;
  const sectionKey = meta?.section === 'administration' ? 'crumb|Administration' : 'crumb|Retail operations';
  const initials = (me?.user.display_name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  const setTheme = (p: ThemePreference) => void savePreferences({ theme: p }).catch(() => undefined);
  const toggleLocale = () => void savePreferences({ locale: locale === 'ja' ? 'en' : 'ja' }).catch(() => undefined);

  return (
    <header className="app-header">
      <button
        type="button"
        className="header-btn hamburger"
        aria-label={t('Open navigation')}
        aria-controls="sidebar"
        aria-expanded={drawerOpen}
        onClick={onMenu}
      >
        <Icon name="menu" size={20} />
      </button>
      <nav aria-label={t('Breadcrumb')} className="crumb">
        <ol>
          <li>
            <Link to="/web/dashboard">{t(sectionKey)}</Link>
          </li>
          {parent && parent.id !== screen?.id ? (
            <li className="crumb-parent">
              <Link to={parent.route}>{parent.title[locale]}</Link>
            </li>
          ) : null}
          {screen ? (
            <li aria-current="page">
              <span>{screen.title[locale]}</span>
            </li>
          ) : null}
        </ol>
      </nav>
      <div className="header-tools">
        {stores.length > 0 ? (
          <label className="store-select">
            <span className="visually-hidden">{t('Store')}</span>
            <select value={store?.id ?? ''} onChange={(e) => setStoreId(e.target.value)}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {me ? (
          <Link
            to="/web/alerts"
            className="header-btn bell"
            aria-label={t('{count} unread notifications', { count: me.unread_notifications })}
          >
            <Icon name="bell" size={18} />
            {me.unread_notifications > 0 ? (
              <span className="count-badge" aria-hidden="true">
                {me.unread_notifications > 99 ? '99+' : me.unread_notifications}
              </span>
            ) : null}
          </Link>
        ) : null}
        <button
          type="button"
          className="header-btn lang-toggle"
          onClick={toggleLocale}
          aria-label={t('Display language: {current}. Switch to {other}.', {
            current: locale === 'ja' ? '日本語' : 'English',
            other: locale === 'ja' ? 'English' : '日本語',
          })}
        >
          <span lang={locale === 'ja' ? 'ja' : 'en'}>{locale === 'ja' ? '日本語' : 'English'}</span>
        </button>
        <Menu label={t('Appearance')} trigger={<Icon name="contrast" size={18} />}>
          {(close) => (
            <div role="group" aria-label={t('Appearance')}>
              {(['light', 'dark', 'system'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="menu-item"
                  aria-pressed={preference === p}
                  onClick={() => {
                    setTheme(p);
                    close();
                  }}
                >
                  <span aria-hidden="true">{preference === p ? '✓ ' : ' '}</span>
                  {t(p === 'light' ? 'Light' : p === 'dark' ? 'Dark' : 'Match system')}
                </button>
              ))}
            </div>
          )}
        </Menu>
        {me ? (
          <Menu label={t('Account menu for {name}', { name: me.user.display_name })} trigger={<span className="avatar-initials">{initials || '?'}</span>} triggerClassName="avatar-btn">
            {(close) => (
              <div>
                <div className="menu-user">
                  <strong>{me.user.display_name}</strong>
                  <div className="muted small">{me.user.email}</div>
                  <div className="muted small">{t(`role|${me.user.role}`)}</div>
                </div>
                <Link className="menu-item" to="/web/settings" onClick={close}>
                  {t('Account settings')}
                </Link>
                <Link className="menu-item" to="/web/notifications" onClick={close}>
                  {t('Notification settings')}
                </Link>
                <button type="button" className="menu-item" onClick={() => void signOut()}>
                  {t('Sign out')}
                </button>
              </div>
            )}
          </Menu>
        ) : null}
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ Connection banner

function ConnectionBanner() {
  const { t } = useI18n();
  const snap = useConnectivity();
  const location = useLocation();
  if (snap.online || !snap.lastFailure) return null;
  const from = location.pathname + location.search;
  return (
    <div className="connection-banner" role="status">
      <Icon name="wifiOff" />
      <span>{t('Connection interrupted. Some information may be out of date.')}</span>
      <Link to={`/web/error?from=${encodeURIComponent(from)}`}>{t('View connection status')}</Link>
    </div>
  );
}
