// Shared directory for enrolled profiles (web-27 watchlist, web-31 staff): scoped list from
// GET /v1/profiles?kind=..., filters kept in the URL, photo cards that only load reference
// photos when the viewer may see them (watchlist: photo.read, staff: staff.manage).
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { usePagedQuery } from '../../api/hooks';
import type { ProfileKind, ProfileStatus } from '../../api/types';
import { useI18n } from '../../i18n';
import { screenPath } from '../../routes.meta';
import type { ScreenId } from '../../screens.generated';
import { useSession } from '../../session/SessionProvider';
import { Select, TextInput } from '../forms';
import { Icon } from '../Icon';
import { AuthenticatedImage } from '../media';
import { PageHeader } from '../PageHeader';
import { Button, ButtonLink, Notice } from '../primitives';
import { RouteStateBoundary } from '../RouteStateBoundary';
import { EmptyState } from '../states';
import { gd, type ProfileRow } from './api';
import { pagedAsQuery, ProfileStatusPill, profileStatusKey, StoreNames } from './ui';

const STATUSES: ProfileStatus[] = ['draft', 'pending_review', 'approved', 'suspended', 'expired'];

export function profileTimeZone(row: { store_ids: string[] }, stores: { id: string; timezone: string }[], fallback: string): string {
  return stores.find((s) => row.store_ids.includes(s.id))?.timezone ?? fallback;
}

export function PeopleDirectory({ kind }: { kind: ProfileKind }) {
  const { t, fmt } = useI18n();
  const { can, stores, me, timeZone } = useSession();
  const [params, setParams] = useSearchParams();
  const status = (STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as ProfileStatus) : '';
  const storeId = stores.some((s) => s.id === params.get('store')) ? params.get('store')! : '';
  const q = params.get('q') ?? '';
  const [draftQ, setDraftQ] = useState(q);

  const screenId: ScreenId = kind === 'watchlist' ? 'web-27' : 'web-31';
  const detailId: ScreenId = kind === 'watchlist' ? 'web-29' : 'web-33';
  const canAdd = kind === 'watchlist' ? can('watchlist.manage') : can('staff.manage');
  const canSeePhotos = kind === 'watchlist' ? can('photo.read') : can('staff.manage');
  const orgTz = me?.org.timezone ?? timeZone;

  const list = usePagedQuery(
    (_cursor, signal) => gd.profiles.list({ kind, status, q, store_id: storeId || undefined }, { signal }),
    [kind, status, q, storeId],
    { enabled: can('profile.read') },
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setParam('q', draftQ.trim());
  };
  const filtersActive = Boolean(status || storeId || q);

  return (
    <>
      <PageHeader
        screenId={screenId}
        action={
          <>
            {kind === 'watchlist' && can('watchlist.approve') ? (
              <ButtonLink to={screenPath('web-30')} variant="secondary">
                {t('Approval queue')}
              </ButtonLink>
            ) : null}
            {canAdd ? (
              <ButtonLink to={screenPath(kind === 'watchlist' ? 'web-28' : 'web-32')} variant="primary" icon="upload">
                {t('Add')}
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <Notice tone="info">
        {kind === 'watchlist'
          ? t('A watchlist match is only a candidate for a person to review. It is never proof of wrongdoing.')
          : t('Staff recognition annotates work context. It never suppresses checkout exceptions or other independently supported alerts.')}
      </Notice>
      <form className="toolbar gd-toolbar" onSubmit={onSearch} role="search">
        <label className="filter gd-filter-grow">
          <span className="filter-label">{kind === 'watchlist' ? t('Reference ID') : t('Employee ID or name')}</span>
          <TextInput value={draftQ} onChange={(e) => setDraftQ(e.target.value)} maxLength={80} />
        </label>
        <Button type="submit" variant="secondary" icon="search">
          {t('Search')}
        </Button>
        <label className="filter">
          <span className="filter-label">{t('Store')}</span>
          <Select value={storeId} onChange={(e) => setParam('store', e.target.value)}>
            <option value="">{t('All stores')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="filter">
          <span className="filter-label">{kind === 'watchlist' ? t('Review status') : t('Status')}</span>
          <Select value={status} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">{t('All statuses')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(profileStatusKey(s))}
              </option>
            ))}
          </Select>
        </label>
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraftQ('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            {t('Clear filters')}
          </Button>
        ) : null}
      </form>
      <RouteStateBoundary
        query={pagedAsQuery(list)}
        permission="profile.read"
        loading={<div className="gd-card-grid" aria-busy="true" role="status"><span className="visually-hidden">{t('Loading…')}</span>{[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton-panel" />)}</div>}
        isEmpty={(items) => items.length === 0}
        empty={
          filtersActive ? (
            <EmptyState compact icon="search" title={t('No profiles match these filters')} />
          ) : (
            <EmptyState
              icon={kind === 'watchlist' ? 'watchlist' : 'staff'}
              title={kind === 'watchlist' ? t('No enrolled subjects') : t('No staff enrolled')}
              description={
                kind === 'watchlist'
                  ? t('Subjects are enrolled only from incidents a person reviewed and confirmed, with an evidence basis, store scope, expiry and a second reviewer’s approval.')
                  : t('Staff enrollment is separate from user accounts. Enroll staff with their employee ID, assigned stores, a recorded photo notice and an expiry.')
              }
              action={
                canAdd ? (
                  <ButtonLink to={screenPath(kind === 'watchlist' ? 'web-28' : 'web-32')}>{kind === 'watchlist' ? t('Enroll a subject') : t('Enroll staff')}</ButtonLink>
                ) : undefined
              }
            />
          )
        }
      >
        {(items) => (
          <>
            <ul className="gd-card-grid" aria-label={kind === 'watchlist' ? t('Enrolled subjects') : t('Enrolled staff')}>
              {items.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  kind={kind}
                  canSeePhotos={canSeePhotos}
                  href={screenPath(detailId, { id: p.id })}
                  tz={profileTimeZone(p, stores, orgTz)}
                  fmt={fmt}
                />
              ))}
            </ul>
            <p className="muted small gd-count" aria-live="polite">
              {t('Showing {n}', { n: items.length })}
            </p>
          </>
        )}
      </RouteStateBoundary>
    </>
  );
}

function ProfileCard({
  profile: p,
  kind,
  canSeePhotos,
  href,
  tz,
  fmt,
}: {
  profile: ProfileRow;
  kind: ProfileKind;
  canSeePhotos: boolean;
  href: string;
  tz: string;
  fmt: ReturnType<typeof useI18n>['fmt'];
}) {
  const { t } = useI18n();
  return (
    <li className="card gd-person">
      <div className="gd-person-photo">
        {!canSeePhotos ? (
          <div className="media-fallback">
            <Icon name="lock" />
            <span>{t('Reference photos are hidden for your role')}</span>
          </div>
        ) : p.thumb_media_id ? (
          <AuthenticatedImage mediaId={p.thumb_media_id} alt={t('Reference photo for {ref}', { ref: p.reference })} />
        ) : (
          <div className="media-fallback">
            <Icon name="staff" />
            <span>{t('No reference photo yet')}</span>
          </div>
        )}
      </div>
      <div className="gd-person-head">
        <strong className="mono-ish">{p.reference}</strong>
        <ProfileStatusPill status={p.status} />
      </div>
      {kind === 'staff' && p.display_name ? <div className="gd-person-name">{p.display_name}</div> : null}
      <dl className="gd-person-fields">
        <div>
          <dt>{kind === 'watchlist' ? t('Store scope') : t('Store')}</dt>
          <dd>
            <StoreNames ids={p.store_ids} />
          </dd>
        </div>
        <div>
          <dt>{kind === 'watchlist' ? t('Reference photos') : t('Photos')}</dt>
          <dd>{t('{approved} approved of {total}', { approved: p.approved_photo_count, total: p.photo_count })}</dd>
        </div>
        {kind === 'staff' ? (
          <div>
            <dt>{t('Enrollment date')}</dt>
            <dd>{fmt.date(p.created_at, tz)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t('Expiry')}</dt>
          <dd>{p.expires_at ? fmt.date(p.expires_at, tz) : '—'}</dd>
        </div>
      </dl>
      <ButtonLink to={href} variant="secondary" size="sm" aria-label={t('Open {ref}', { ref: p.reference })}>
        {t('Open')}
      </ButtonLink>
    </li>
  );
}
