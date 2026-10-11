// Enrollment flow shared by web-28 (watchlist subject) and web-32 (staff):
//   1 Profile  -> POST /v1/profiles (kind, reference, scope, expiry ...) creates a DRAFT
//   2 Photos   -> POST /v1/profiles/{id}/photos (multipart file + provenance), measured quality
//   3 Review   -> POST /v1/profiles/{id}/submit {expected_version, reason}
// The draft id is kept in the URL (?id=) so a refresh resumes the flow. Nothing is matched or
// approved here: a reviewer approves separately (watchlist: a different person).
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useApiQuery, useMutation } from '../../api/hooks';
import type { ProfileKind } from '../../api/types';
import { useI18n } from '../../i18n';
import { screenPath } from '../../routes.meta';
import { useSession } from '../../session/SessionProvider';
import { Checkbox, FormField, TextField, TextInput } from '../forms';
import { ConfirmDialog } from '../Modal';
import { PageHeader } from '../PageHeader';
import { Button, ButtonLink, Card, KeyValueList, Notice } from '../primitives';
import { RouteStateBoundary } from '../RouteStateBoundary';
import { ConflictBanner, EmptyState } from '../states';
import { gd, type ProfileDetailD } from './api';
import { addDays, nowIn, todayIn, zonedDateTimeToIso, zonedDateToIso } from './dates';
import { apiErrorText, fieldMessage, isVersionConflict } from './errors';
import { ProfilePhotos } from './ProfilePhotos';
import { ProfileStatusPill, StoreMultiSelect, StoreNames } from './ui';

/** Suggested store notice (docs/SECURITY.md) for customer/legal review before operational use. */
export const JA_STORE_NOTICE =
  '当店では、防犯および事案の確認のため、防犯カメラ映像と顔識別機能を利用しています。登録情報は定められた目的・対象範囲・保存期間に従って管理します。お問い合わせは店舗管理責任者までお申し出ください。';

export function StoreNoticeText() {
  const { t } = useI18n();
  return (
    <figure className="gd-notice-text">
      <figcaption className="small muted">{t('Suggested Japanese store notice (review with counsel before use)')}</figcaption>
      <blockquote lang="ja">{JA_STORE_NOTICE}</blockquote>
    </figure>
  );
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useI18n();
  const items = [t('Profile'), t('Photos'), t('Request review')];
  return (
    <ol className="gd-steps" aria-label={t('Enrollment steps')}>
      {items.map((label, i) => (
        <li key={label} className={i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''} aria-current={i + 1 === step ? 'step' : undefined}>
          <span className="gd-step-num">{i + 1}</span> {label}
        </li>
      ))}
    </ol>
  );
}

export function EnrollWizard({ kind }: { kind: ProfileKind }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const screenId = kind === 'watchlist' ? 'web-28' : 'web-32';
  const q = useApiQuery((signal) => gd.profiles.get(id!, { signal }), [id], { enabled: Boolean(id) });

  return (
    <>
      <PageHeader
        screenId={screenId}
        action={
          <ButtonLink to={screenPath(kind === 'watchlist' ? 'web-27' : 'web-31')} variant="secondary">
            {kind === 'watchlist' ? t('Back to watchlist') : t('Back to staff directory')}
          </ButtonLink>
        }
      />
      {!id ? (
        <ProfileStep kind={kind} onCreated={(newId) => setParams({ id: newId }, { replace: true })} />
      ) : (
        <RouteStateBoundary query={q} permission={kind === 'watchlist' ? 'watchlist.manage' : 'staff.manage'}>
          {(profile) =>
            profile.kind !== kind ? (
              <EmptyState icon="search" title={t('Record not found')} description={t('It may have been deleted, or it is outside the stores you can access.')} />
            ) : (
              <DraftStep profile={profile} reload={q.reload} fetching={q.fetching} />
            )
          }
        </RouteStateBoundary>
      )}
    </>
  );
}

// ------------------------------------------------------------------ step 1

function ProfileStep({ kind, onCreated }: { kind: ProfileKind; onCreated: (id: string) => void }) {
  const { t, locale } = useI18n();
  const { stores, store, timeZone } = useSession();
  const privacy = useApiQuery((signal) => endpoints.org.getSettings('privacy', { signal }), []);
  const maxDays = privacy.data?.settings.profile_max_expiry_days ?? null;

  const [reference, setReference] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [lastSeen, setLastSeen] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>(store ? [store.id] : []);
  const [roleContext, setRoleContext] = useState('');
  const [notice, setNotice] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const tz = stores.find((s) => storeIds.includes(s.id))?.timezone ?? timeZone;
  const today = todayIn(tz);
  const maxDate = maxDays ? addDays(today, maxDays) : undefined;

  const create = useMutation(
    (body: Record<string, unknown> & { kind: ProfileKind }) => endpoints.profiles.create(body),
    {
      successMessage: t('Draft saved. Add reference photos next.'),
      onSuccess: (p) => onCreated(p.id),
      onError: (e) => {
        if (e.status === 422 && Object.keys(e.fieldErrors).length > 0) {
          setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, code]) => [k, fieldMessage(code, locale) ?? code])));
          return true;
        }
        return false;
      },
    },
  );

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const req = t('This field is required.');
    if (!reference.trim()) e.reference = req;
    if (storeIds.length === 0) e.store_ids = t('Choose at least one store.');
    if (!expiry) e.expires_at = req;
    else if (expiry <= today) e.expires_at = t('Choose a future date.');
    else if (maxDate && expiry > maxDate) e.expires_at = t('Choose a date within {n} days of today (organization privacy policy).', { n: maxDays! });
    if (kind === 'watchlist') {
      if (lastSeen && lastSeen > nowIn(tz)) e.last_seen_at = t('The last-seen time cannot be in the future.');
    } else {
      if (!displayName.trim()) e.display_name = req;
      if (!notice) e.notice_recorded = t('Record that the staff member received the photo notice.');
    }
    return e;
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const body: Record<string, unknown> & { kind: ProfileKind } = {
      kind,
      reference: reference.trim(),
      store_ids: storeIds,
      expires_at: zonedDateToIso(expiry, tz, 'end'),
    };
    if (kind === 'watchlist') {
      body.display_name = displayName.trim();
      body.last_seen_at = lastSeen ? zonedDateTimeToIso(lastSeen, tz) : null;
    } else {
      body.display_name = displayName.trim();
      body.role_context = roleContext.trim() || null;
      body.notice_recorded = notice;
    }
    void create.run(body);
  };

  const err = (k: string) => errors[k] ?? null;

  return (
    <>
      <Steps step={1} />
      <div className="grid gd-two">
        <Card title={t('Profile')}>
          <form onSubmit={submit} noValidate className="gd-form">
            <div className="form-grid">
              <TextField
                label={kind === 'watchlist' ? t('Reference ID') : t('Employee ID')}
                hint={kind === 'watchlist' ? t('Internal reference number for this record.') : t('The employee number used by your organization.')}
                required
                maxLength={80}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                error={err('reference')}
              />
              {kind === 'staff' ? (
                <TextField
                  label={t('Display name')}
                  hint={t('Preferred name shown to reviewers.')}
                  required
                  maxLength={120}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  error={err('display_name')}
                />
              ) : (
                <TextField
                  label={t('watchlist|Name')}
                  hint={t('Leave blank if the name is not known.')}
                  maxLength={120}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  error={err('display_name')}
                />
              )}
            </div>
            {kind === 'watchlist' ? (
              <FormField label={t('watchlist|Last seen')} hint={t('Date and time the person was last seen. Times use {tz}.', { tz })} error={err('last_seen_at')}>
                {(p) => <TextInput {...p} type="datetime-local" max={nowIn(tz)} value={lastSeen} onChange={(e) => setLastSeen(e.target.value)} />}
              </FormField>
            ) : null}
            <StoreMultiSelect
              label={kind === 'watchlist' ? t('Store scope') : t('Store assignment')}
              hint={kind === 'watchlist' ? t('Matching runs only in these stores. Choose the smallest scope that serves the purpose.') : t('Stores where this staff member works.')}
              required
              value={storeIds}
              onChange={setStoreIds}
              error={err('store_ids')}
            />
            {kind === 'staff' ? (
              <>
                <TextField
                  label={t('Role')}
                  hint={t('Work context shown with recognitions, e.g. restocking or cashier. It is not an app permission.')}
                  maxLength={200}
                  value={roleContext}
                  onChange={(e) => setRoleContext(e.target.value)}
                  error={err('role_context')}
                />
                <div className={`field ${err('notice_recorded') ? 'field-invalid' : ''}`}>
                  <div className="gd-label">{t('Photo notice')}</div>
                  <StoreNoticeText />
                  <Checkbox
                    label={
                      <>
                        {t('The staff member received the photo notice and its purpose was explained')}
                        <span className="required-marker" aria-hidden="true">
                          {' '}
                          *
                        </span>
                      </>
                    }
                    hint={t('Required. Recorded with your name in the audit log.')}
                    checked={notice}
                    onChange={(e) => setNotice(e.target.checked)}
                    aria-invalid={err('notice_recorded') ? true : undefined}
                  />
                  {err('notice_recorded') ? (
                    <div className="field-error">
                      <span aria-hidden="true">▲ </span>
                      {err('notice_recorded')}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
            <div className="form-grid">
              <FormField
                label={t('Expiry')}
                required
                hint={
                  maxDays
                    ? t('The profile stops being used after this date. Maximum {n} days (organization privacy policy). Dates use {tz}.', { n: maxDays, tz })
                    : privacy.error
                      ? t('The organization maximum could not be loaded; the server still enforces it. Dates use {tz}.', { tz })
                      : t('Dates use {tz}.', { tz })
                }
                error={err('expires_at')}
              >
                {(p) => <TextInput {...p} type="date" min={addDays(today, 1)} max={maxDate} value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
              </FormField>
            </div>
            {create.error && !(create.error.status === 422 && Object.keys(create.error.fieldErrors).length) ? (
              <div className="field-error" role="alert">
                {apiErrorText(create.error, locale)}
              </div>
            ) : null}
            <div className="action-row">
              <Button type="submit" pending={create.pending}>
                {t('Save draft')}
              </Button>
              <ButtonLink to={screenPath(kind === 'watchlist' ? 'web-27' : 'web-31')} variant="secondary">
                {t('Cancel')}
              </ButtonLink>
            </div>
          </form>
        </Card>
        <Card title={t('Reference photos')}>
          <p>{t('Photos are added after the draft is saved. A draft is never used for matching.')}</p>
          <Notice tone="info">
            {kind === 'watchlist'
              ? t('After you request review, a different person with approval rights checks the name, each photo, the scope and the expiry. A watchlist match is only ever a candidate for review.')
              : t('After you request review, a staff manager approves the photos and the profile. Staff recognition annotates work context and never suppresses checkout exceptions.')}
          </Notice>
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ steps 2 + 3

function DraftStep({
  profile,
  reload,
  fetching,
}: {
  profile: ProfileDetailD;
  reload: () => void;
  fetching: boolean;
}) {
  const { t, fmt, locale } = useI18n();
  const { stores, timeZone } = useSession();
  const navigate = useNavigate();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const tz = stores.find((s) => profile.store_ids.includes(s.id))?.timezone ?? timeZone;
  const detail = screenPath(profile.kind === 'watchlist' ? 'web-29' : 'web-33', { id: profile.id });
  const usable = profile.photos.filter((p) => p.status === 'pending' || p.status === 'approved').length;

  const submitReview = useMutation(
    (reason: string) => endpoints.profiles.action(profile.id, 'submit', { expected_version: profile.version, reason }),
    {
      successMessage: t('Submitted for review'),
      onSuccess: () => navigate(detail),
      onError: (e) => {
        if (isVersionConflict(e)) {
          setConflict(e);
          setSubmitOpen(false);
          reload();
          return true;
        }
        return e.status === 422;
      },
    },
  );

  if (profile.status !== 'draft') {
    return (
      <>
        <Steps step={3} />
        <Card title={profile.reference} titleAddon={<ProfileStatusPill status={profile.status} />}>
          <p>{t('This profile is no longer a draft. Review and changes continue on the profile page.')}</p>
          <ButtonLink to={detail}>{t('Open profile')}</ButtonLink>
        </Card>
      </>
    );
  }

  return (
    <>
      <Steps step={usable > 0 ? 3 : 2} />
      {conflict ? (
        <ConflictBanner currentVersion={profile.version} reloading={fetching} onReload={() => { setConflict(null); reload(); }} />
      ) : null}
      <div className="grid gd-two">
        <Card title={t('Profile')} titleAddon={<ProfileStatusPill status={profile.status} />}>
          <KeyValueList
            items={[
              { label: profile.kind === 'watchlist' ? t('Reference ID') : t('Employee ID'), value: <span className="mono-ish">{profile.reference}</span> },
              ...(profile.kind === 'staff' ? [{ label: t('Display name'), value: profile.display_name || '—' }] : []),
              ...(profile.kind === 'watchlist'
                ? [
                    { label: t('watchlist|Name'), value: profile.display_name || '—' },
                    { label: t('watchlist|Last seen'), value: profile.last_seen_at ? fmt.dateTime(profile.last_seen_at, tz) : '—' },
                  ]
                : []),
              { label: profile.kind === 'watchlist' ? t('Store scope') : t('Store assignment'), value: <StoreNames ids={profile.store_ids} /> },
              { label: t('Expiry'), value: profile.expires_at ? fmt.date(profile.expires_at, tz) : '—' },
            ]}
          />
          <p className="muted small">
            {t('Version {n}', { n: profile.version })} · <Link to={detail}>{t('Open profile')}</Link>
          </p>
        </Card>
        <Card title={t('Reference photos')}>
          <ProfilePhotos
            profile={profile}
            timeZone={tz}
            canUpload
            canDelete
            canReview={false}
            onChanged={reload}
            emptyText={t('Add at least one reference photo before requesting review.')}
          />
          <div className="gd-submit">
            <h3 className="gd-subhead">{t('Request review')}</h3>
            {usable === 0 ? (
              <p className="muted small">{t('Add at least one reference photo before requesting review.')}</p>
            ) : (
              <>
                <p className="small">
                  {profile.kind === 'watchlist'
                    ? t('A different reviewer must approve. Approval requires at least one approved photo and an unexpired profile.')
                    : t('A staff manager approves the photos and the profile before it is used.')}
                </p>
                <Button onClick={() => setSubmitOpen(true)}>{t('Request review')}</Button>
              </>
            )}
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={submitOpen}
        onClose={() => {
          setSubmitOpen(false);
          submitReview.reset();
        }}
        title={t('Request review')}
        description={t('The draft is locked for review. Material changes later return it to review.')}
        confirmLabel={t('Request review')}
        reasonLabel={t('Note for the reviewer')}
        pending={submitReview.pending}
        error={submitReview.error && !isVersionConflict(submitReview.error) ? apiErrorText(submitReview.error, locale) : null}
        onConfirm={async (reason) => (await submitReview.run(reason)).ok}
      />
    </>
  );
}
