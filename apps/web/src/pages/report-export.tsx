// web-42 Export evidence. POST /v1/exports with an Idempotency-Key generated once per submission
// intent and reused on retry (changing any field starts a new intent). The API requires an
// MFA-verified session (403 mfa_required_for_export) and returns 503 redaction_unavailable for any
// automated redaction because no validated detector is installed. The export is built by the worker:
// the page polls GET /v1/exports/{id} until it is ready, then offers the audited download.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import type { Redaction } from '../api/types';
import { SelectField, TextAreaField, TextField } from '../components/forms';
import { ExportsManifest } from '../components/groupc/ExportsManifest';
import { EXPORT_STATUS, fieldError, REDACTION_KEY, REDACTIONS, shortHash } from '../components/groupc/labels';
import { ConflictNotice, useConflict, useStoreTimeZone } from '../components/groupc/misc';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, KeyValueList, Notice, StatusPill } from '../components/primitives';
import { EmptyState, ErrorState, LoadingState, PermissionDenied, UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import { gc, type ExportRecord } from './_groupc-api';
import '../styles/group-c.css';

const REDACTION_HINT: Record<Redaction, string> = {
  none: 'Original footage. Only for recipients authorized to see unredacted evidence.',
  blur_bystanders: 'Blur people not involved in the incident. Requires automated redaction.',
  faces_and_bystanders: 'Blur all faces and bystanders. Requires automated redaction.',
};

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function ReportExportPage() {
  const { t } = useI18n();
  const { can, me } = useSession();
  const [params] = useSearchParams();
  const cases = useApiQuery((signal) => gc.cases({}, { signal }), [], { enabled: can('export.create') && can('case.read') });
  const recent = useApiQuery((signal) => gc.exports({ signal }), [], { enabled: can('export.create') && can('case.read') });
  const [created, setCreated] = useState<ExportRecord | null>(null);

  if (!can('export.create')) {
    return (
      <>
        <PageHeader screenId="web-42" />
        <PermissionDenied permission="export.create" />
      </>
    );
  }

  const mfaVerified = me?.session.mfa_verified ?? false;
  const here = `${screenPath('web-42')}${params.toString() ? `?${params.toString()}` : ''}`;
  return (
    <>
      <PageHeader screenId="web-42" />
      {!mfaVerified ? (
        <Notice tone="critical" title={t('Multi-factor verification required')}>
          {t('Evidence export requires a session verified with multi-factor authentication. Verify your identity, then return to this page.')}{' '}
          <Link to={`/web/mfa?next=${encodeURIComponent(here)}`}>{t('Verify now')}</Link>
        </Notice>
      ) : null}
      <div className="grid detail-grid gc-section">
        <div className="gc-stack">
          {cases.loading ? (
            <LoadingState variant="cards" rows={1} />
          ) : cases.error && !cases.data ? (
            <Card title={t('Export evidence')}>
              <ErrorState error={cases.error} onRetry={cases.reload} compact title={t('Cases could not be loaded')} />
            </Card>
          ) : (cases.data?.items.length ?? 0) === 0 ? (
            <Card title={t('Export evidence')}>
              <EmptyState
                icon="cases"
                title={t('No cases to export')}
                description={t('Evidence is exported per case. Create a case from an incident first.')}
                action={<ButtonLink to={screenPath('web-25')}>{t('Open case management')}</ButtonLink>}
              />
            </Card>
          ) : (
            <ExportForm
              cases={cases.data!.items}
              initialCase={params.get('case') ?? ''}
              onCreated={(e) => {
                setCreated(e);
                recent.reload();
              }}
            />
          )}
          {created ? <ExportProgress initial={created} onSettled={recent.reload} /> : null}
        </div>
        <Card title={t('Recent exports')}>
          {recent.loading ? (
            <LoadingState variant="inline" />
          ) : recent.error && !recent.data ? (
            <ErrorState error={recent.error} onRetry={recent.reload} compact />
          ) : (
            <RecentExports exports={recent.data?.items ?? []} caseRefs={new Map((cases.data?.items ?? []).map((c) => [c.id, `${c.ref} · ${c.title}`]))} />
          )}
        </Card>
      </div>
    </>
  );
}

interface Draft {
  caseId: string;
  redaction: Redaction;
  reason: string;
  recipient: string;
  days: string;
}

function ExportForm({
  cases,
  initialCase,
  onCreated,
}: {
  cases: { id: string; ref: string; title: string; status: 'open' | 'closed'; incident_count?: number }[];
  initialCase: string;
  onCreated: (e: ExportRecord) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>({
    caseId: cases.some((c) => c.id === initialCase) ? initialCase : '',
    redaction: 'none',
    reason: '',
    recipient: '',
    days: '7',
  });
  const [submitted, setSubmitted] = useState(false);
  // One key per submission intent: reused when retrying the same values, replaced when they change.
  const keyRef = useRef<string | null>(null);
  const draftKey = JSON.stringify(draft);
  useEffect(() => {
    keyRef.current = null;
  }, [draftKey]);
  const { conflict, setConflict, onConflict } = useConflict(() => undefined);
  const [unavailable, setUnavailable] = useState<ApiError | null>(null);
  const [mfaError, setMfaError] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const days = Number(draft.days);
  const errors = {
    caseId: !draft.caseId ? t('Select a case.') : null,
    reason: draft.reason.trim().length < 3 ? t('Enter a reason of at least {n} characters.', { n: 3 }) : null,
    recipient: !draft.recipient.trim() ? t('Enter the recipient.') : null,
    days: !(Number.isInteger(days) && days >= 1 && days <= 30) ? t('Enter a whole number from {min} to {max}.', { min: 1, max: 30 }) : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const selected = cases.find((c) => c.id === draft.caseId);

  const create = useMutation(
    (key: string) =>
      gc.createExport(key, {
        case_id: draft.caseId,
        redaction: draft.redaction,
        reason: draft.reason.trim(),
        recipient: draft.recipient.trim(),
        expires_in_days: days,
      }),
    {
      successMessage: t('Export requested'),
      onSuccess: (e) => {
        keyRef.current = null;
        setSubmitted(false);
        setDraft((d) => ({ ...d, reason: '', recipient: '' }));
        onCreated(e);
      },
      onError: (e) => {
        if (e.status === 503) {
          setUnavailable(e);
          return true;
        }
        if (e.status === 403 && e.code === 'mfa_required_for_export') {
          setMfaError(true);
          return true;
        }
        if (e.code === 'idempotency_mismatch') keyRef.current = null;
        return onConflict(e) || e.status === 422;
      },
    },
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setUnavailable(null);
    setMfaError(false);
    setConflict(null);
    if (!valid) return;
    if (!keyRef.current) keyRef.current = newKey();
    await create.run(keyRef.current);
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const fe = create.fieldErrors;

  return (
    <Card title={t('Export evidence')}>
      {conflict ? <ConflictNotice conflict={conflict} onReload={() => setConflict(null)} /> : null}
      <form onSubmit={submit} noValidate className="gc-form">
        <SelectField
          label={t('Case scope')}
          required
          value={draft.caseId}
          onChange={(e) => set('caseId', e.target.value)}
          placeholder={t('Select a case')}
          options={cases.map((c) => ({
            value: c.id,
            label: `${c.ref} · ${c.title}${c.status === 'closed' ? ` (${t('case|Closed')})` : ''}`,
          }))}
          hint={
            selected
              ? t('Includes the {n} incidents linked to this case and their evidence files.', { n: selected.incident_count ?? 0 })
              : t('Exports contain only the incidents linked to the selected case.')
          }
          error={show('caseId') ?? fieldError(t, fe.case_id)}
        />
        <fieldset className="gc-radio-group">
          <legend>{t('Redaction')}</legend>
          {REDACTIONS.map((r) => (
            <label className="gc-radio" key={r}>
              <input type="radio" name="redaction" value={r} checked={draft.redaction === r} onChange={() => set('redaction', r)} />
              <span>
                <span className="gc-radio-label">{t(REDACTION_KEY[r])}</span>
                <span className="gc-radio-hint">{t(REDACTION_HINT[r])}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {draft.redaction !== 'none' ? (
          <Notice tone="warning">
            {t('Automated redaction needs a validated person and face detector, which is not installed. The server will refuse this request. Choose “None” only if the recipient is authorized to see unredacted evidence.')}
          </Notice>
        ) : null}
        <TextAreaField
          label={t('Export reason')}
          required
          rows={3}
          maxLength={2000}
          value={draft.reason}
          onChange={(e) => set('reason', e.target.value)}
          hint={t('The purpose of the disclosure, e.g. a police report number. Recorded in the audit log and the manifest.')}
          error={show('reason') ?? fieldError(t, fe.reason)}
        />
        <div className="form-grid">
          <TextField
            label={t('Recipient')}
            required
            maxLength={300}
            value={draft.recipient}
            onChange={(e) => set('recipient', e.target.value)}
            hint={t('Person or organization receiving the bundle.')}
            error={show('recipient') ?? fieldError(t, fe.recipient)}
          />
          <TextField
            label={t('Expiry')}
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            required
            value={draft.days}
            onChange={(e) => set('days', e.target.value)}
            hint={t('Days until the download link stops working (1–30).')}
            error={show('days') ?? fieldError(t, fe.expires_in_days)}
          />
        </div>
        {unavailable ? (
          <UnavailableNotice code={unavailable.code} title={unavailable.code === 'redaction_unavailable' ? t('Automated redaction is unavailable') : undefined}>
            {unavailable.code === 'redaction_unavailable'
              ? t('No validated detector is installed to blur bystanders or faces, so no export was created. Choose “None” only if the recipient is authorized to see unredacted evidence.')
              : undefined}
          </UnavailableNotice>
        ) : null}
        {mfaError ? (
          <Notice tone="critical" title={t('Multi-factor verification required')}>
            {t('Evidence export requires a session verified with multi-factor authentication. Verify your identity, then return to this page.')}{' '}
            <Link to={`/web/mfa?next=${encodeURIComponent(screenPath('web-42', { case: draft.caseId }))}`}>{t('Verify now')}</Link>
          </Notice>
        ) : null}
        {create.error && ![503, 422, 409].includes(create.error.status) && !mfaError ? (
          <div className="field-error" role="alert">
            {t(errorMessageKey(create.error))}
            {create.error.requestId ? <span className="mono small"> · {t('Request ID')}: {create.error.requestId}</span> : null}
            {create.error.retriable || create.error.isNetwork ? <span> · {t('Submitting again reuses the same request key, so no duplicate export is created.')}</span> : null}
          </div>
        ) : null}
        <div className="gc-form-actions">
          <Button type="submit" pending={create.pending} icon="upload">
            {t('Generate evidence bundle')}
          </Button>
          {selected ? <ButtonLink to={screenPath('web-26', { id: selected.id })}>{t('Cancel')}</ButtonLink> : <ButtonLink to={screenPath('web-25')}>{t('Cancel')}</ButtonLink>}
        </div>
      </form>
    </Card>
  );
}

function ExportProgress({ initial, onSettled }: { initial: ExportRecord; onSettled: () => void }) {
  const { t, fmt } = useI18n();
  const tz = useStoreTimeZone()(null);
  const [polling, setPolling] = useState(initial.status === 'queued');
  const q = useApiQuery((signal) => gc.getExport(initial.id, { signal }), [initial.id], { pollMs: polling ? 3000 : undefined });
  const e = q.data ?? initial;
  useEffect(() => {
    if (e.status !== 'queued' && polling) {
      setPolling(false);
      onSettled();
    }
  }, [e.status, polling, onSettled]);
  const [tone, key] = EXPORT_STATUS[e.status] ?? EXPORT_STATUS.failed!;
  return (
    <Card title={t('Evidence bundle')} titleAddon={<StatusPill tone={tone}>{t(key)}</StatusPill>}>
      <KeyValueList
        items={[
          { label: t('Recipient'), value: e.recipient },
          { label: t('Redaction'), value: t(REDACTION_KEY[e.redaction]) },
          { label: t('Expiry'), value: fmt.dateTime(e.expires_at, tz, { withZone: true }) },
          ...(e.manifest?.bundle_sha256
            ? [{ label: `${t('Bundle')} SHA-256`, value: <span className="mono small gc-wrap" title={e.manifest.bundle_sha256}>{shortHash(e.manifest.bundle_sha256)}</span> }]
            : []),
        ]}
      />
      {e.status === 'queued' ? (
        <p className="muted small" role="status">
          {t('The bundle is being prepared. This page checks every few seconds.')}
        </p>
      ) : e.status === 'ready' ? (
        <div className="action-row">
          <a className="btn btn-primary btn-md" href={endpoints.exports.downloadUrl(e.id)} download>
            {t('Download bundle')}
          </a>
        </div>
      ) : e.status === 'failed' ? (
        <p className="field-error">{e.error ?? t('The bundle could not be built.')}</p>
      ) : null}
      {q.error ? <ErrorState error={q.error} onRetry={q.reload} compact title={t('Status could not be refreshed')} /> : null}
      <p className="muted small">{t('Each download is recorded in the case access log with your name.')}</p>
    </Card>
  );
}

function RecentExports({ exports, caseRefs }: { exports: ExportRecord[]; caseRefs: Map<string, string> }) {
  const { t } = useI18n();
  const tz = useStoreTimeZone()(null);
  const grouped = useMemo(() => {
    const m = new Map<string, ExportRecord[]>();
    for (const e of exports.slice(0, 20)) m.set(e.case_id, [...(m.get(e.case_id) ?? []), e]);
    return [...m.entries()];
  }, [exports]);
  if (exports.length === 0) return <p className="muted small">{t('No exports yet.')}</p>;
  return (
    <>
      {grouped.map(([caseId, list]) => (
        <div key={caseId} className="gc-section">
          <h3 className="gc-subhead">
            <Link to={screenPath('web-26', { id: caseId })}>{caseRefs.get(caseId) ?? t('Case')}</Link>
          </h3>
          <ExportsManifest exports={list} timeZone={tz} />
        </div>
      ))}
      <p className="muted small">{t('Showing the 20 most recent exports.')}</p>
    </>
  );
}
