import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Incident } from '../api/types';
import { mockFetch, renderWithProviders } from '../test/utils';
import AlertDetailPage from './alert-detail';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i-42', ref: 'INC-2026-042', store_id: 's-1', store_name: 'Store One', store_timezone: 'Asia/Tokyo', camera_id: 'c-2',
    camera_name: 'CAM-02', channel: 'behavior_candidate', status: 'new', outcome: null, priority: 'high', assignee: null,
    evidence_state: 'pending', captured_at: '2026-10-11T01:42:18Z', ingested_at: '2026-10-11T01:42:20Z', delayed: false, version: 3,
    description: null, signals: { concealment_frames: 14, hand_to_bag_score: 0.8123 }, gate_reason: 'concealment_with_shelf_contact',
    model_version: 'behavior-0.1', uncertainty: ['hand_occluded'], evidence: [], notes: [], reviews: [],
    timeline: [{ at: '2026-10-11T01:42:20Z', action: 'incident.ingested', actor: null }],
    observed_behavior: null, loss_value: null, recovered_value: null, currency: 'JPY', ack_deadline: null, acknowledged_at: null,
    resolved_at: null, cases: [],
    ...overrides,
  };
}

describe('Alert detail (web-20)', () => {
  it('shows raw signals as candidate evidence, explicit pending evidence and the version', async () => {
    mockFetch({ 'GET /v1/incidents/i-42': { body: incident() } });
    renderWithProviders(<AlertDetailPage />, { route: '/web/alert-detail?id=i-42' });
    expect(await screen.findByText('Evidence is still uploading')).toBeInTheDocument();
    expect(screen.getByText('Raw value: 0.8123')).toBeInTheDocument();
    expect(screen.getAllByText('Candidate evidence · human review required')).toHaveLength(2);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText(/AI signals require review/)).toBeInTheDocument();
    expect(screen.getByText(/Alert received from the store edge/)).toBeInTheDocument();
    expect(screen.getByText(/Version 3/)).toBeInTheDocument();
    expect(screen.getByText('2026-10-11 10:42:18 JST')).toBeInTheDocument();
  });

  it('Acknowledge posts claim with expected_version', async () => {
    const fetchMock = mockFetch({
      'GET /v1/incidents/i-42': { body: incident() },
      'POST /v1/incidents/i-42/claim': {
        body: incident({ status: 'acknowledged', version: 4, assignee: { id: 'u-1', display_name: 'Store Manager' } }),
      },
    });
    renderWithProviders(<AlertDetailPage />, { route: '/web/alert-detail?id=i-42' });
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await screen.findByText(/Version 4/);
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/v1/incidents/i-42/claim')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ expected_version: 3 });
    expect(screen.getByRole('link', { name: 'Record outcome' })).toHaveAttribute('href', '/web/alert-outcome?id=i-42');
  });

  it('409 shows the conflict banner and refetches the current version', async () => {
    let gets = 0;
    mockFetch({
      'GET /v1/incidents/i-42': () => {
        gets += 1;
        return { body: gets === 1 ? incident() : incident({ status: 'acknowledged', version: 5, assignee: { id: 'u-9', display_name: 'Other Responder' } }) };
      },
      'POST /v1/incidents/i-42/claim': {
        status: 409,
        body: { code: 'owned_by_another_responder', message: 'Owned', request_id: 'req-409', retriable: false, current_version: 5 },
      },
    });
    renderWithProviders(<AlertDetailPage />, { route: '/web/alert-detail?id=i-42' });
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByText('Updated by someone else — showing current version')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Other Responder is handling this alert/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(gets).toBe(2);
  });

  it('Request review requires a reason before posting', async () => {
    const fetchMock = mockFetch({
      'GET /v1/incidents/i-42': { body: incident({ status: 'acknowledged', assignee: { id: 'u-1', display_name: 'Store Manager' } }) },
      'POST /v1/incidents/i-42/request-review': { body: incident({ status: 'reviewing', version: 4 }) },
    });
    renderWithProviders(<AlertDetailPage />, { route: '/web/alert-detail?id=i-42' });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Request review' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(screen.getAllByRole('button', { name: 'Request review' }).find((b) => dialog.contains(b))!);
    expect(await screen.findByText('Enter a reason of at least 3 characters.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/request-review'))).toBe(false);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Need a second opinion on the footage' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Request review' }).find((b) => dialog.contains(b))!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/request-review'))!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ expected_version: 3, reason: 'Need a second opinion on the footage' });
  });

  it('shows an explicit expired-evidence state', async () => {
    mockFetch({ 'GET /v1/incidents/i-42': { body: incident({ evidence_state: 'expired' }) } });
    renderWithProviders(<AlertDetailPage />, { route: '/web/alert-detail?id=i-42' });
    expect(await screen.findByText('Evidence has expired')).toBeInTheDocument();
  });
});
