import { screen, within } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes, Providers } from './App';
import { ROUTE_META } from './routes.meta';
import { PAGES } from './routes';
import { WEB_SCREENS } from './screens.generated';
import { makeMe, mockFetch } from './test/utils';
import { setAuthRedirectHandler } from './api/client';

function renderAt(path: string) {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  );
}

describe('route table', () => {
  it('registers all 54 catalog screens with metadata', () => {
    expect(WEB_SCREENS).toHaveLength(54);
    for (const s of WEB_SCREENS) expect(ROUTE_META[s.id]).toBeDefined();
  });

  it.each(WEB_SCREENS.filter((s) => !PAGES[s.id]).map((s) => [s.id, s.route]))(
    '%s (%s) renders NotYetImplemented naming the screen id',
    async (id, route) => {
      setAuthRedirectHandler(() => undefined);
      mockFetch({ 'GET /v1/me': { body: makeMe() }, 'GET /v1/stores': { body: { items: [], next_cursor: null } } });
      renderAt(route);
      const nyi = await screen.findByTestId('not-yet-implemented');
      expect(within(nyi).getByText(new RegExp(`^${id} · `))).toBeInTheDocument();
    },
  );

  it('redirects / to the dashboard', async () => {
    mockFetch({
      'GET /v1/me': { body: makeMe() },
      'GET /v1/stores': { body: { items: [], next_cursor: null } },
      'GET /v1/dashboard': { body: { open_alerts: 0, reviewed_today: 0, cameras: null, median_ack_seconds: null, awaiting_review: [], camera_health: [], trend: [], last_refresh: '2026-10-11T00:00:00Z', preview: null } },
    });
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Loss prevention overview' })).toBeInTheDocument();
  });

  it('hides nav items without permission and shows PermissionDenied on direct access', async () => {
    mockFetch({
      'GET /v1/me': { body: makeMe({ permissions: ['dashboard.read', 'incident.read'] }) },
    });
    renderAt('/web/users');
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
    const nav = screen.getAllByRole('navigation', { name: 'Main navigation' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Alerts' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Cameras' })).not.toBeInTheDocument();
  });

  it('marks the active nav item with aria-current for child screens', async () => {
    mockFetch({
      'GET /v1/me': { body: makeMe() },
      'GET /v1/stores': { body: { items: [], next_cursor: null } },
    });
    renderAt('/web/alert-detail');
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]!;
    expect(within(nav).getByRole('link', { name: 'Alerts' })).toHaveAttribute('aria-current', 'page');
  });
});
