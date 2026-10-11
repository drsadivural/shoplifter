import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/utils';
import AlertsPage from './alerts';

const item = {
  id: 'i-1', ref: 'INC-2026-001', store_id: 's-1', store_name: 'Store One', store_timezone: 'Asia/Tokyo', camera_id: 'c-1',
  camera_name: 'CAM-01', channel: 'watchlist_candidate', status: 'acknowledged', outcome: null, priority: 'urgent',
  assignee: { id: 'u-2', display_name: 'Responder A' }, evidence_state: 'available', captured_at: '2026-10-11T01:00:00Z',
  ingested_at: '2026-10-11T01:05:00Z', delayed: true, version: 2,
};

describe('Alert inbox (web-19)', () => {
  it('requests unresolved incidents for the selected store and renders rows', async () => {
    const fetchMock = mockFetch({ 'GET /v1/incidents': { body: { items: [item], next_cursor: 'c2' } } });
    renderWithProviders(<AlertsPage />, { route: '/web/alerts' });
    expect(await screen.findByRole('link', { name: 'INC-2026-001' })).toHaveAttribute('href', '/web/alert-detail?id=i-1');
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('store_id=s-1');
    expect(url).toContain('status=new%2Cacknowledged%2Creviewing');
    expect(screen.getByText('Delayed delivery')).toBeInTheDocument();
    expect(screen.getByText('Responder A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('channel tabs filter server-side', async () => {
    const fetchMock = mockFetch({ 'GET /v1/incidents': { body: { items: [], next_cursor: null } } });
    renderWithProviders(<AlertsPage />, { route: '/web/alerts' });
    expect(await screen.findByText('No alerts to review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('channel=checkout_exception'))).toBe(true));
    expect(await screen.findByText('No alerts match these filters')).toBeInTheDocument();
  });
});
