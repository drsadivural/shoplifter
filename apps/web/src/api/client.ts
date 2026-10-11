// Same-origin fetch client for /v1 (docs/API_V1.md).
// - cookies: credentials "include" (session cookie rg_session is HttpOnly)
// - CSRF:    every non-GET/HEAD request sends X-CSRF-Token = value of the rg_csrf cookie
// - errors:  every non-2xx becomes a typed ApiError (status, code, message, request_id, ...)
// - 401:     session_expired / authentication_required -> /web/login?next=...
//            mfa_required -> /web/mfa?next=..., mfa_enrollment_required -> /web/mfa?enroll=1&next=...
import { connectivity } from './connectivity';
import type { ApiErrorBody } from './types';

export const DEFAULT_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
export const CSRF_COOKIE = 'rg_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retriable: boolean;
  readonly fieldErrors: Record<string, string>;
  readonly currentVersion: number | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    requestId?: string | null;
    retriable?: boolean;
    fieldErrors?: Record<string, string>;
    currentVersion?: number | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.retriable = init.retriable ?? false;
    this.fieldErrors = init.fieldErrors ?? {};
    this.currentVersion = init.currentVersion ?? null;
  }

  /** 409 version conflict / owned by another responder: refetch and show current state. */
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isForbidden(): boolean {
    return this.status === 403 && this.code !== 'csrf_failed';
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  /** 503 dependency unavailable (face_sdk_unavailable, model_unavailable, edge_unavailable, ...). */
  get isUnavailable(): boolean {
    return this.status === 503;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
  get isValidation(): boolean {
    return this.status === 422 || Object.keys(this.fieldErrors).length > 0;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError')
  );
}

// ------------------------------------------------------------------ auth redirect

export const AUTH_REDIRECT_CODES: Record<string, 'login' | 'mfa' | 'mfa_enroll'> = {
  authentication_required: 'login',
  session_expired: 'login',
  mfa_required: 'mfa',
  mfa_enrollment_required: 'mfa_enroll',
};

export type AuthRedirectHandler = (url: string) => void;

let authRedirectHandler: AuthRedirectHandler = (url) => {
  window.location.assign(url);
};

/** Override how the client navigates on 401 (tests, or router-based navigation). */
export function setAuthRedirectHandler(handler: AuthRedirectHandler): void {
  authRedirectHandler = handler;
}

const PUBLIC_PATHS = ['/web/login', '/web/mfa', '/web/reset', '/web/invite'];

export function authRedirectUrl(code: string, currentPath: string): string | null {
  const kind = AUTH_REDIRECT_CODES[code];
  if (!kind) return null;
  const pathOnly = currentPath.split('?')[0] ?? currentPath;
  const isPublic = PUBLIC_PATHS.some((p) => pathOnly === p || pathOnly.startsWith(p + '/'));
  const next = isPublic ? null : currentPath;
  const q = new URLSearchParams();
  if (kind === 'mfa_enroll') q.set('enroll', '1');
  if (next && next !== '/' && next !== '/web/login') q.set('next', next);
  const base = kind === 'login' ? '/web/login' : '/web/mfa';
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

function maybeRedirect(err: ApiError): void {
  if (err.status !== 401) return;
  const current = window.location.pathname + window.location.search;
  const url = authRedirectUrl(err.code, current);
  if (!url) return;
  // Avoid loops: already on the target page.
  const target = url.split('?')[0];
  if (window.location.pathname === target) return;
  authRedirectHandler(url);
}

// ------------------------------------------------------------------ helpers

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export type QueryValue = string | number | boolean | null | undefined;

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const qs = q.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

function isMutating(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/** Parse an error response into ApiError (tolerates non-JSON bodies from proxies). */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  const headerRequestId = res.headers.get('X-Request-ID');
  let body: Partial<ApiErrorBody> | null = null;
  try {
    const text = await res.text();
    body = text ? (JSON.parse(text) as Partial<ApiErrorBody>) : null;
  } catch {
    body = null;
  }
  return errorFromBody(res.status, body, headerRequestId);
}

function errorFromBody(status: number, body: Partial<ApiErrorBody> | null, headerRequestId: string | null): ApiError {
  return new ApiError({
    status,
    code: typeof body?.code === 'string' ? body.code : `http_${status}`,
    message: typeof body?.message === 'string' ? body.message : `Request failed (${status})`,
    requestId: (typeof body?.request_id === 'string' ? body.request_id : null) ?? headerRequestId,
    retriable: typeof body?.retriable === 'boolean' ? body.retriable : status >= 500 || status === 429,
    fieldErrors: body?.field_errors ?? {},
    currentVersion: typeof body?.current_version === 'number' ? body.current_version : null,
  });
}

// ------------------------------------------------------------------ request

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  /** JSON body (serialized with JSON.stringify). */
  json?: unknown;
  /** Multipart body. Use apiUpload() when you need progress events. */
  form?: FormData;
  /** Raw body (rare). */
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Set false on screens that handle 401 themselves (e.g. the login form). Default true. */
  authRedirect?: boolean;
}

export interface ApiResponse<T> {
  data: T;
  requestId: string | null;
  status: number;
}

/** Low-level request returning data + request id. Most callers use api() instead. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const method = opts.method ?? 'GET';
  const url = buildUrl(path, opts.query);
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body: BodyInit | undefined = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form; // browser sets multipart boundary
  }
  if (isMutating(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, credentials: 'include', signal: controller.signal });
  } catch (e) {
    if (timedOut) {
      const err = new ApiError({ status: 0, code: 'timeout', message: 'The request timed out.', retriable: true });
      connectivity.markFailure({ method, path: url, error: err });
      throw err;
    }
    if (isAbortError(e) || opts.signal?.aborted) throw e;
    const err = new ApiError({ status: 0, code: 'network_error', message: 'The server could not be reached.', retriable: true });
    connectivity.markFailure({ method, path: url, error: err });
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  const requestId = res.headers.get('X-Request-ID');
  if (!res.ok) {
    const err = await errorFromResponse(res);
    if (err.status >= 500 && err.status !== 503) connectivity.markFailure({ method, path: url, error: err });
    else connectivity.markSuccess();
    if (opts.authRedirect !== false) maybeRedirect(err);
    throw err;
  }
  connectivity.markSuccess();
  if (res.status === 204) return { data: undefined as T, requestId, status: res.status };
  const text = await res.text();
  let data: T;
  try {
    data = (text ? JSON.parse(text) : undefined) as T;
  } catch {
    throw new ApiError({ status: res.status, code: 'invalid_response', message: 'The server returned an unreadable response.', requestId });
  }
  return { data, requestId, status: res.status };
}

/** Typed JSON request. Throws ApiError. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await request<T>(path, opts)).data;
}

export const http = {
  get: <T>(path: string, query?: Record<string, QueryValue>, opts?: Omit<RequestOptions, 'method' | 'query'>) =>
    api<T>(path, { ...opts, method: 'GET', query }),
  post: <T>(path: string, json?: unknown, opts?: Omit<RequestOptions, 'method' | 'json'>) =>
    api<T>(path, { ...opts, method: 'POST', json: json ?? {} }),
  put: <T>(path: string, json?: unknown, opts?: Omit<RequestOptions, 'method' | 'json'>) =>
    api<T>(path, { ...opts, method: 'PUT', json: json ?? {} }),
  patch: <T>(path: string, json?: unknown, opts?: Omit<RequestOptions, 'method' | 'json'>) =>
    api<T>(path, { ...opts, method: 'PATCH', json: json ?? {} }),
  del: <T>(path: string, opts?: Omit<RequestOptions, 'method'>) => api<T>(path, { ...opts, method: 'DELETE' }),
  /** Multipart POST without progress. */
  postForm: <T>(path: string, form: FormData, opts?: Omit<RequestOptions, 'method' | 'form'>) =>
    api<T>(path, { timeoutMs: UPLOAD_TIMEOUT_MS, ...opts, method: 'POST', form }),
};

// ------------------------------------------------------------------ upload with progress

export interface UploadOptions {
  method?: 'POST' | 'PUT';
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Multipart upload with progress events (XMLHttpRequest; fetch has no upload progress). */
export function apiUpload<T>(path: string, form: FormData, opts: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? 'POST', path, true);
    xhr.withCredentials = true;
    xhr.timeout = opts.timeoutMs ?? UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader('Accept', 'application/json');
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) opts.onProgress?.(ev.loaded / ev.total);
    };
    xhr.onload = () => {
      const requestId = xhr.getResponseHeader('X-Request-ID');
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        connectivity.markSuccess();
        opts.onProgress?.(1);
        resolve(body as T);
      } else {
        const err = errorFromBody(xhr.status, body as Partial<ApiErrorBody> | null, requestId);
        maybeRedirect(err);
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new ApiError({ status: 0, code: 'network_error', message: 'The server could not be reached.', retriable: true });
      connectivity.markFailure({ method: 'POST', path, error: err });
      reject(err);
    };
    xhr.ontimeout = () =>
      reject(new ApiError({ status: 0, code: 'timeout', message: 'The upload timed out.', retriable: true }));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** URL for authenticated media bytes. Same-origin cookie auth, so <img src>/<video src> work. */
export function mediaUrl(mediaId: string, variant?: 'thumb'): string {
  return buildUrl(`/v1/media/${encodeURIComponent(mediaId)}`, { variant });
}
