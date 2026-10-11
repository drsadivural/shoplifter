// Smoke coverage for every signed-in web screen: each page must render without throwing when the
// API fails (500), denies (403) or reports a missing dependency (503), and must surface that state
// to the user instead of rendering a blank or fabricated screen.
import { act, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGES } from '../routes';
import { WEB_SCREENS } from '../screens.generated';
import { renderWithProviders } from '../test/utils';

const AUTH_SCREENS = new Set(['web-01', 'web-02', 'web-03']);
const FAKE_ID = '00000000-0000-4000-8000-000000000001';

function failAll(status: number, code: string) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify({ code, message: `Simulated ${status}`, request_id: `req-smoke-${status}`, retriable: status >= 500 }), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': `req-smoke-${status}` },
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const screens = WEB_SCREENS.filter((s) => !AUTH_SCREENS.has(s.id) && PAGES[s.id]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('every signed-in screen is registered', () => {
  it('has a page for all 51 non-auth catalog screens', () => {
    expect(screens).toHaveLength(51);
  });
});

describe.each([
  [500, 'internal_error'],
  [403, 'forbidden'],
  [503, 'face_sdk_unavailable'],
])('API returns %i', (status, code) => {
  it.each(screens.map((s) => [s.id, s.route]))('%s %s renders a recoverable state', async (id, route) => {
    const fetchMock = failAll(status, code);
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    const Page = PAGES[id as keyof typeof PAGES]!;
    await act(async () => {
      renderWithProviders(
        <Suspense fallback={<p>loading</p>}>
          <Page />
        </Suspense>,
        { route: `${route}?id=${FAKE_ID}&case=${FAKE_ID}&incident=${FAKE_ID}` },
      );
    });
    // The lazy page resolved and rendered something meaningful.
    await waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument());
    const text = document.body.textContent ?? '';
    expect(text.trim().length).toBeGreaterThan(20);
    if (fetchMock.mock.calls.length > 0) {
      // Pages that loaded data must not show fabricated content: the failure is visible somewhere
      // (error/denied/unavailable state, request id, retry action) or the page is a form that only
      // submits on demand.
      await waitFor(() => {
        const t = document.body.textContent ?? '';
        expect(
          /req-smoke|Retry|do not have access|permission|unavailable|Unavailable|not available|couldn|could not|went wrong|denied|Simulated/i.test(t),
        ).toBe(true);
      });
    }
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });
});
