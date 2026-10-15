import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/utils';
import SettingsPage from './settings';

function card() {
  return screen.getAllByText('Change password')[0]!.closest('.card') as HTMLElement;
}

function fill(c: HTMLElement, current: string, next: string, confirm: string) {
  fireEvent.change(within(c).getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(within(c).getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(within(c).getByLabelText('Confirm new password'), { target: { value: confirm } });
  fireEvent.click(within(c).getByRole('button', { name: 'Change password' }));
}

afterEach(() => vi.unstubAllGlobals());

describe('Settings › Change password (web-49)', () => {
  it('blocks mismatched or short passwords without calling the API', async () => {
    const fetchMock = mockFetch({ 'GET /v1/me/sessions': { body: { items: [] } } });
    renderWithProviders(<SettingsPage />, { route: '/web/settings' });
    fill(card(), 'old-password-value', 'short', 'short');
    expect(await within(card()).findByText(/Use at least 12 characters/)).toBeInTheDocument();
    fill(card(), 'old-password-value', 'a-long-new-passphrase', 'a-different-passphrase');
    expect(await within(card()).findByText('The new passwords do not match.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/v1/me/password'))).toBe(false);
  });

  it('shows a wrong current password on the field and clears the form after success', async () => {
    let attempt = 0;
    const fetchMock = mockFetch({
      'GET /v1/me/sessions': { body: { items: [] } },
      'POST /v1/me/password': () =>
        ++attempt === 1
          ? { status: 422, body: { code: 'validation_failed', message: 'x', request_id: 'r1', retriable: false, field_errors: { current_password: 'incorrect' } } }
          : { body: { ok: true, other_sessions_revoked: 2 } },
    });
    renderWithProviders(<SettingsPage />, { route: '/web/settings' });
    fill(card(), 'wrong-current-pass', 'a-long-new-passphrase', 'a-long-new-passphrase');
    expect(await within(card()).findByText('The current password is incorrect.')).toBeInTheDocument();
    fill(card(), 'right-current-pass', 'a-long-new-passphrase', 'a-long-new-passphrase');
    expect(await screen.findByText('Password changed. 2 other sessions were signed out.')).toBeInTheDocument();
    await waitFor(() => expect((within(card()).getByLabelText('New password') as HTMLInputElement).value).toBe(''));
    const call = fetchMock.mock.calls.filter(([u]) => String(u).includes('/v1/me/password')).at(-1)!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ current_password: 'right-current-pass', new_password: 'a-long-new-passphrase' });
  });
});
