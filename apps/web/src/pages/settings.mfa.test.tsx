import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession, makeMe, mockFetch, renderWithProviders } from '../test/utils';
import SettingsPage from './settings';

const GENERAL = {
  kind: 'general',
  version: 3,
  updated_at: '2026-10-01T00:00:00Z',
  updated_by: null,
  settings: { default_locale: 'browser', session_timeout_minutes: 60, currency: 'JPY', require_mfa_for_privileged_roles: true },
};

function twoStepCard() {
  return screen.getByText('Two-step verification', { selector: 'h2, h3, h2 *, h3 *' }).closest('.card') as HTMLElement;
}

function sessionWith(user: { mfa_enabled: boolean; mfa_required: boolean }, reload = vi.fn()) {
  const base = makeMe();
  return { session: fakeSession(makeMe({ user: { ...base.user, ...user } }), { reload }), reload };
}

afterEach(() => vi.unstubAllGlobals());

describe('Settings › Two-step verification (web-49)', () => {
  it('explains that a required authenticator cannot be turned off', async () => {
    mockFetch({ 'GET /v1/me/sessions': { body: { items: [] } }, 'GET /v1/org/settings/general': { body: GENERAL } });
    renderWithProviders(<SettingsPage />, { route: '/web/settings', session: sessionWith({ mfa_enabled: true, mfa_required: true }).session });
    const card = twoStepCard();
    expect(within(card).getByText(/cannot be turned off/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Turn off' })).toBeNull();
  });

  it('links to enrollment when off', () => {
    mockFetch({ 'GET /v1/me/sessions': { body: { items: [] } }, 'GET /v1/org/settings/general': { body: GENERAL } });
    renderWithProviders(<SettingsPage />, { route: '/web/settings', session: sessionWith({ mfa_enabled: false, mfa_required: false }).session });
    const link = within(twoStepCard()).getByRole('link', { name: 'Turn on' });
    expect(link.getAttribute('href')).toBe('/web/mfa?enroll=1&optional=1&next=%2Fweb%2Fsettings');
  });

  it('turns off with password and code, showing field errors first', async () => {
    let attempt = 0;
    const fetchMock = mockFetch({
      'GET /v1/me/sessions': { body: { items: [] } },
      'GET /v1/org/settings/general': { body: GENERAL },
      'POST /v1/me/mfa/disable': () =>
        ++attempt === 1
          ? { status: 422, body: { code: 'validation_failed', message: 'x', request_id: 'r1', retriable: false, field_errors: { password: 'incorrect' } } }
          : { body: { ok: true } },
    });
    const { session, reload } = sessionWith({ mfa_enabled: true, mfa_required: false });
    renderWithProviders(<SettingsPage />, { route: '/web/settings', session });
    fireEvent.click(within(twoStepCard()).getByRole('button', { name: 'Turn off' }));
    const card = twoStepCard();
    fireEvent.click(within(card).getByRole('button', { name: 'Turn off two-step verification' }));
    expect(await within(card).findByText('Enter your password.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/v1/me/mfa/disable'))).toBe(false);

    fireEvent.change(within(card).getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.change(within(card).getByLabelText('Authentication code'), { target: { value: '123 456' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Turn off two-step verification' }));
    expect(await within(card).findByText('The password is incorrect.')).toBeInTheDocument();

    fireEvent.change(within(card).getByLabelText('Password'), { target: { value: 'right-password' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Turn off two-step verification' }));
    expect(await screen.findByText('Two-step verification turned off.')).toBeInTheDocument();
    await waitFor(() => expect(reload).toHaveBeenCalled());
    const call = fetchMock.mock.calls.filter(([u]) => String(u).includes('/v1/me/mfa/disable')).at(-1)!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ password: 'right-password', code: '123456' });
  });

  it('lets an organization admin make the authenticator optional', async () => {
    const fetchMock = mockFetch({
      'GET /v1/me/sessions': { body: { items: [] } },
      'GET /v1/org/settings/general': { body: GENERAL },
      'PUT /v1/org/settings/general': (init) => ({
        body: { ...GENERAL, version: 4, settings: JSON.parse(String(init?.body)).settings },
      }),
    });
    renderWithProviders(<SettingsPage />, { route: '/web/settings' });
    const toggle = await screen.findByRole('switch', { name: 'Require two-step verification for admins and investigators' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/protected by a password only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Organization settings saved');
    const call = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/v1/org/settings/general') && (i as RequestInit)?.method === 'PUT')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      expected_version: 3,
      settings: { default_locale: 'browser', session_timeout_minutes: 60, currency: 'JPY', require_mfa_for_privileged_roles: false },
    });
  });
});
