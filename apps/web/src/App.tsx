import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { PageHeader } from './components/PageHeader';
import { Button } from './components/primitives';
import { EmptyState, LoadingState, NotYetImplemented, PermissionDenied } from './components/states';
import { ToastProvider } from './components/Toast';
import { I18nProvider, translate, useI18n } from './i18n';
import { ThemeProvider } from './lib/theme';
import { INVITE_ROUTE, ROUTE_META } from './routes.meta';
import { InvitePage, PAGES } from './routes';
import { WEB_SCREENS, type ScreenId } from './screens.generated';
import { SessionProvider, useSession } from './session/SessionProvider';
import { AppShell } from './shell/AppShell';

/** Renders one catalog screen inside the shell with the client-side permission gate. */
export function ScreenRoute({ id }: { id: ScreenId }) {
  const { can, me } = useSession();
  const { locale } = useI18n();
  const meta = ROUTE_META[id];
  const Page = PAGES[id];
  if (meta.layout === 'app' && me && !can(meta.permission)) {
    return (
      <>
        <PageHeader screenId={id} />
        <PermissionDenied permission={meta.permission} />
      </>
    );
  }
  if (!Page) {
    const screen = WEB_SCREENS.find((s) => s.id === id)!;
    return (
      <>
        <PageHeader screenId={id} />
        <NotYetImplemented screenId={id} title={screen.title[locale]} />
      </>
    );
  }
  return (
    <RenderErrorBoundary>
      <Suspense fallback={<LoadingState />}>
        <Page />
      </Suspense>
    </RenderErrorBoundary>
  );
}

function PublicFallback() {
  return (
    <main className="standalone" id="main">
      <LoadingState variant="inline" />
    </main>
  );
}

function PublicScreen({ id }: { id: ScreenId }) {
  const Page = PAGES[id];
  if (!Page) return null;
  return (
    <RenderErrorBoundary>
      <Suspense fallback={<PublicFallback />}>
        <Page />
      </Suspense>
    </RenderErrorBoundary>
  );
}

function NotFound() {
  const { t } = useI18n();
  const loc = useLocation();
  return (
    <main id="main" className="standalone">
      <EmptyState
        icon="search"
        title={t('Page not found')}
        description={loc.pathname}
        action={
          <a className="btn btn-secondary btn-md" href="/web/dashboard">
            {t('Go to dashboard')}
          </a>
        }
      />
    </main>
  );
}

export function AppRoutes() {
  const publicScreens = WEB_SCREENS.filter((s) => ROUTE_META[s.id].layout === 'public');
  const appScreens = WEB_SCREENS.filter((s) => ROUTE_META[s.id].layout !== 'public');
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/web/dashboard" replace />} />
      <Route path="/web" element={<Navigate to="/web/dashboard" replace />} />
      {publicScreens.map((s) => (
        <Route key={s.id} path={s.route} element={<PublicScreen id={s.id} />} />
      ))}
      <Route
        path={INVITE_ROUTE}
        element={
          <Suspense fallback={<PublicFallback />}>
            <InvitePage />
          </Suspense>
        }
      />
      <Route
        element={
          <SessionProvider>
            <AppShell />
          </SessionProvider>
        }
      >
        {appScreens.map((s) => (
          <Route key={s.id} path={s.route} element={<ScreenRoute id={s.id} />} />
        ))}
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <Providers>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </Providers>
  );
}

/** Catches render errors and failed lazy chunk loads (e.g. after a deploy). */
class RenderErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error.message, info.componentStack?.split('\n')[1]?.trim());
  }
  override render() {
    if (!this.state.error) return this.props.children;
    const locale = document.documentElement.lang === 'ja' ? 'ja' : 'en';
    return (
      <div className="state state-error" role="alert">
        <h3 className="state-title">{translate(locale, 'This screen failed to display')}</h3>
        <p className="muted">{translate(locale, 'Reload the page. If it keeps happening, contact support.')}</p>
        <Button variant="secondary" icon="refresh" onClick={() => window.location.reload()}>
          {translate(locale, 'Reload')}
        </Button>
      </div>
    );
  }
}
