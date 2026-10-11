// Shared UI for group D screens (enrollment, people, administration, settings).
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { PagedResult } from '../../api/hooks';
import type { Id, ProfileStatus, Role } from '../../api/types';
import { hasTranslation, useI18n } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { AuthenticatedImage } from '../media';
import { Badge, Button, StatusPill, type Tone } from '../primitives';
import type { QueryLike } from '../RouteStateBoundary';
import type { PhotoD, ProfileDetailD } from './api';

// ------------------------------------------------------------------ status pills

const PROFILE_STATUS: Record<ProfileStatus, [Tone, string]> = {
  draft: ['neutral', 'profile|Draft'],
  pending_review: ['warning', 'profile|Pending approval'],
  approved: ['ok', 'profile|Approved'],
  suspended: ['critical', 'profile|Suspended'],
  expired: ['neutral', 'profile|Expired'],
  deleted: ['neutral', 'profile|Deleted'],
};

export function profileStatusKey(status: ProfileStatus): string {
  return PROFILE_STATUS[status]?.[1] ?? status;
}

export function ProfileStatusPill({ status }: { status: ProfileStatus }) {
  const { t } = useI18n();
  const [tone, key] = PROFILE_STATUS[status] ?? ['neutral', status];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

const PHOTO_STATUS: Record<string, [Tone, string]> = {
  pending: ['warning', 'photo|Pending review'],
  approved: ['ok', 'photo|Approved'],
  rejected: ['critical', 'photo|Rejected'],
  deleted: ['neutral', 'photo|Deleted'],
};

export function PhotoStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const [tone, key] = PHOTO_STATUS[status] ?? ['neutral', status];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

const GALLERY: Record<string, [Tone, string]> = {
  not_in_gallery: ['neutral', 'gallery|Not used for matching'],
  face_sdk_unavailable: ['warning', 'gallery|Record only — face SDK not installed'],
  in_gallery: ['ok', 'gallery|In the matching gallery'],
};

export function GalleryStatePill({ state }: { state: string }) {
  const { t } = useI18n();
  const [tone, key] = GALLERY[state] ?? ['neutral', state];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

export const ROLES: Role[] = ['viewer', 'responder', 'investigator', 'store_admin', 'org_admin'];

export function RoleLabel({ role }: { role: Role | string }) {
  const { t } = useI18n();
  return <>{t(`role|${role}`)}</>;
}

// ------------------------------------------------------------------ stores

/** Store names for ids; ids outside the viewer's assigned stores are counted, never guessed. */
export function StoreNames({ ids, allLabel }: { ids: Id[]; allLabel?: string }) {
  const { t } = useI18n();
  const { stores } = useSession();
  if (ids.length === 0) return <span className="muted">{allLabel ?? t('No stores')}</span>;
  const known = ids.map((id) => stores.find((s) => s.id === id)?.name).filter((n): n is string => Boolean(n));
  const hidden = ids.length - known.length;
  return (
    <span>
      {known.join(' · ')}
      {hidden > 0 ? (
        <span className="muted">
          {known.length ? ' · ' : ''}
          {t('{n} other stores', { n: hidden })}
        </span>
      ) : null}
    </span>
  );
}

/** Multi-select of the viewer's assigned stores (checkbox group). */
export function StoreMultiSelect({
  label,
  value,
  onChange,
  hint,
  error,
  required,
}: {
  label: string;
  value: Id[];
  onChange: (ids: Id[]) => void;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
}) {
  const { t } = useI18n();
  const { stores } = useSession();
  const id = useId();
  const toggle = (sid: Id, on: boolean) => onChange(on ? [...new Set([...value, sid])] : value.filter((v) => v !== sid));
  return (
    <fieldset className={`field gd-fieldset ${error ? 'field-invalid' : ''}`} aria-describedby={[hint ? `${id}-h` : '', error ? `${id}-e` : ''].join(' ').trim() || undefined}>
      <legend>
        {label}
        {required ? (
          <span className="required-marker" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="visually-hidden"> ({t('required')})</span> : null}
      </legend>
      {stores.length === 0 ? (
        <p className="muted small">{t('No stores are assigned to you.')}</p>
      ) : (
        <div className="gd-checks">
          {stores.map((s) => (
            <label key={s.id} className="gd-check">
              <input type="checkbox" checked={value.includes(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />
              <span>{s.name}</span>
            </label>
          ))}
        </div>
      )}
      {hint ? (
        <div className="help" id={`${id}-h`}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="field-error" id={`${id}-e`}>
          <span aria-hidden="true">▲ </span>
          {error}
        </div>
      ) : null}
    </fieldset>
  );
}

// ------------------------------------------------------------------ photos

/** Measured image statistics (no face SDK): resolution, sharpness, brightness and problems. */
export function PhotoQuality({ photo, compact = false }: { photo: PhotoD; compact?: boolean }) {
  const { t } = useI18n();
  const img = photo.quality?.image;
  const problems = img?.problems ?? [];
  const face = photo.quality?.face;
  return (
    <div className="gd-quality">
      {img ? (
        <dl className="gd-quality-list">
          <div>
            <dt>{t('Resolution')}</dt>
            <dd className="mono">
              {img.width} × {img.height}
            </dd>
          </div>
          <div>
            <dt>{t('Sharpness')}</dt>
            <dd className="mono">{img.sharpness}</dd>
          </div>
          <div>
            <dt>{t('Exposure')}</dt>
            <dd className="mono">{img.brightness}</dd>
          </div>
        </dl>
      ) : (
        <p className="muted small">{t('No measured image statistics were recorded.')}</p>
      )}
      {problems.length > 0 ? (
        <div className="gd-problems">
          {problems.map((p) => (
            <Badge key={p} tone="warning">
              {hasTranslation('en', `quality|${p}`) ? t(`quality|${p}`) : p}
            </Badge>
          ))}
        </div>
      ) : img ? (
        <p className="small">
          <Badge tone="ok">{t('Measured checks passed')}</Badge>
        </p>
      ) : null}
      {!compact && face && face.status !== 'available' ? (
        <p className="muted small">{t('Face quality checks unavailable — licensed SDK not installed')}</p>
      ) : null}
    </div>
  );
}

export function PhotoThumb({ photo, alt }: { photo: PhotoD; alt: string }) {
  return <AuthenticatedImage mediaId={photo.thumb_media_id} variant={undefined} alt={alt} className="gd-thumb" />;
}

// ------------------------------------------------------------------ shown-once secrets

/** A URL/token that the server returns once. Offers copy and states it will not be shown again. */
export function OnceSecret({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <div className="gd-secret" role="status">
      <div className="gd-secret-label">{label}</div>
      <code className="gd-secret-value mono" tabIndex={0}>
        {value}
      </code>
      <div className="gd-secret-actions">
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {t('Copy link')}
        </Button>
        <span aria-live="polite" className="small">
          {copied === 'ok' ? t('Copied') : copied === 'failed' ? t('Copy failed — select the text and copy it manually.') : ''}
        </span>
      </div>
      <p className="muted small">{t('This link is shown only once. It cannot be displayed again after you leave this page.')}</p>
      {note ? <p className="small">{note}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ history

export function auditActionLabel(t: (k: string) => string, locale: 'en' | 'ja', action: string): string {
  const key = `audit|${action}`;
  return hasTranslation(locale, key) || hasTranslation('en', key) ? t(key) : action;
}

export function ProfileHistory({ history, timeZone }: { history: ProfileDetailD['history']; timeZone: string }) {
  const { t, fmt, locale } = useI18n();
  if (history.length === 0) return <p className="muted">{t('No changes recorded yet.')}</p>;
  return (
    <ol className="timeline-list gd-history">
      {history.map((h, i) => {
        const reason = typeof h.detail?.reason === 'string' ? h.detail.reason : null;
        const reset = h.detail?.approval_reset === true;
        return (
          <li key={`${h.at}-${i}`}>
            <span className="timeline-dot" aria-hidden="true" />
            <time dateTime={h.at}>{fmt.dateTime(h.at, timeZone, { seconds: false })}</time> · {auditActionLabel(t, locale, h.action)}
            {h.actor ? <span className="muted"> · {h.actor}</span> : null}
            {reset ? (
              <>
                {' '}
                <Badge tone="warning">{t('Approval reset')}</Badge>
              </>
            ) : null}
            {reason ? <div className="muted small">{t('Reason')}: {reason}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------------ query adapters

/** Lets RouteStateBoundary render a usePagedQuery (all items; the profile API returns one page). */
export function pagedAsQuery<T>(q: PagedResult<T>): QueryLike<T[]> {
  return { data: q.status === 'success' ? q.items : undefined, error: q.error, loading: q.loading, reload: q.reload };
}

/** Back link used by detail pages without an id. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="link-sm">
      ← {children}
    </Link>
  );
}
