// Data hooks: useApiQuery (single resource), usePagedQuery (cursor lists with "Load more"),
// useMutation (commands with pending / error / field errors + toast feedback).
import { useCallback, useEffect, useRef, useState, type DependencyList, type Dispatch, type SetStateAction } from 'react';
import { useToastOptional } from '../components/Toast';
import { useI18n } from '../i18n';
import { ApiError, isAbortError, isApiError } from './client';
import type { Paged } from './types';

export function toApiError(e: unknown): ApiError {
  if (isApiError(e)) return e;
  return new ApiError({
    status: -1,
    code: 'client_error',
    message: e instanceof Error ? e.message : String(e),
    retriable: false,
  });
}

// ------------------------------------------------------------------ useApiQuery

function safeKey(deps: DependencyList): string {
  try {
    return JSON.stringify(deps);
  } catch {
    return String(deps.length) + deps.map(String).join('|');
  }
}

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QueryResult<T> {
  data: T | undefined;
  error: ApiError | undefined;
  status: QueryStatus;
  /** True while there is no data yet and a request is in flight. */
  loading: boolean;
  /** True whenever a request is in flight (including background reloads). */
  fetching: boolean;
  reload: () => void;
  setData: Dispatch<SetStateAction<T | undefined>>;
}

export interface QueryOptions {
  /** Skip fetching while false (e.g. waiting for a store id). Default true. */
  enabled?: boolean;
  /** Re-fetch every N ms while the tab is visible (keeps data, no loading flash). */
  pollMs?: number;
}

export function useApiQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  options: QueryOptions = {},
): QueryResult<T> {
  const { enabled = true, pollMs } = options;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [status, setStatus] = useState<QueryStatus>(enabled ? 'loading' : 'idle');
  const [fetching, setFetching] = useState(false);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const depsKey = safeKey(deps);
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    const identityChanged = prevKey.current !== null && prevKey.current !== depsKey;
    prevKey.current = depsKey;
    setFetching(true);
    if (identityChanged) {
      // A different resource (e.g. another store): never show the previous one's data.
      setData(undefined);
      setError(undefined);
      setStatus('loading');
    } else {
      setStatus((s) => (s === 'success' ? s : 'loading'));
    }
    fetcherRef
      .current(controller.signal)
      .then((d) => {
        if (controller.signal.aborted) return;
        setData(d);
        setError(undefined);
        setStatus('success');
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || isAbortError(e)) return;
        setError(toApiError(e));
        setStatus('error');
      })
      .finally(() => {
        if (!controller.signal.aborted) setFetching(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, depsKey]);

  useEffect(() => {
    if (!pollMs || !enabled) return;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') setTick((t) => t + 1);
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, enabled]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, status, loading: status === 'loading' && data === undefined, fetching, reload, setData };
}

// ------------------------------------------------------------------ usePagedQuery

export interface PagedResult<T> {
  items: T[];
  status: QueryStatus;
  error: ApiError | undefined;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: ApiError | undefined;
  loadMore: () => void;
  reload: () => void;
  setItems: Dispatch<SetStateAction<T[]>>;
}

/** Cursor pagination: first page on mount / deps change, then loadMore() appends next_cursor pages. */
export function usePagedQuery<T>(
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Paged<T>>,
  deps: DependencyList,
  options: { enabled?: boolean } = {},
): PagedResult<T> {
  const { enabled = true } = options;
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<QueryStatus>(enabled ? 'loading' : 'idle');
  const [error, setError] = useState<ApiError | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<ApiError | undefined>();
  const [tick, setTick] = useState(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const moreController = useRef<AbortController | null>(null);
  const depsKey = safeKey(deps);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    moreController.current?.abort();
    setStatus('loading');
    setItems([]);
    setCursor(null);
    setError(undefined);
    setLoadMoreError(undefined);
    fetchRef
      .current(null, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setStatus('success');
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || isAbortError(e)) return;
        setError(toApiError(e));
        setStatus('error');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, depsKey]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setLoadMoreError(undefined);
    fetchRef
      .current(cursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.next_cursor);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || isAbortError(e)) return;
        setLoadMoreError(toApiError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false);
      });
  }, [cursor, loadingMore]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return {
    items,
    status,
    error,
    loading: status === 'loading',
    hasMore: cursor !== null,
    loadingMore,
    loadMoreError,
    loadMore,
    reload,
    setItems,
  };
}

// ------------------------------------------------------------------ useMutation

export type MutationResult<R> = { ok: true; data: R } | { ok: false; error: ApiError };

export interface MutationOptions<R> {
  /** Toast on success (already-translated text, or a function of the result). */
  successMessage?: string | ((result: R) => string);
  onSuccess?: (result: R) => void;
  /**
   * Called on failure. Return true when the screen handled it (e.g. 409 -> ConflictBanner,
   * 422 -> inline field errors) to suppress the generic error toast.
   */
  onError?: (error: ApiError) => boolean | void;
  /** Default true: failures show a toast including the request id. */
  toastErrors?: boolean;
}

export interface MutationState<A, R> {
  run: (args: A) => Promise<MutationResult<R>>;
  pending: boolean;
  error: ApiError | undefined;
  /** Server field errors (422) keyed by request field name; values are error codes. */
  fieldErrors: Record<string, string>;
  reset: () => void;
}

export function useMutation<A, R>(fn: (args: A) => Promise<R>, options: MutationOptions<R> = {}): MutationState<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();
  const toast = useToastOptional();
  const { t } = useI18n();
  const inFlight = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(options);
  optsRef.current = options;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (args: A): Promise<MutationResult<R>> => {
      // Prevent duplicate commands from double clicks.
      if (inFlight.current) return { ok: false, error: new ApiError({ status: -1, code: 'already_pending', message: 'Already in progress' }) };
      inFlight.current = true;
      setPending(true);
      setError(undefined);
      try {
        const data = await fnRef.current(args);
        const { successMessage, onSuccess } = optsRef.current;
        if (successMessage && toast) {
          toast.show({ tone: 'success', message: typeof successMessage === 'function' ? successMessage(data) : successMessage });
        }
        onSuccess?.(data);
        return { ok: true, data };
      } catch (e) {
        const err = toApiError(e);
        if (mounted.current) setError(err);
        const handled = optsRef.current.onError?.(err) === true;
        if (!handled && optsRef.current.toastErrors !== false && toast && err.status !== 401) {
          toast.show({ tone: 'error', message: t(errorMessageKey(err)), detail: err.message, requestId: err.requestId });
        }
        return { ok: false, error: err };
      } finally {
        inFlight.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [toast, t],
  );

  const reset = useCallback(() => setError(undefined), []);
  return { run, pending, error, fieldErrors: error?.fieldErrors ?? {}, reset };
}

/** Maps an ApiError to a translatable generic message key (see i18n/app.ts). */
export function errorMessageKey(err: ApiError): string {
  if (err.code === 'network_error') return 'The server could not be reached. Check the connection and try again.';
  if (err.code === 'timeout') return 'The request timed out. Try again.';
  if (err.code === 'csrf_failed') return 'Your session security token expired. Reload the page and try again.';
  if (err.status === 403) return 'You do not have permission to do this.';
  if (err.status === 404) return 'This record was not found or is outside your store access.';
  if (err.status === 409) return 'Updated by someone else — showing current version';
  if (err.status === 413) return 'The file is too large.';
  if (err.status === 415) return 'This file type is not supported.';
  if (err.status === 422) return 'Some fields need attention.';
  if (err.status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (err.status === 503) return 'A required service is unavailable.';
  return 'The action could not be completed.';
}
