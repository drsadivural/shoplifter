import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
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
  it('switching off a required authenticator lets an org admin make it optional, then confirm', async () => {
    const fetchMock = mockFetch({
      'GET /v1/me/sessions': { body: { items: [] } },
      'GET /v1/org/settings/general': { body: GENERAL },
      'PUT /v1/org/settings/general': (init) => ({ body: { ...GENERAL, version: 4, settings: JSON.parse(String(init?.body)).settings } }),
    });
    const { session, reload } = sessionWith({ mfa_enabled: true, mfa_required: true });
    renderWithProviders(<SettingsPage />, { route: '/web/settings', session });
    const sw = within(twoStepCard()).getByRole('switch', { name: 'Ask for a code from my authenticator app at sign-in' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    const card = twoStepCard();
    expect(within(card).getByText('Required by your organization')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Make it optional for the organization' }));
    expect(await within(card).findByLabelText('Password')).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/v1/org/settings/general') && (i as RequestInit)?.method === 'PUT')!;
    expect(JSON.parse(String((put[1] as RequestInit).body))).toMatchObject({ expected_version: 3, settings: { require_mfa_for_privileged_roles: false } });
    expect(reload).toHaveBeenCalled();
  });

  it('a person who cannot manage the organization is told to ask an admin', () => {
    mockFetch({ 'GET /v1/me/sessions': { body: { items: [] } }, 'GET /v1/org/settings/general': { body: GENERAL } });
    const base = makeMe();
    const me = makeMe({ user: { ...base.user, mfa_enabled: true, mfa_required: true }, permissions: base.permissions.filter((p) => p !== 'org.manage') });
    renderWithProviders(<SettingsPage />, { route: '/web/settings', session: fakeSession(me) });
    fireEvent.click(within(twoStepCard()).getByRole('switch'));
    expect(within(twoStepCard()).getByText(/Ask an organization admin/)).toBeInTheDocument();
    expect(within(twoStepCard()).queryByRole('button', { name: 'Make it optional for the organization' })).toBeNull();
  });

  it('switching on opens enrollment', async () => {
    mockFetch({ 'GET /v1/me/sessions': { body: { items: [] } }, 'GET /v1/org/settings/general': { body: GENERAL } });
    const session = sessionWith({ mfa_enabled: false, mfa_required: false }).session;
    function Where() {
      const loc = useLocation();
      return <p>at {loc.pathname + loc.search}</p>;
    }
    renderWithProviders(
      <Routes>
        <Route path="/web/settings" element={<SettingsPage />} />
        <Route path="/web/mfa" element={<Where />} />
      </Routes>,
      { route: '/web/settings', session },
    );
    const sw = within(twoStepCard()).getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(await screen.findByText('at /web/mfa?enroll=1&optional=1&next=%2Fweb%2Fsettings')).toBeInTheDocument();
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
    fireEvent.click(within(twoStepCard()).getByRole('switch'));
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
