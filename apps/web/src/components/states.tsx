// Page/section states. Every data view must render one of: loading, ready, empty, error,
// permission-denied (and, for dependency outages, an UnavailableNotice). See RouteStateBoundary.
import type { ReactNode } from 'react';
import type { ApiError } from '../api/client';
import { errorMessageKey } from '../api/hooks';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './Icon';
import { Button } from './primitives';

export function EmptyState({
  title,
  description,
  action,
  icon = 'check',
  compact = false,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  compact?: boolean;
}) {
  return (
    <div className={`state state-empty ${compact ? 'state-compact' : ''}`}>
      <div className="state-icon" aria-hidden="true">
        <Icon name={icon} size={compact ? 22 : 32} />
      </div>
      <h3 className="state-title">{title}</h3>
      {description ? <p className="muted">{description}</p> : null}
      {action ? <div className="state-actions">{action}</div> : null}
    </div>
  );
}

/** Error with Retry and the request id. Pass the ApiError from a query/mutation. */
export function ErrorState({
  error,
  onRetry,
  title,
  compact = false,
}: {
  error: ApiError | undefined;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={`state state-error ${compact ? 'state-compact' : ''}`} role="alert">
      <div className="state-icon state-icon-critical" aria-hidden="true">
        <Icon name={error?.isNetwork ? 'wifiOff' : 'warning'} size={compact ? 22 : 32} />
      </div>
      <h3 className="state-title">{title ?? t('This information could not be loaded')}</h3>
      <p className="muted">{error ? t(errorMessageKey(error)) : null}</p>
      {error && error.message && error.code !== 'network_error' && error.code !== 'timeout' ? (
        <p className="muted small">{error.message}</p>
      ) : null}
      {error?.requestId ? (
        <p className="muted small mono">
          {t('Request ID')}: {error.requestId}
        </p>
      ) : null}
      {onRetry ? (
        <div className="state-actions">
          <Button variant="secondary" icon="refresh" onClick={onRetry}>
            {t('Retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Skeleton placeholder. `variant` picks a shape matching the content being loaded. */
export function LoadingState({ variant = 'page', rows = 4, label }: { variant?: 'page' | 'table' | 'cards' | 'inline'; rows?: number; label?: string }) {
  const { t } = useI18n();
  const text = label ?? t('Loading…');
  if (variant === 'inline') {
    return (
      <div className="skeleton-inline" role="status" aria-live="polite">
        <span className="skeleton skeleton-line" style={{ width: '60%' }} />
        <span className="visually-hidden">{text}</span>
      </div>
    );
  }
  return (
    <div className={`loading loading-${variant}`} role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{text}</span>
      {variant === 'page' ? (
        <>
          <div className="skeleton-stats">
            {Array.from({ length: 4 }, (_, i) => (
              <div className="skeleton skeleton-card" key={i} />
            ))}
          </div>
          <div className="skeleton-grid">
            <div className="skeleton skeleton-panel" />
            <div className="skeleton skeleton-panel" />
          </div>
        </>
      ) : variant === 'cards' ? (
        <div className="skeleton-cards">
          {Array.from({ length: rows }, (_, i) => (
            <div className="skeleton skeleton-panel" key={i} />
          ))}
        </div>
      ) : (
        Array.from({ length: rows }, (_, i) => <div className="skeleton skeleton-row" key={i} />)
      )}
    </div>
  );
}

export function PermissionDenied({ permission }: { permission?: string | null }) {
  const { t } = useI18n();
  return (
    <div className="state state-denied" role="alert">
      <div className="state-icon" aria-hidden="true">
        <Icon name="lock" size={32} />
      </div>
      <h3 className="state-title">{t('You do not have access to this page')}</h3>
      <p className="muted">{t('Your role or store assignment does not include this information. Ask an organization administrator if you need access.')}</p>
      {permission ? (
        <p className="muted small mono">
          {t('Required permission')}: {permission}
        </p>
      ) : null}
    </div>
  );
}

export const DEPENDENCY_TEXT: Record<string, { title: string; body: string }> = {
  face_sdk_unavailable: {
    title: 'Face matching is unavailable',
    body: 'The licensed face SDK is not installed or not licensed on this deployment. Photos can be stored and reviewed, but no face templates or matches are produced.',
  },
  model_unavailable: {
    title: 'Behavior model is unavailable',
    body: 'No validated behavior model is installed for this camera or store. Cameras stay unanalyzed instead of reporting zero risk.',
  },
  edge_unavailable: {
    title: 'Store edge appliance is offline',
    body: 'No online edge appliance is paired with this store. Discovery, live view and analysis require a connected edge.',
  },
  push_unconfigured: {
    title: 'Push notifications are not configured',
    body: 'APNs credentials are not configured for this deployment. In-app notifications still work.',
  },
  oidc_unconfigured: {
    title: 'Company SSO is not configured',
    body: 'Single sign-on has not been set up for this workspace. Sign in with your work email and password, or ask your administrator.',
  },
};

/** Explains WHY a dependency (face SDK, models, edge, push, SSO) is unavailable. Never a fake zero. */
export function UnavailableNotice({
  code,
  title,
  children,
  action,
}: {
  /** API 503 code, e.g. face_sdk_unavailable. Picks a standard explanation. */
  code?: string;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  const std = code ? DEPENDENCY_TEXT[code] : undefined;
  return (
    <div className="unavailable" role="status">
      <Icon name="info" size={18} />
      <div>
        <strong>{title ?? (std ? t(std.title) : t('This capability is unavailable'))}</strong>
        <div className="muted">{children ?? (std ? t(std.body) : null)}</div>
        {code ? <div className="muted small mono">{code}</div> : null}
        {action ? <div className="unavailable-action">{action}</div> : null}
      </div>
    </div>
  );
}

/** 409 conflict: the record changed elsewhere. Show the current version; never blindly retry. */
export function ConflictBanner({ onReload, currentVersion, reloading }: { onReload: () => void; currentVersion?: number | null; reloading?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="conflict-banner" role="alert">
      <Icon name="warning" size={18} />
      <div className="conflict-text">
        <strong>{t('Updated by someone else — showing current version')}</strong>
        <div className="muted small">
          {t('Review the current state before acting again.')}
          {currentVersion ? ` ${t('Current version')}: ${currentVersion}` : ''}
        </div>
      </div>
      <Button variant="secondary" size="sm" icon="refresh" onClick={onReload} pending={reloading}>
        {t('Reload')}
      </Button>
    </div>
  );
}

/** Placeholder for catalog screens not implemented yet. Names the screen id so it is traceable. */
export function NotYetImplemented({ screenId, title }: { screenId: string; title: string }) {
  const { t } = useI18n();
  return (
    <div className="card">
      <div className="state" data-testid="not-yet-implemented">
        <div className="state-icon" aria-hidden="true">
          <Icon name="info" size={32} />
        </div>
        <h3 className="state-title">{t('Screen not yet implemented')}</h3>
        <p className="muted">
          {screenId} · {title}
        </p>
        <p className="muted small">{t('This screen is registered in the route table and will be delivered in a later slice. No placeholder data is shown.')}</p>
      </div>
    </div>
  );
}
