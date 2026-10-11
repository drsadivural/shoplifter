// web-34 Photo library. GET /v1/photos?kind=&status= (scoped by the server; staff photos only for
// staff.manage). Thumbnails load through authenticated /v1/media/{thumb_media_id}; measured image
// quality only (face checks need the licensed SDK). Each photo opens its profile.
import '../styles/group-d.css';
import { useSearchParams } from 'react-router';
import { usePagedQuery } from '../api/hooks';
import type { ProfileKind } from '../api/types';
import { gd, type PhotoD } from '../components/groupd/api';
import { pagedAsQuery, PhotoQuality, PhotoStatusPill } from '../components/groupd/ui';
import { Select } from '../components/forms';
import { AuthenticatedImage } from '../components/media';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, FilterTabs, Notice, StatCard } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

type KindTab = 'all' | ProfileKind;
const STATUSES = ['pending', 'approved', 'rejected'] as const;

export default function PhotosPage() {
  const { t, fmt } = useI18n();
  const { can, me, timeZone } = useSession();
  const [params, setParams] = useSearchParams();
  const staffAllowed = can('staff.manage');
  const rawKind = params.get('kind');
  const kind: KindTab = rawKind === 'watchlist' || (rawKind === 'staff' && staffAllowed) ? rawKind : 'all';
  const status = (STATUSES as readonly string[]).includes(params.get('status') ?? '') ? params.get('status')! : '';
  const tz = me?.org.timezone ?? timeZone;

  const list = usePagedQuery(
    (_c, signal) => gd.photos.list({ kind: kind === 'all' ? undefined : kind, status }, { signal }),
    [kind, status],
    { enabled: can('photo.read') },
  );
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const items = list.status === 'success' ? list.items : null;
  const count = (s: string) => (items ? items.filter((p) => p.status === s).length : null);

  const tabs: { value: KindTab; label: string }[] = [
    { value: 'all', label: t('All profiles') },
    { value: 'watchlist', label: t('Watchlist') },
    ...(staffAllowed ? [{ value: 'staff' as const, label: t('nav|Staff') }] : []),
  ];

  return (
    <>
      <PageHeader screenId="web-34" />
      <div className="stats gd-stats">
        <StatCard label={t('Approved')} value={count('approved')} caption={t('In the photos shown')} />
        <StatCard label={t('Rejected')} value={count('rejected')} caption={t('In the photos shown')} />
        <StatCard label={t('photo|Pending review')} value={count('pending')} caption={t('In the photos shown')} />
        <StatCard label={t('Photos')} value={items ? items.length : null} caption={t('Within your stores')} />
      </div>
      {!staffAllowed ? <Notice tone="info">{t('Staff reference photos are visible only to staff managers.')}</Notice> : null}
      <div className="toolbar">
        <FilterTabs<KindTab> label={t('Profile type')} items={tabs} value={kind} onChange={(v) => set('kind', v)} />
        <label className="filter">
          <span className="filter-label">{t('Status')}</span>
          <Select value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('All statuses')}</option>
            <option value="pending">{t('photo|Pending review')}</option>
            <option value="approved">{t('photo|Approved')}</option>
            <option value="rejected">{t('photo|Rejected')}</option>
          </Select>
        </label>
        {kind !== 'all' || status ? (
          <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            {t('Clear filters')}
          </Button>
        ) : null}
      </div>
      <RouteStateBoundary
        query={pagedAsQuery(list)}
        permission="photo.read"
        isEmpty={(xs) => xs.length === 0}
        empty={
          kind !== 'all' || status ? (
            <EmptyState compact icon="search" title={t('No photos match these filters')} />
          ) : (
            <EmptyState icon="upload" title={t('No reference photos yet')} description={t('Photos are added while enrolling a watchlist subject or a staff member.')} />
          )
        }
      >
        {(photos) => (
          <ul className="gd-card-grid" aria-label={t('Photo library')}>
            {photos.map((p) => (
              <PhotoCard key={p.id} photo={p} tz={tz} fmtDate={(iso) => fmt.dateTime(iso, tz, { seconds: false, withZone: true })} />
            ))}
          </ul>
        )}
      </RouteStateBoundary>
    </>
  );
}

function PhotoCard({ photo: p, fmtDate }: { photo: PhotoD; tz: string; fmtDate: (iso: string) => string }) {
  const { t } = useI18n();
  const ref = p.profile_reference ?? '—';
  const detail = p.profile_kind === 'staff' ? 'web-33' : 'web-29';
  return (
    <li className="card gd-person">
      <div className="gd-person-photo">
        <AuthenticatedImage mediaId={p.thumb_media_id} alt={t('Reference photo for {ref}', { ref })} />
      </div>
      <div className="gd-person-head">
        <strong className="mono-ish">{ref}</strong>
        <PhotoStatusPill status={p.status} />
      </div>
      <dl className="gd-person-fields">
        <div>
          <dt>{t('Profile type')}</dt>
          <dd>{p.profile_kind === 'staff' ? t('nav|Staff') : t('Watchlist')}</dd>
        </div>
        <div>
          <dt>{t('Upload date')}</dt>
          <dd>{fmtDate(p.created_at)}</dd>
        </div>
        <div>
          <dt>{t('Source')}</dt>
          <dd className="gd-clamp">{p.provenance}</dd>
        </div>
      </dl>
      <div className="gd-person-quality">
        <span className="muted small">{t('Quality')}</span>
        <PhotoQuality photo={p} compact />
      </div>
      {p.review_reason ? (
        <p className="small">
          <span className="muted">{t('Review reason')}:</span> {p.review_reason}
        </p>
      ) : null}
      <ButtonLink to={screenPath(detail, { id: p.profile_id })} variant="secondary" size="sm" aria-label={t('Open profile {ref}', { ref })}>
        {t('Open profile')}
      </ButtonLink>
    </li>
  );
}
