import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/utils';
import { api, ApiError, authRedirectUrl, http, setAuthRedirectHandler } from './client';
import { connectivity } from './connectivity';

describe('api client', () => {
  const redirects: string[] = [];
  beforeEach(() => {
    redirects.length = 0;
    setAuthRedirectHandler((url) => redirects.push(url));
    window.history.replaceState(null, '', '/web/alerts?channel=behavior');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('sends X-CSRF-Token from the rg_csrf cookie on non-GET requests and includes credentials', async () => {
    document.cookie = 'rg_csrf=csrf-token-123; path=/';
    const fetchMock = mockFetch({ 'POST /v1/incidents/i-1/claim': { body: { id: 'i-1', version: 2 } } });
    await http.post('/v1/incidents/i-1/claim', { expected_version: 1 });
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('csrf-token-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(JSON.stringify({ expected_version: 1 }));
  });

  it('does not send the CSRF header on GET', async () => {
    document.cookie = 'rg_csrf=csrf-token-123; path=/';
    const fetchMock = mockFetch({ 'GET /v1/me': { body: { ok: true } } });
    await http.get('/v1/me');
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });

  it('serializes query params and skips empty values', async () => {
    const fetchMock = mockFetch({ 'GET /v1/incidents': { body: { items: [], next_cursor: null } } });
    await http.get('/v1/incidents', { store_id: 's 1', channel: undefined, q: '', limit: 50 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/v1/incidents?store_id=s+1&limit=50');
  });

  it('parses the documented error body into ApiError', async () => {
    mockFetch({
      'POST /v1/incidents/i-1/claim': {
        status: 409,
        body: { code: 'version_conflict', message: 'Stale version', request_id: 'req-abc', retriable: false, current_version: 7 },
      },
    });
    const err = await http.post('/v1/incidents/i-1/claim', { expected_version: 6 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(409);
    expect(e.code).toBe('version_conflict');
    expect(e.message).toBe('Stale version');
    expect(e.requestId).toBe('req-abc');
    expect(e.retriable).toBe(false);
    expect(e.currentVersion).toBe(7);
    expect(e.isConflict).toBe(true);
  });

  it('parses 422 field_errors and falls back to the X-Request-ID header', async () => {
    mockFetch({
      'POST /v1/stores': {
        status: 422,
        body: { code: 'validation_failed', message: 'Invalid', retriable: false, field_errors: { name: 'required' } },
        headers: { 'X-Request-ID': 'hdr-req-9' },
      },
    });
    const e = (await http.post('/v1/stores', {}).catch((x: unknown) => x)) as ApiError;
    expect(e.fieldErrors).toEqual({ name: 'required' });
    expect(e.requestId).toBe('hdr-req-9');
    expect(e.isValidation).toBe(true);
  });

  it('tolerates non-JSON error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    const e = (await api('/v1/me').catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(502);
    expect(e.code).toBe('http_502');
    expect(e.retriable).toBe(true);
  });

  it('redirects to login with next= on 401 session_expired', async () => {
    mockFetch({ 'GET /v1/me': { status: 401, body: { code: 'session_expired', message: 'Expired', request_id: 'r', retriable: false } } });
    await http.get('/v1/me').catch(() => undefined);
    expect(redirects).toEqual(['/web/login?next=%2Fweb%2Falerts%3Fchannel%3Dbehavior']);
  });

  it('redirects to MFA for mfa_required and to enrollment for mfa_enrollment_required', async () => {
    mockFetch({ 'GET /v1/me': { status: 401, body: { code: 'mfa_required', message: 'MFA', request_id: 'r', retriable: false } } });
    await http.get('/v1/me').catch(() => undefined);
    mockFetch({ 'GET /v1/dashboard': { status: 401, body: { code: 'mfa_enrollment_required', message: 'MFA', request_id: 'r', retriable: false } } });
    await http.get('/v1/dashboard').catch(() => undefined);
    expect(redirects[0]).toBe('/web/mfa?next=%2Fweb%2Falerts%3Fchannel%3Dbehavior');
    expect(redirects[1]).toBe('/web/mfa?enroll=1&next=%2Fweb%2Falerts%3Fchannel%3Dbehavior');
  });

  it('does not redirect for other 401 codes or when authRedirect is false', async () => {
    mockFetch({ 'POST /v1/auth/login': { status: 401, body: { code: 'invalid_credentials', message: 'x', request_id: 'r', retriable: false } } });
    await http.post('/v1/auth/login', {}).catch(() => undefined);
    mockFetch({ 'GET /v1/me': { status: 401, body: { code: 'session_expired', message: 'x', request_id: 'r', retriable: false } } });
    await http.get('/v1/me', undefined, { authRedirect: false }).catch(() => undefined);
    expect(redirects).toEqual([]);
  });

  it('never puts auth pages in next=', () => {
    expect(authRedirectUrl('session_expired', '/web/mfa?enroll=1')).toBe('/web/login');
    expect(authRedirectUrl('forbidden', '/web/alerts')).toBeNull();
  });

  it('maps network failures to a retriable network_error and records the failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const e = (await http.get('/v1/dashboard').catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe('network_error');
    expect(e.status).toBe(0);
    expect(e.retriable).toBe(true);
    expect(connectivity.snapshot().lastFailure?.path).toBe('/v1/dashboard');
    expect(connectivity.snapshot().online).toBe(false);
  });

  it('times out with code timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
      ),
    );
    const e = (await http.get('/v1/dashboard', undefined, { timeoutMs: 10 }).catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe('timeout');
  });
});
