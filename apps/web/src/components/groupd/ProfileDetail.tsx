// Profile detail shared by web-29 (watchlist) and web-33 (staff). GET /v1/profiles/{id} (?id=).
// Lifecycle commands POST /v1/profiles/{id}/{submit|approve|reject|suspend|reinstate|delete}
// with {expected_version, reason}; edits PATCH /v1/profiles/{id}. Material edits of an approved
// profile return it to review (the server resets approval and removes it from the gallery).
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useApiQuery, useMutation } from '../../api/hooks';
import type { ProfileAction, ProfileKind } from '../../api/types';
import { useI18n } from '../../i18n';
import { screenPath } from '../../routes.meta';
import { useSession } from '../../session/SessionProvider';
import { ChannelLabel, OutcomePill } from '../domain';
import { Checkbox, FormField, TextAreaField, TextField, TextInput } from '../forms';
import { Icon } from '../Icon';
import { AuthenticatedImage } from '../media';
import { ConfirmDialog, Modal } from '../Modal';
import { PageHeader } from '../PageHeader';
import { Badge, Button, ButtonLink, Card, KeyValueList, Notice } from '../primitives';
import { RouteStateBoundary } from '../RouteStateBoundary';
import { ConflictBanner, EmptyState, UnavailableNotice } from '../states';
import { gd, type ProfileDetailD } from './api';
import { addDays, isoToZonedDate, todayIn, zonedDateToIso } from './dates';
import { apiErrorText, fieldMessage, isVersionConflict } from './errors';
import { ProfilePhotos } from './ProfilePhotos';
import { GalleryStatePill, ProfileHistory, ProfileStatusPill, StoreMultiSelect, StoreNames } from './ui';

export function ProfileDetailPage({ kind }: { kind: ProfileKind }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  const screenId = kind === 'watchlist' ? 'web-29' : 'web-33';
  const listId = kind === 'watchlist' ? 'web-27' : 'web-31';
  const q = useApiQuery((signal) => gd.profiles.get(id!, { signal }), [id], { enabled: Boolean(id) });
  const [conflict, setConflict] = useState<number | null | undefined>(undefined);

  if (!id) {
    return (
      <>
        <PageHeader screenId={screenId} />
        <EmptyState
          icon={kind === 'watchlist' ? 'watchlist' : 'staff'}
          title={t('No profile selected')}
          description={kind === 'watchlist' ? t('Open a profile from the enrolled watchlist.') : t('Open a profile from the staff directory.')}
          action={<ButtonLink to={screenPath(listId)}>{kind === 'watchlist' ? t('Back to watchlist') : t('Back to staff directory')}</ButtonLink>}
        />
      </>
    );
  }

  const p = q.data;
  return (
    <>
      <PageHeader
        screenId={screenId}
        subtitle={p ? `${p.reference} · ${t('Review evidence. Respond with confidence.')}` : undefined}
        action={
          <ButtonLink to={screenPath(listId)} variant="secondary">
            {kind === 'watchlist' ? t('Back to watchlist') : t('Back to staff directory')}
          </ButtonLink>
        }
      />
      {conflict !== undefined ? (
        <ConflictBanner
          currentVersion={p?.version ?? conflict}
          reloading={q.fetching}
          onReload={() => {
            setConflict(undefined);
            q.reload();
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="profile.read">
        {(profile) =>
          profile.kind !== kind ? (
            <EmptyState
              icon="search"
              title={t('This profile belongs to the other directory')}
              action={
                <ButtonLink to={screenPath(profile.kind === 'watchlist' ? 'web-29' : 'web-33', { id: profile.id })}>{t('Open profile')}</ButtonLink>
              }
            />
          ) : (
            <Ready
              profile={profile}
              reload={q.reload}
              setProfile={(np) => q.setData(np)}
              onConflict={(e) => {
                setConflict(e.currentVersion);
                q.reload();
              }}
            />
          )
        }
      </RouteStateBoundary>
    </>
  );
}

type ActionState = { action: ProfileAction } | null;

function Ready({
  profile: p,
  reload,
  setProfile,
  onConflict,
}: {
  profile: ProfileDetailD;
  reload: () => void;
  setProfile: (p: ProfileDetailD) => void;
  onConflict: (e: ApiError) => void;
}) {
  const { t, fmt, locale } = useI18n();
  const { can, stores, timeZone, me } = useSession();
  const navigate = useNavigate();
  const watch = p.kind === 'watchlist';
  const canManage = watch ? can('watchlist.manage') : can('staff.manage');
  const canApprove = watch ? can('watchlist.approve') : can('staff.manage');
  const canSeePhotos = watch ? can('photo.read') : can('staff.manage');
  const tz = stores.find((s) => p.store_ids.includes(s.id))?.timezone ?? me?.org.timezone ?? timeZone;
  const [action, setAction] = useState<ActionState>(null);
  const [editOpen, setEditOpen] = useState(false);

  const run = useMutation(
    (a: { action: ProfileAction; reason: string }) => endpoints.profiles.action(p.id, a.action, { expected_version: p.version, reason: a.reason }),
    {
      successMessage: (r) => t(ACTION_DONE[r.status === 'deleted' ? 'delete' : (action?.action ?? 'submit')]),
      onSuccess: (r) => {
        if (r.status === 'deleted') navigate(screenPath(watch ? 'web-27' : 'web-31'));
        else reload();
      },
      onError: (e) => {
        if (isVersionConflict(e)) {
          setAction(null);
          onConflict(e);
          return true;
        }
        return e.status === 422 || e.status === 403 || e.status === 409;
      },
    },
  );

  const main = p.photos.find((x) => x.status === 'approved') ?? p.photos[0];
  const approved = p.photos.filter((x) => x.status === 'approved');
  const source = p.linked_incidents.find((i) => i.id === p.source_incident_id);
  const visits = p.linked_incidents.filter((i) => i.id !== p.source_incident_id);
  const deleted = p.status === 'deleted';

  const actions: { action: ProfileAction; show: boolean; variant: 'primary' | 'secondary' | 'danger' }[] = [
    { action: 'submit', show: canManage && p.status === 'draft', variant: 'primary' },
    { action: 'approve', show: !watch && canApprove && p.status === 'pending_review', variant: 'primary' },
    { action: 'reject', show: !watch && canApprove && p.status === 'pending_review', variant: 'secondary' },
    { action: 'suspend', show: canManage && p.status === 'approved', variant: 'secondary' },
    { action: 'reinstate', show: canApprove && (p.status === 'suspended' || p.status === 'expired'), variant: 'secondary' },
    { action: 'delete', show: canManage && !deleted, variant: 'danger' },
  ];
  const visible = actions.filter((a) => a.show);

  return (
    <>
      <div className="grid gd-two">
        <Card>
          <div className="gd-hero">
            {!canSeePhotos ? (
              <div className="media-fallback">
                <Icon name="lock" />
                <span>{t('Reference photos are hidden for your role')}</span>
              </div>
            ) : main ? (
              <AuthenticatedImage mediaId={main.media_id} alt={t('Reference photo for {ref}', { ref: p.reference })} />
            ) : (
              <div className="media-fallback">
                <Icon name="staff" />
                <span>{t('No reference photo yet')}</span>
              </div>
            )}
          </div>
          <div className="gd-person-head">
            <h2 className="gd-ref mono-ish">{p.reference}</h2>
            <ProfileStatusPill status={p.status} />
          </div>
          {!watch && p.display_name ? <p className="gd-person-name">{p.display_name}</p> : null}
          <KeyValueList
            items={[
              ...(watch
                ? [
                    {
                      label: t('Approved photos'),
                      value: canSeePhotos ? t('{approved} approved of {total}', { approved: approved.length, total: p.photos.length }) : t('{approved} approved of {total}', { approved: p.approved_photo_count, total: p.photo_count }),
                    },
                  ]
                : [{ label: t('Reference photos'), value: t('{approved} approved of {total}', { approved: p.approved_photo_count, total: p.photo_count }) }]),
              { label: watch ? t('Store scope') : t('Assigned stores'), value: <StoreNames ids={p.store_ids} /> },
              { label: t('Matching'), value: <GalleryStatePill state={p.gallery_state} /> },
              ...(!watch ? [{ label: t('Role'), value: p.role_context || <span className="muted">{t('Not set')}</span> }] : []),
              ...(!watch
                ? [{ label: t('Photo notice'), value: p.notice_recorded ? <Badge tone="ok">{t('Notice recorded')}</Badge> : <Badge tone="warning">{t('Not recorded')}</Badge> }]
                : []),
              ...(watch
                ? [
                    {
                      label: t('Supporting incident'),
                      value: p.source_incident_id ? (
                        <span>
                          <Link to={screenPath('web-24', { id: p.source_incident_id })}>{source?.ref ?? t('Open incident')}</Link>{' '}
                          {source ? <OutcomePill outcome={source.outcome} /> : null}
                        </span>
                      ) : (
                        '—'
                      ),
                    },
                  ]
                : []),
              { label: !watch ? t('Enrollment date') : t('Created'), value: fmt.date(p.created_at, tz) },
              { label: t('Review date'), value: p.review_at ? fmt.date(p.review_at, tz) : '—' },
              { label: t('Expiry'), value: p.expires_at ? fmt.date(p.expires_at, tz) : '—' },
            ]}
          />
          {watch ? (
            <>
              <h3 className="gd-subhead">{t('Evidence basis')}</h3>
              <p className="gd-prewrap">{p.basis || <span className="muted">{t('Not recorded')}</span>}</p>
              <Notice tone="warning">{t('A watchlist match is only a candidate for a person to review. It is never proof of wrongdoing.')}</Notice>
            </>
          ) : (
            <>
              <h3 className="gd-subhead">{t('Detection policy')}</h3>
              <Notice tone="info">{t('Staff recognition annotates context and never suppresses checkout exceptions.')}</Notice>
            </>
          )}
          {p.review_reason ? (
            <p className="small">
              <span className="muted">{t('Last decision reason')}:</span> {p.review_reason}
            </p>
          ) : null}
          {watch && p.status === 'pending_review' ? (
            <p className="small">
              {canApprove ? <Link to={screenPath('web-30', { id: p.id })}>{t('Open in the approval queue')}</Link> : t('Waiting for a reviewer with approval rights.')}
            </p>
          ) : null}
          {visible.length > 0 || (canManage && !deleted) ? (
            <div className="action-row gd-actions">
              {canManage && !deleted ? (
                <Button variant="secondary" onClick={() => setEditOpen(true)}>
                  {t('Edit')}
                </Button>
              ) : null}
              {visible.map((a) => (
                <Button key={a.action} variant={a.variant} onClick={() => setAction({ action: a.action })}>
                  {t(actionLabel(a.action, watch))}
                </Button>
              ))}
            </div>
          ) : null}
          <p className="muted small">{t('Version {n}', { n: p.version })}</p>
        </Card>
        <div className="gd-stack">
          <Card title={watch ? t('Visit history') : t('Match history')}>
            {!p.match_candidates.available ? (
              <UnavailableNotice code={p.match_candidates.reason ?? 'face_sdk_unavailable'} />
            ) : null}
            {visits.length === 0 ? (
              <p className="muted">
                {watch
                  ? t('No visits are linked. Visits appear only after a reviewer links a watchlist candidate alert to this profile.')
                  : t('No recognitions are linked to this staff profile.')}
              </p>
            ) : (
              <IncidentList items={visits} tz={tz} />
            )}
            <h3 className="gd-subhead">{t('Linked incidents')}</h3>
            {p.linked_incidents.length === 0 ? <p className="muted">{t('No incidents in your stores are linked.')}</p> : <IncidentList items={p.linked_incidents} tz={tz} sourceId={p.source_incident_id} />}
            {watch ? (
              <>
                <h3 className="gd-subhead">{t('Match candidates')}</h3>
                {p.match_candidates.available ? (
                  <p className="muted">{t('Match candidates appear in the alert inbox for review. Similarity is a ranking for review, not proof of identity.')}</p>
                ) : (
                  <p className="muted small">{t('Face matching is not running, so no match candidates are produced for this profile.')}</p>
                )}
              </>
            ) : null}
          </Card>
          <Card title={watch ? t('Approved photos') : t('Reference photos')}>
            {canSeePhotos ? (
              <ProfilePhotos
                profile={p}
                timeZone={tz}
                canUpload={canManage}
                canDelete={canManage}
                canReview={canApprove && p.status !== 'deleted'}
                onChanged={reload}
              />
            ) : (
              <p className="muted">{watch ? t('Your role cannot view reference photos.') : t('Staff reference photos are visible only to staff managers.')}</p>
            )}
          </Card>
          <Card title={t('History')}>
            <ProfileHistory history={p.history} timeZone={tz} />
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={action !== null}
        onClose={() => {
          setAction(null);
          run.reset();
        }}
        title={action ? t(actionLabel(action.action, watch)) : ''}
        description={action ? t(ACTION_HELP[action.action]) : undefined}
        confirmLabel={action ? t(actionLabel(action.action, watch)) : ''}
        confirmVariant={action?.action === 'delete' || action?.action === 'suspend' || action?.action === 'reject' ? 'danger' : 'primary'}
        pending={run.pending}
        error={run.error && !isVersionConflict(run.error) ? apiErrorText(run.error, locale) : null}
        onConfirm={async (reason) => (action ? (await run.run({ action: action.action, reason })).ok : false)}
      />
      {editOpen ? <EditProfile profile={p} tz={tz} onClose={() => setEditOpen(false)} onSaved={setProfile} onConflict={onConflict} /> : null}
    </>
  );
}

function actionLabel(a: ProfileAction, watch: boolean): string {
  if (a === 'suspend') return watch ? 'Suspend profile' : 'Deactivate';
  return {
    submit: 'Request review',
    approve: 'Approve enrollment',
    reject: 'Reject enrollment',
    reinstate: 'Reinstate for review',
    delete: 'Delete profile',
    suspend: 'Suspend profile',
  }[a];
}

const ACTION_HELP: Record<ProfileAction, string> = {
  submit: 'The draft is locked for review. Material changes later return it to review.',
  approve: 'Approval puts the profile into use within its store scope until it expires.',
  reject: 'The profile returns to draft with your reason.',
  suspend: 'The profile immediately stops being used for matching or recognition. You can reinstate it for a new review later.',
  reinstate: 'The profile returns to the review queue. It is not used until it is approved again.',
  delete: 'The profile, its photos and any face templates are deleted. Linked incident records remain. This cannot be undone.',
};

const ACTION_DONE: Record<ProfileAction, string> = {
  submit: 'Submitted for review',
  approve: 'Enrollment approved',
  reject: 'Enrollment rejected',
  suspend: 'Profile suspended',
  reinstate: 'Profile returned to review',
  delete: 'Profile deleted',
};

function IncidentList({ items, tz, sourceId }: { items: ProfileDetailD['linked_incidents']; tz: string; sourceId?: string | null }) {
  const { t, fmt } = useI18n();
  return (
    <ul className="rows">
      {items.map((i) => (
        <li className="row" key={i.id}>
          <div className="row-main">
            <Link className="row-title" to={screenPath('web-24', { id: i.id })}>
              {i.ref}
            </Link>{' '}
            {i.id === sourceId ? <Badge tone="info">{t('Source incident')}</Badge> : null}
            <div className="muted small">
              <ChannelLabel channel={i.channel} /> · {fmt.dateTime(i.captured_at, tz, { withZone: true })}
            </div>
          </div>
          <OutcomePill outcome={i.outcome} />
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ edit

function EditProfile({
  profile: p,
  tz,
  onClose,
  onSaved,
  onConflict,
}: {
  profile: ProfileDetailD;
  tz: string;
  onClose: () => void;
  onSaved: (p: ProfileDetailD) => void;
  onConflict: (e: ApiError) => void;
}) {
  const { t, locale } = useI18n();
  const watch = p.kind === 'watchlist';
  const privacy = useApiQuery((signal) => endpoints.org.getSettings('privacy', { signal }), []);
  const maxDays = privacy.data?.settings.profile_max_expiry_days ?? null;
  const today = todayIn(tz);
  const maxDate = maxDays ? addDays(today, maxDays) : undefined;
  const initial = {
    display_name: p.display_name ?? '',
    basis: p.basis ?? '',
    role_context: p.role_context ?? '',
    notice_recorded: Boolean(p.notice_recorded),
    store_ids: p.store_ids,
    review: isoToZonedDate(p.review_at, tz),
    expiry: isoToZonedDate(p.expires_at, tz),
  };
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const sameStores = [...f.store_ids].sort().join(',') === [...initial.store_ids].sort().join(',');
  const material = (watch && f.basis.trim() !== initial.basis) || !sameStores || f.expiry !== initial.expiry;

  const save = useMutation((body: Record<string, unknown> & { expected_version: number }) => gd.profiles.update(p.id, body), {
    successMessage: t('Profile updated'),
    onSuccess: (np) => {
      onSaved(np);
      onClose();
    },
    onError: (e) => {
      if (isVersionConflict(e)) {
        onClose();
        onConflict(e);
        return true;
      }
      if (e.status === 422 && Object.keys(e.fieldErrors).length) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, c]) => [k, fieldMessage(c, locale) ?? c])));
        return true;
      }
      return false;
    },
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (f.store_ids.length === 0) e.store_ids = t('Choose at least one store.');
    if (!f.expiry) e.expires_at = t('This field is required.');
    else if (f.expiry !== initial.expiry && f.expiry <= today) e.expires_at = t('Choose a future date.');
    else if (maxDate && f.expiry !== initial.expiry && f.expiry > maxDate)
      e.expires_at = t('Choose a date within {n} days of today (organization privacy policy).', { n: maxDays! });
    if (f.review && f.review !== initial.review && (f.review <= today || f.review > f.expiry))
      e.review_at = t('The review date must be after today and on or before the expiry date.');
    if (watch && f.basis.trim().length < 10) e.basis = t('Describe the evidence basis in at least 10 characters.');
    if (!watch && !f.display_name.trim()) e.display_name = t('This field is required.');
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: Record<string, unknown> & { expected_version: number } = { expected_version: p.version };
    if (watch && f.basis.trim() !== initial.basis) body.basis = f.basis.trim();
    if (!watch && f.display_name.trim() !== initial.display_name) body.display_name = f.display_name.trim();
    if (!watch && f.role_context.trim() !== initial.role_context) body.role_context = f.role_context.trim() || null;
    if (!watch && f.notice_recorded !== initial.notice_recorded) body.notice_recorded = f.notice_recorded;
    if (!sameStores) body.store_ids = f.store_ids;
    if (f.expiry !== initial.expiry) body.expires_at = zonedDateToIso(f.expiry, tz, 'end');
    if (f.review !== initial.review) body.review_at = f.review ? zonedDateToIso(f.review, tz, 'start') : null;
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    void save.run(body);
  };

  return (
    <Modal open onClose={onClose} title={t('Edit profile')} size="lg" dismissible={!save.pending}>
      <form onSubmit={submit} noValidate>
        {p.status === 'approved' ? (
          <Notice tone="warning" title={t('Material changes reset approval')}>
            {watch
              ? t('Changing the evidence basis, store scope or expiry returns this approved profile to review. It stops being used until it is approved again.')
              : t('Changing the store assignment or expiry returns this approved profile to review. It stops being used until it is approved again.')}
          </Notice>
        ) : null}
        {material && p.status === 'approved' ? (
          <p className="small gd-warn" role="status">
            {t('Saving these changes will reset approval.')}
          </p>
        ) : null}
        {watch ? (
          <TextAreaField label={t('Evidence basis')} required maxLength={4000} value={f.basis} onChange={(e) => set('basis', e.target.value)} error={errors.basis} />
        ) : (
          <div className="form-grid">
            <TextField label={t('Display name')} required maxLength={120} value={f.display_name} onChange={(e) => set('display_name', e.target.value)} error={errors.display_name} />
            <TextField label={t('Role')} maxLength={200} value={f.role_context} onChange={(e) => set('role_context', e.target.value)} error={errors.role_context} />
          </div>
        )}
        <StoreMultiSelect
          label={watch ? t('Store scope') : t('Store assignment')}
          required
          value={f.store_ids}
          onChange={(v) => set('store_ids', v)}
          error={errors.store_ids}
          hint={t('Only stores assigned to you are listed.')}
        />
        <div className="form-grid">
          <FormField label={t('Review date')} error={errors.review_at}>
            {(cp) => <TextInput {...cp} type="date" value={f.review} max={f.expiry || maxDate} onChange={(e) => set('review', e.target.value)} />}
          </FormField>
          <FormField label={t('Expiry')} required error={errors.expires_at} hint={maxDays ? t('Maximum {n} days (organization privacy policy).', { n: maxDays }) : undefined}>
            {(cp) => <TextInput {...cp} type="date" value={f.expiry} max={maxDate} onChange={(e) => set('expiry', e.target.value)} />}
          </FormField>
        </div>
        {!watch ? (
          <Checkbox label={t('Photo notice recorded')} checked={f.notice_recorded} onChange={(e) => set('notice_recorded', e.target.checked)} />
        ) : null}
        {save.error && !(save.error.status === 422 && Object.keys(save.error.fieldErrors).length) && !isVersionConflict(save.error) ? (
          <div className="field-error" role="alert">
            {apiErrorText(save.error, locale)}
          </div>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={save.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={save.pending}>
            {t('Save changes')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
