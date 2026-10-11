import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Dashboard } from '../api/types';
import { fakeSession, makeMe, mockFetch, renderWithProviders } from '../test/utils';
import DashboardPage from './dashboard';

const base: Dashboard = {
  open_alerts: 0,
  reviewed_today: 0,
  cameras: { online: 0, total: 0 },
  median_ack_seconds: null,
  awaiting_review: [],
  camera_health: [],
  trend: [],
  last_refresh: '2026-10-11T01:42:18Z',
};

function statCard(label: string) {
  return screen.getByText(label).closest('.stat-card') as HTMLElement;
}

describe('Dashboard (web-09)', () => {
  it('renders "unavailable" for null metrics, distinct from zero', async () => {
    const fetchMock = mockFetch({
      'GET /v1/dashboard': { body: { ...base, open_alerts: null, reviewed_today: 0, cameras: null, median_ack_seconds: null } },
      'GET /v1/cameras': { body: { items: [], next_cursor: null } },
    });
    renderWithProviders(<DashboardPage />);
    await screen.findByText('Open alerts');

    const open = statCard('Open alerts');
    expect(within(open).getByTestId('stat-unavailable')).toBeInTheDocument();
    expect(within(open).getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(within(open).queryByText('0')).not.toBeInTheDocument();

    const reviewed = statCard('Reviewed incidents');
    expect(within(reviewed).getByText('0')).toBeInTheDocument();
    expect(within(reviewed).queryByTestId('stat-unavailable')).not.toBeInTheDocument();

    expect(within(statCard('Online cameras')).getByTestId('stat-unavailable')).toBeInTheDocument();
    expect(within(statCard('Median acknowledgement')).getByTestId('stat-unavailable')).toBeInTheDocument();

    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).startsWith('/v1/dashboard'))![0]);
    expect(url).toBe('/v1/dashboard?store_id=s-1');
  });

  it('renders values, awaiting-review links, trend note and the empty preview state', async () => {
    mockFetch({
      'GET /v1/dashboard': {
        body: {
          ...base,
          open_alerts: 7,
          reviewed_today: 18,
          cameras: { online: 24, total: 26 },
          median_ack_seconds: 14,
          awaiting_review: [
            {
              id: 'i-42', ref: 'INC-2026-042', store_id: 's-1', store_name: 'Store One', camera_id: 'c-1', camera_name: 'CAM-01',
              channel: 'behavior_candidate', status: 'new', outcome: null, priority: 'normal', assignee: null, evidence_state: 'available',
              captured_at: '2026-10-11T01:42:00Z', ingested_at: '2026-10-11T01:42:05Z', delayed: false, version: 1,
            },
          ],
          trend: [
            { date: '2026-10-10', detections: 5, reviewed: 3 },
            { date: '2026-10-11', detections: 2, reviewed: 2 },
          ],
        },
      },
      'GET /v1/cameras': { body: { items: [], next_cursor: null } },
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('24/26')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('14 s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'INC-2026-042' })).toHaveAttribute('href', '/web/alert-detail?id=i-42');
    expect(screen.getByText(/CAM-01 · 10:42/)).toBeInTheDocument();
    expect(screen.getByText('Impact is measured from reviewed incidents')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Alert and review trends' })).toBeInTheDocument();
    expect(await screen.findByText('No verified camera frame yet')).toBeInTheDocument();
  });

  it('renders in Japanese', async () => {
    mockFetch({
      'GET /v1/dashboard': { body: { ...base, open_alerts: null } },
      'GET /v1/cameras': { body: { items: [], next_cursor: null } },
    });
    renderWithProviders(<DashboardPage />, { locale: 'ja' });
    expect(await screen.findByText('未対応アラート')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'ロス防止ダッシュボード' })).toBeInTheDocument();
    expect(screen.getByText('効果は確認済み事案から集計')).toBeInTheDocument();
  });

  it('shows an error state with Retry and request id', async () => {
    mockFetch({
      'GET /v1/dashboard': { status: 500, body: { code: 'internal', message: 'Boom', request_id: 'req-500', retriable: true } },
      'GET /v1/cameras': { body: { items: [], next_cursor: null } },
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/req-500/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows permission denied without dashboard.read', async () => {
    mockFetch({});
    const me = makeMe({ permissions: ['incident.read'] });
    renderWithProviders(<DashboardPage />, { session: fakeSession(me) });
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
  });
});
