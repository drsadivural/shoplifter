// The four-state pattern. Wrap every data-driven page/section:
//
//   const q = useApiQuery((signal) => endpoints.dashboard(store.id, { signal }), [store.id]);
//   <RouteStateBoundary query={q} permission="dashboard.read" isEmpty={(d) => d.items.length === 0}
//                       empty={<EmptyState title={t('No alerts to review')} />}>
//     {(data) => <Ready data={data} />}
//   </RouteStateBoundary>
//
// Order: permission-denied (client check) -> loading (no data yet) -> error (403 -> denied,
// 404 -> not found, 503 -> UnavailableNotice, else ErrorState + Retry + request id) -> empty -> ready.
// If a background reload fails while data is shown, the data stays and a compact error is shown above it.
import type { ReactNode } from 'react';
import type { ApiError } from '../api/client';
import type { Permission } from '../api/types';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';
import { Button } from './primitives';
import { EmptyState, ErrorState, LoadingState, PermissionDenied, UnavailableNotice } from './states';

export interface QueryLike<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

export interface RouteStateBoundaryProps<T> {
  query: QueryLike<T>;
  /** Client-side permission gate (server still enforces). */
  permission?: Permission;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  /** Custom skeleton; default page skeleton. */
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}

export function RouteStateBoundary<T>({ query, permission, isEmpty, empty, loading, children }: RouteStateBoundaryProps<T>) {
  const { can } = useSession();
  const { t } = useI18n();
  if (permission && !can(permission)) return <PermissionDenied permission={permission} />;

  const { data, error } = query;
  if (data === undefined) {
    if (error) return <QueryErrorView error={error} onRetry={query.reload} />;
    return <>{loading ?? <LoadingState />}</>;
  }
  return (
    <>
      {error ? <ErrorState error={error} onRetry={query.reload} compact title={t('Showing the last loaded data — refresh failed')} /> : null}
      {isEmpty?.(data) ? (empty ?? <EmptyState title={t('Nothing to show yet')} />) : children(data)}
    </>
  );
}

/** Maps an ApiError to the right state component. Also used by DataTable and detail pages. */
export function QueryErrorView({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const { t } = useI18n();
  if (error.isForbidden) return <PermissionDenied />;
  if (error.isNotFound)
    return (
      <EmptyState
        icon="search"
        title={t('Record not found')}
        description={t('It may have been deleted, or it is outside the stores you can access.')}
      />
    );
  if (error.isUnavailable)
    return (
      <UnavailableNotice
        code={error.code}
        action={
          onRetry ? (
            <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
              {t('Retry')}
            </Button>
          ) : undefined
        }
      />
    );
  return <ErrorState error={error} onRetry={onRetry} />;
}
