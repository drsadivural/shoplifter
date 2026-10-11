// web-50 Retention & privacy. GET/PUT /v1/org/settings/privacy {expected_version, settings};
// legal holds GET /v1/privacy/holds + POST /v1/incidents/{id}/legal-hold/release {reason};
// data-subject requests GET/POST /v1/privacy/requests + POST .../{id}/complete
// {expected_version, status, resolution}. Shows the suggested Japanese store notice.
import '../styles/group-d.css';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation } from '../api/hooks';
import type { PrivacySettings } from '../api/types';
import { StoreNoticeText } from '../components/groupd/EnrollWizard';
import { gd, type LegalHold, type PrivacyRequest, type PrivacyRequestKind } from '../components/groupd/api';
import { todayIn, zonedDateToIso } from '../components/groupd/dates';
import { apiErrorText, fieldMessage, isVersionConflict } from '../components/groupd/errors';
import { SelectField, TextAreaField, TextField } from '../components/forms';
import { ConfirmDialog } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, Notice, StatusPill } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

const FIELDS: { key: keyof Omit<PrivacySettings, 'deletion_contact'>; label: string; hint: string; min: number; max: number; unit: string }[] = [
  { key: 'raw_video_retention_hours', label: 'Raw video retention', hint: 'Continuous video kept on the store edge ring buffer before it is overwritten.', min: 1, max: 2160, unit: '{n} hours' },
  { key: 'evidence_retention_days', label: 'Evidence retention', hint: 'Alert clips and frames are deleted after this period unless a legal hold applies.', min: 1, max: 3650, unit: '{n} days' },
  { key: 'profile_max_expiry_days', label: 'Profile expiry', hint: 'Longest allowed expiry for watchlist and staff enrollments.', min: 1, max: 3650, unit: '{n} days' },
  { key: 'query_photo_ttl_minutes', label: 'Query photo lifetime', hint: 'Photos uploaded for a search are deleted after this time.', min: 5, max: 1440, unit: '{n} minutes' },
  { key: 'legal_hold_review_days', label: 'Legal hold review', hint: 'Default days until a legal hold must be reviewed. Holds are never indefinite.', min: 1, max: 365, unit: '{n} days' },
];

export default function PrivacyPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader screenId="web-50" />
      <div className="grid gd-two">
        <RetentionForm />
        <div className="gd-stack">
          <Card title={t('Store notice')}>
            <p className="small">{t('Before operational enrollment, publish a store notice with the actual operator, contact, specific purpose, storage period, rights procedure and sharing scope.')}</p>
            <StoreNoticeText />
            <p className="muted small">{t('This is implementation guidance, not a legal conclusion that a particular use is lawful. Cross-retailer sharing is disabled.')}</p>
          </Card>
        </div>
      </div>
      <LegalHolds />
      <Requests />
    </>
  );
}

function RetentionForm() {
  const { t, locale } = useI18n();
  const q = useApiQuery((signal) => endpoints.org.getSettings('privacy', { signal }), []);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const toForm = (s: PrivacySettings) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)]));
  useEffect(() => {
    if (q.data) setForm(toForm(q.data.settings));
  }, [q.data]);

  const save = useMutation((body: { expected_version: number; settings: PrivacySettings }) => endpoints.org.putSettings('privacy', body), {
    successMessage: t('Retention settings saved'),
    onSuccess: (r) => q.setData(r),
    onError: (e) => {
      if (isVersionConflict(e)) {
        setConflict(true);
        q.reload();
        return true;
      }
      if (e.status === 422 && Object.keys(e.fieldErrors).length) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, c]) => [k.replace(/^settings\./, ''), fieldMessage(c, locale) ?? c])));
        return true;
      }
      return false;
    },
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!form || !q.data) return;
    const e: Record<string, string> = {};
    const settings: Record<string, number | string> = {};
    for (const f of FIELDS) {
      const n = Number(form[f.key]);
      if (!Number.isInteger(n) || n < f.min || n > f.max) e[f.key] = t('Enter a whole number from {min} to {max}.', { min: f.min, max: f.max });
      settings[f.key] = n;
    }
    settings.deletion_contact = (form.deletion_contact ?? '').trim();
    setErrors(e);
    if (Object.keys(e).length) return;
    void save.run({ expected_version: q.data.version, settings: settings as unknown as PrivacySettings });
  };

  return (
    <Card title={t('Retention & privacy')}>
      {conflict ? (
        <ConflictBanner
          currentVersion={q.data?.version}
          reloading={q.fetching}
          onReload={() => {
            setConflict(false);
            q.reload();
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="privacy.manage" loading={<p className="muted">{t('Loading…')}</p>}>
        {(d) =>
          form ? (
            <form onSubmit={submit} noValidate>
              {FIELDS.map((f) => (
                <TextField
                  key={f.key}
                  label={t(f.label)}
                  hint={`${t(f.hint)} ${t('Allowed: {min}–{max}.', { min: f.min, max: f.max })} ${t('Saved value')}: ${t(f.unit, { n: d.settings[f.key] })}`}
                  type="number"
                  inputMode="numeric"
                  required
                  min={f.min}
                  max={f.max}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  error={errors[f.key]}
                />
              ))}
              <TextField
                label={t('Deletion and access contact')}
                hint={t('Who customers contact for access, correction or deletion. Shown in store notices.')}
                maxLength={300}
                value={form.deletion_contact ?? ''}
                onChange={(e) => setForm({ ...form, deletion_contact: e.target.value })}
                error={errors.deletion_contact}
              />
              {!d.settings.deletion_contact ? <Notice tone="warning">{t('No deletion contact is set. Define the access, correction and deletion process before enrolling anyone.')}</Notice> : null}
              {save.error && !isVersionConflict(save.error) && !(save.error.status === 422 && Object.keys(save.error.fieldErrors).length) ? (
                <div className="field-error" role="alert">
                  {apiErrorText(save.error, locale)}
                </div>
              ) : null}
              <div className="action-row">
                <Button type="submit" pending={save.pending}>
                  {t('Save')}
                </Button>
                <Button variant="secondary" onClick={() => { setForm(toForm(d.settings)); setErrors({}); }}>
                  {t('Cancel')}
                </Button>
              </div>
              <p className="muted small">
                {d.version === 0 ? t('Defaults — not saved yet') : t('Version {n}', { n: d.version })} · {t('Changes are recorded in the audit log.')}
              </p>
            </form>
          ) : null
        }
      </RouteStateBoundary>
    </Card>
  );
}

function LegalHolds() {
  const { t, fmt, locale } = useI18n();
  const { stores, me, timeZone } = useSession();
  const q = useApiQuery((signal) => gd.privacy.holds({ signal }), []);
  const [target, setTarget] = useState<LegalHold | null>(null);
  const release = useMutation((a: { hold: LegalHold; reason: string }) => gd.privacy.releaseHold(a.hold.id, { reason: a.reason }), {
    successMessage: t('Legal hold released'),
    onSuccess: () => q.reload(),
    onError: (e) => e.status === 409,
  });
  const tzFor = (h: LegalHold) => stores.find((s) => s.id === h.store_id)?.timezone ?? me?.org.timezone ?? timeZone;
  return (
    <Card title={t('Legal hold')} className="gd-section">
      <p className="muted small">{t('Holds keep evidence beyond retention. Each hold has a reason and a review date. Place holds from the incident workspace.')}</p>
      <RouteStateBoundary query={q} permission="privacy.manage" isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title={t('No legal holds')} />} loading={<p className="muted">{t('Loading…')}</p>}>
        {(d) => (
          <ul className="rows">
            {d.items.map((h) => (
              <li className="row" key={h.id}>
                <div className="row-main">
                  <Link className="row-title" to={screenPath('web-24', { id: h.id })}>
                    {h.ref}
                  </Link>{' '}
                  {h.review_overdue ? <StatusPill tone="critical">{t('Review overdue')}</StatusPill> : null}
                  <div className="small">{h.legal_hold_reason}</div>
                  <div className="muted small">
                    {stores.find((s) => s.id === h.store_id)?.name ?? ''} · {t('Review by {date}', { date: fmt.date(h.legal_hold_review_at, tzFor(h)) })}
                    {h.placed_by ? ` · ${t('Placed by {name}', { name: h.placed_by })}` : ''}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setTarget(h)} aria-label={t('Release hold on {ref}', { ref: h.ref })}>
                  {t('Release')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </RouteStateBoundary>
      <ConfirmDialog
        open={target !== null}
        onClose={() => {
          setTarget(null);
          release.reset();
        }}
        title={t('Release legal hold')}
        description={target ? t('Evidence for {ref} returns to normal retention and may be deleted when its retention period has passed.', { ref: target.ref }) : undefined}
        confirmLabel={t('Release')}
        confirmVariant="danger"
        pending={release.pending}
        error={release.error ? apiErrorText(release.error, locale) : null}
        onConfirm={async (reason) => (target ? (await release.run({ hold: target, reason })).ok : false)}
      />
    </Card>
  );
}

const KIND_LABEL: Record<PrivacyRequestKind, string> = {
  access: 'request|Access',
  correction: 'request|Correction',
  deletion: 'request|Deletion',
};

function Requests() {
  const { t, fmt, locale } = useI18n();
  const { me, timeZone } = useSession();
  const tz = me?.org.timezone ?? timeZone;
  const q = useApiQuery((signal) => gd.privacy.requests({ signal }), []);
  const [kind, setKind] = useState<PrivacyRequestKind | ''>('');
  const [subject, setSubject] = useState('');
  const [received, setReceived] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState<{ req: PrivacyRequest; status: 'completed' | 'rejected' } | null>(null);
  const [conflict, setConflict] = useState(false);
  const today = todayIn(tz);

  const create = useMutation((body: { kind: PrivacyRequestKind; subject_reference: string; received_at: string; notes: string }) => gd.privacy.createRequest(body), {
    successMessage: t('Request recorded'),
    onSuccess: () => {
      setKind('');
      setSubject('');
      setReceived('');
      setNotes('');
      q.reload();
    },
    onError: (e) => {
      if (e.status === 422 && Object.keys(e.fieldErrors).length) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, c]) => [k, fieldMessage(c, locale) ?? c])));
        return true;
      }
      return false;
    },
  });
  const complete = useMutation(
    (a: { req: PrivacyRequest; status: 'completed' | 'rejected'; resolution: string }) =>
      gd.privacy.completeRequest(a.req.id, { expected_version: a.req.version, status: a.status, resolution: a.resolution }),
    {
      successMessage: (r) => (r.status === 'completed' ? t('Request completed') : t('Request rejected')),
      onSuccess: () => q.reload(),
      onError: (e) => {
        if (isVersionConflict(e)) {
          setClosing(null);
          setConflict(true);
          q.reload();
          return true;
        }
        return e.status === 409;
      },
    },
  );

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!kind) e.kind = t('This field is required.');
    if (!subject.trim()) e.subject_reference = t('This field is required.');
    if (!received) e.received_at = t('This field is required.');
    else if (received > today) e.received_at = t('The date cannot be in the future.');
    setErrors(e);
    if (Object.keys(e).length) return;
    void create.run({ kind: kind as PrivacyRequestKind, subject_reference: subject.trim(), received_at: zonedDateToIso(received, tz, 'start')!, notes: notes.trim() });
  };

  return (
    <Card title={t('Deletion requests')} className="gd-section">
      <p className="muted small">{t('Track access, correction and deletion requests from data subjects. The response deadline is 14 days from receipt by default; confirm it with counsel.')}</p>
      {conflict ? (
        <ConflictBanner
          reloading={q.fetching}
          onReload={() => {
            setConflict(false);
            q.reload();
          }}
        />
      ) : null}
      <div className="grid gd-two">
        <div>
          <RouteStateBoundary query={q} permission="privacy.manage" isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title={t('No requests recorded')} />} loading={<p className="muted">{t('Loading…')}</p>}>
            {(d) => (
              <ul className="rows">
                {d.items.map((r) => (
                  <li className="row gd-request" key={r.id}>
                    <div className="row-main">
                      <strong>{t(KIND_LABEL[r.kind])}</strong> · <span className="mono-ish">{r.subject_reference}</span>{' '}
                      {r.status === 'open' ? (
                        r.overdue ? (
                          <StatusPill tone="critical">{t('Overdue')}</StatusPill>
                        ) : (
                          <StatusPill tone="warning">{t('request|Open')}</StatusPill>
                        )
                      ) : r.status === 'completed' ? (
                        <StatusPill tone="ok">{t('request|Completed')}</StatusPill>
                      ) : (
                        <StatusPill tone="neutral">{t('request|Rejected')}</StatusPill>
                      )}
                      <div className="muted small">
                        {t('Received {date}', { date: fmt.date(r.received_at, tz) })} · {t('Due {date}', { date: fmt.date(r.due_at, tz) })}
                      </div>
                      {r.notes ? <div className="small gd-prewrap">{r.notes}</div> : null}
                      {r.resolution ? (
                        <div className="small">
                          <span className="muted">{t('Resolution')}:</span> {r.resolution}
                        </div>
                      ) : null}
                    </div>
                    {r.status === 'open' ? (
                      <div className="gd-row-actions">
                        <Button size="sm" onClick={() => setClosing({ req: r, status: 'completed' })}>
                          {t('Complete')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setClosing({ req: r, status: 'rejected' })}>
                          {t('Reject')}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </RouteStateBoundary>
        </div>
        <form onSubmit={submit} noValidate className="gd-subform" aria-label={t('Record a request')}>
          <h3 className="gd-subhead">{t('Record a request')}</h3>
          <SelectField
            label={t('Request type')}
            required
            placeholder={t('Select a type')}
            value={kind}
            onChange={(e) => setKind(e.target.value as PrivacyRequestKind)}
            options={(['access', 'correction', 'deletion'] as const).map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))}
            error={errors.kind}
          />
          <TextField
            label={t('Subject reference')}
            hint={t('An internal reference such as a profile reference ID or ticket number. Avoid recording more personal data than needed.')}
            required
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            error={errors.subject_reference}
          />
          <TextField label={t('Received on')} type="date" required max={today} value={received} onChange={(e) => setReceived(e.target.value)} error={errors.received_at} hint={t('Dates use {tz}.', { tz })} />
          <TextAreaField label={t('Notes')} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {create.error && !(create.error.status === 422 && Object.keys(create.error.fieldErrors).length) ? (
            <div className="field-error" role="alert">
              {apiErrorText(create.error, locale)}
            </div>
          ) : null}
          <Button type="submit" pending={create.pending}>
            {t('Record request')}
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={closing !== null}
        onClose={() => {
          setClosing(null);
          complete.reset();
        }}
        title={closing?.status === 'completed' ? t('Complete request') : t('Reject request')}
        description={t('Describe what was done (or why the request was rejected). The resolution is recorded in the audit log.')}
        confirmLabel={closing?.status === 'completed' ? t('Complete') : t('Reject')}
        confirmVariant={closing?.status === 'rejected' ? 'danger' : 'primary'}
        reasonLabel={t('Resolution')}
        pending={complete.pending}
        error={complete.error && !isVersionConflict(complete.error) ? apiErrorText(complete.error, locale) : null}
        onConfirm={async (resolution) => (closing ? (await complete.run({ req: closing.req, status: closing.status, resolution })).ok : false)}
      />
    </Card>
  );
}
