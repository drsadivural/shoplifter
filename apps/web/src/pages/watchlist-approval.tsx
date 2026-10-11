// web-30 Enrollment approval. Queue: GET /v1/profiles?kind=watchlist&status=pending_review.
// Review panel (?id=): evidence basis, source incident outcome, per-photo approve/reject with a
// reason, scope, expiry. Approve / Reject -> POST /v1/profiles/{id}/{approve|reject}
// {expected_version, reason}. The creator can never approve (403 separation_of_duties).
import '../styles/group-d.css';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation, usePagedQuery } from '../api/hooks';
import { gd, type ProfileDetailD } from '../components/groupd/api';
import { apiErrorText, isVersionConflict } from '../components/groupd/errors';
import { ProfilePhotos } from '../components/groupd/ProfilePhotos';
import { pagedAsQuery, ProfileStatusPill, StoreNames } from '../components/groupd/ui';
import { OutcomePill } from '../components/domain';
import { ConfirmDialog } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState, LoadingState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

export default function WatchlistApprovalPage() {
  const { t, fmt } = useI18n();
  const { can, me, stores, timeZone } = useSession();
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const queue = usePagedQuery(
    (_c, signal) => gd.profiles.list({ kind: 'watchlist', status: 'pending_review' }, { signal }),
    [],
    { enabled: can('watchlist.approve') },
  );
  const detail = useApiQuery((signal) => gd.profiles.get(id!, { signal }), [id], { enabled: Boolean(id) && can('watchlist.approve') });
  const [conflict, setConflict] = useState<number | null | undefined>(undefined);
  const orgTz = me?.org.timezone ?? timeZone;
  const tzFor = (ids: string[]) => stores.find((s) => ids.includes(s.id))?.timezone ?? orgTz;

  return (
    <>
      <PageHeader
        screenId="web-30"
        action={
          <ButtonLink to={screenPath('web-27')} variant="secondary">
            {t('Back to watchlist')}
          </ButtonLink>
        }
      />
      <div className="gd-approval">
        <Card title={t('Awaiting approval')} className="gd-queue">
          <RouteStateBoundary
            query={pagedAsQuery(queue)}
            permission="watchlist.approve"
            loading={<LoadingState variant="table" rows={3} />}
            isEmpty={(items) => items.length === 0}
            empty={<EmptyState compact title={t('No enrollments are waiting for approval')} description={t('Enrollments appear here after someone requests review.')} />}
          >
            {(items) => (
              <ul className="rows" aria-label={t('Awaiting approval')}>
                {items.map((p) => (
                  <li key={p.id} className={`row gd-queue-row ${p.id === id ? 'active' : ''}`}>
                    <div className="row-main">
                      <Link
                        className="row-title"
                        to={screenPath('web-30', { id: p.id })}
                        aria-current={p.id === id ? 'true' : undefined}
                        onClick={() => setConflict(undefined)}
                      >
                        {p.reference}
                      </Link>
                      {p.created_by === me?.user.id ? (
                        <>
                          {' '}
                          <Badge tone="neutral">{t('Created by you')}</Badge>
                        </>
                      ) : null}
                      <div className="muted small">
                        <StoreNames ids={p.store_ids} /> · {fmt.date(p.created_at, tzFor(p.store_ids))}
                      </div>
                      <div className="muted small">{t('{approved} approved of {total}', { approved: p.approved_photo_count, total: p.photo_count })}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </RouteStateBoundary>
        </Card>
        <div className="gd-review">
          {conflict !== undefined ? (
            <ConflictBanner
              currentVersion={detail.data?.version ?? conflict}
              reloading={detail.fetching}
              onReload={() => {
                setConflict(undefined);
                detail.reload();
              }}
            />
          ) : null}
          {!id ? (
            <Card>
              <EmptyState compact icon="watchlist" title={t('Select an enrollment to review')} description={t('Check the evidence basis, the source incident outcome, each photo, the scope and the expiry before deciding.')} />
            </Card>
          ) : (
            <RouteStateBoundary query={detail} permission="watchlist.approve">
              {(p) =>
                p.kind !== 'watchlist' ? (
                  <EmptyState icon="search" title={t('Record not found')} />
                ) : (
                  <ReviewPanel
                    profile={p}
                    tz={tzFor(p.store_ids)}
                    reload={() => {
                      detail.reload();
                      queue.reload();
                    }}
                    onDecided={() => {
                      queue.reload();
                      detail.reload();
                    }}
                    onConflict={(v) => {
                      setConflict(v);
                      detail.reload();
                    }}
                    clear={() => setParams({}, { replace: true })}
                  />
                )
              }
            </RouteStateBoundary>
          )}
        </div>
      </div>
    </>
  );
}

function ReviewPanel({
  profile: p,
  tz,
  reload,
  onDecided,
  onConflict,
  clear,
}: {
  profile: ProfileDetailD;
  tz: string;
  reload: () => void;
  onDecided: () => void;
  onConflict: (v: number | null) => void;
  clear: () => void;
}) {
  const { t, fmt, locale } = useI18n();
  const { me, can } = useSession();
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const source = p.linked_incidents.find((i) => i.id === p.source_incident_id);
  const incident = useApiQuery((signal) => endpoints.incidents.get(p.source_incident_id!, { signal }), [p.source_incident_id], {
    enabled: Boolean(p.source_incident_id) && can('incident.read'),
  });
  const outcome = incident.data?.outcome ?? source?.outcome ?? null;
  const own = p.created_by === me?.user.id;
  const approvedPhotos = p.photos.filter((x) => x.status === 'approved').length;
  const expired = p.expires_at ? new Date(p.expires_at).getTime() <= Date.now() : true;
  const pending = p.status === 'pending_review';

  const decide = useMutation(
    (a: { action: 'approve' | 'reject'; reason: string }) => endpoints.profiles.action(p.id, a.action, { expected_version: p.version, reason: a.reason }),
    {
      successMessage: (r) => (r.status === 'approved' ? t('Enrollment approved') : t('Enrollment rejected')),
      onSuccess: onDecided,
      onError: (e) => {
        if (isVersionConflict(e)) {
          setDecision(null);
          onConflict(e.currentVersion);
          return true;
        }
        return e.status === 403 || e.status === 422 || e.status === 409;
      },
    },
  );

  const checks: { ok: boolean; label: string }[] = [
    { ok: outcome === 'confirmed', label: t('Source incident confirmed by a person') },
    { ok: approvedPhotos > 0, label: t('At least one approved photo') },
    { ok: !expired, label: t('Expiry is in the future') },
    { ok: !own, label: t('Reviewer is not the person who created the enrollment') },
  ];

  return (
    <>
      <div className="grid gd-two">
        <Card title={t('Evidence basis')} titleAddon={<Badge tone="warning">{t('Review required')}</Badge>}>
          <div className="gd-person-head">
            <h2 className="gd-ref mono-ish">{p.reference}</h2>
            <ProfileStatusPill status={p.status} />
          </div>
          <p className="gd-prewrap">{p.basis || <span className="muted">{t('Not recorded')}</span>}</p>
          <h3 className="gd-subhead">{t('Supporting incident')}</h3>
          {p.source_incident_id ? (
            <div>
              <Link to={screenPath('web-24', { id: p.source_incident_id })}>{incident.data?.ref ?? source?.ref ?? t('Open incident')}</Link>{' '}
              <OutcomePill outcome={outcome} />
              {incident.data ? (
                <div className="muted small">
                  {incident.data.store_name} · {fmt.dateTime(incident.data.captured_at, incident.data.store_timezone ?? tz, { withZone: true })}
                </div>
              ) : null}
              {incident.data?.description ? <p className="small gd-prewrap">{incident.data.description}</p> : null}
              {incident.data?.observed_behavior ? (
                <p className="small">
                  <span className="muted">{t('Observed behavior')}:</span> {incident.data.observed_behavior}
                </p>
              ) : null}
              {outcome !== 'confirmed' ? (
                <Notice tone="critical">{t('The source incident is not recorded as a confirmed incident. Approval will be refused until a person confirms it.')}</Notice>
              ) : null}
            </div>
          ) : (
            <Notice tone="critical">{t('No supporting incident is recorded. Approval will be refused.')}</Notice>
          )}
          <h3 className="gd-subhead">{t('Scope')}</h3>
          <KeyValueList
            items={[
              { label: t('Store scope'), value: <StoreNames ids={p.store_ids} /> },
              { label: t('Review date'), value: p.review_at ? fmt.date(p.review_at, tz) : '—' },
              { label: t('Expiry'), value: p.expires_at ? fmt.date(p.expires_at, tz) : '—' },
              { label: t('Created'), value: fmt.dateTime(p.created_at, tz, { withZone: true }) },
            ]}
          />
          {p.review_reason ? (
            <p className="small">
              <span className="muted">{t('Note for the reviewer')}:</span> {p.review_reason}
            </p>
          ) : null}
        </Card>
        <div className="gd-stack">
          <Card title={t('Photo quality')}>
            <ProfilePhotos profile={p} timeZone={tz} canUpload={false} canDelete={false} canReview={pending} onChanged={reload} />
          </Card>
          <Card title={t('Approve enrollment')}>
            <ul className="gd-checklist" aria-label={t('Approval requirements')}>
              {checks.map((c) => (
                <li key={c.label} className={c.ok ? 'ok' : 'missing'}>
                  <span aria-hidden="true">{c.ok ? '✓' : '✕'}</span> {c.label}
                  <span className="visually-hidden"> — {c.ok ? t('met') : t('not met')}</span>
                </li>
              ))}
            </ul>
            {!pending ? (
              <p className="muted">{t('This enrollment is no longer waiting for approval.')}</p>
            ) : (
              <>
                {own ? (
                  <Notice tone="warning" title={t('Separation of duties')}>
                    {t('You created this enrollment, so a different reviewer must approve it. You can still review photos or reject it with a reason.')}
                  </Notice>
                ) : null}
                <div className="action-row">
                  {!own ? <Button onClick={() => setDecision('approve')}>{t('Approve enrollment')}</Button> : null}
                  <Button variant="secondary" onClick={() => setDecision('reject')}>
                    {t('Reject enrollment')}
                  </Button>
                </div>
              </>
            )}
            <p className="muted small">
              {t('Version {n}', { n: p.version })} · <Link to={screenPath('web-29', { id: p.id })}>{t('Open profile')}</Link> ·{' '}
              <button type="button" className="link-btn" onClick={clear}>
                {t('Close review')}
              </button>
            </p>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={decision !== null}
        onClose={() => {
          setDecision(null);
          decide.reset();
        }}
        title={decision === 'approve' ? t('Approve enrollment') : t('Reject enrollment')}
        description={
          decision === 'approve'
            ? t('Approval puts the profile into use within its store scope until it expires. Without the licensed face SDK it is approved as a record only and no matching runs.')
            : t('The profile returns to draft with your reason.')
        }
        confirmLabel={decision === 'approve' ? t('Approve enrollment') : t('Reject enrollment')}
        confirmVariant={decision === 'reject' ? 'danger' : 'primary'}
        pending={decide.pending}
        error={decide.error && !isVersionConflict(decide.error) ? apiErrorText(decide.error, locale) : null}
        onConfirm={async (reason) => (decision ? (await decide.run({ action: decision, reason })).ok : false)}
      />
    </>
  );
}
