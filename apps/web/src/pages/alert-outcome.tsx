// web-21 Record incident outcome (?id=). The responder who owns the alert records
//   POST /v1/incidents/{id}/outcome {expected_version, outcome, reason, observed_behavior?, loss_value?, recovered_value?}
// Ownership first: a "new" alert must be acknowledged (claim) before the form is offered.
// 409 owned_by_another_responder / evidence_pending / version_conflict -> ConflictBanner + refetch;
// the draft stays in the form and is never resubmitted automatically. Outcomes are human only.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useApiQuery, useMutation } from '../api/hooks';
import type { IncidentOutcome } from '../api/types';
import { EvidenceStatePill, OutcomePill } from '../components/domain';
import { Checkbox, TextAreaField, TextField } from '../components/forms';
import { EvidenceList, EvidencePlayer } from '../components/groupc/EvidencePanel';
import { fieldError, OUTCOME_KEY, OUTCOMES } from '../components/groupc/labels';
import { ConflictNotice, useConflict, useStoreTimeZone } from '../components/groupc/misc';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import type { ApiError } from '../api/client';
import { gc, type IncidentDetail } from './_groupc-api';
import '../styles/group-c.css';

const OUTCOME_HINT: Record<IncidentOutcome, string> = {
  confirmed: 'The footage and observed facts show the incident happened.',
  false_alert: 'The footage shows normal activity; the alert was not an incident.',
  inconclusive: 'The footage or facts are not sufficient to decide. Request review if needed.',
};

export default function AlertOutcomePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  const q = useApiQuery((signal) => gc.incident(id!, { signal }), [id], { enabled: Boolean(id) });
  const { conflict, setConflict, onConflict } = useConflict(q.reload);

  if (!id) {
    return (
      <>
        <PageHeader screenId="web-21" />
        <EmptyState
          icon="alerts"
          title={t('No alert selected')}
          description={t('Open an alert from the alert inbox.')}
          action={<ButtonLink to={screenPath('web-19')}>{t('Open alert inbox')}</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        screenId="web-21"
        subtitle={q.data ? `${q.data.ref} · ${q.data.store_name} · ${t('Review evidence. Respond with confidence.')}` : undefined}
      />
      {conflict ? (
        <ConflictNotice
          conflict={conflict}
          currentVersion={q.data?.version}
          reloading={q.fetching}
          onReload={() => {
            q.reload();
            setConflict(null);
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="incident.respond">
        {(incident) => <OutcomeReady incident={incident} onUpdated={(i) => q.setData(i)} onConflict={onConflict} />}
      </RouteStateBoundary>
    </>
  );
}

function OutcomeReady({
  incident,
  onUpdated,
  onConflict,
}: {
  incident: IncidentDetail;
  onUpdated: (i: IncidentDetail) => void;
  onConflict: (e: ApiError) => boolean;
}) {
  const { t, fmt } = useI18n();
  const { me } = useSession();
  const tz = useStoreTimeZone()(incident.store_id, incident.store_timezone);
  const mine = incident.assignee?.id === me?.user.id;
  const claim = useMutation(() => gc.claim(incident.id, incident.version), {
    successMessage: t('Alert acknowledged'),
    onSuccess: onUpdated,
    onError: onConflict,
  });

  const evidenceCard = (
    <Card title={t('Supporting evidence')}>
      <EvidencePlayer
        state={incident.evidence_state}
        evidence={incident.evidence}
        cameraName={incident.camera_name}
        capturedLabel={fmt.dateTime(incident.captured_at, tz, { withZone: true })}
      />
      <EvidenceList evidence={incident.evidence} />
    </Card>
  );

  let blocker: ReactNode = null;
  if (incident.status === 'resolved') {
    blocker = (
      <Card title={t('Outcome already recorded')}>
        <p>
          <OutcomePill outcome={incident.outcome} />
        </p>
        {incident.outcome_reason ? <p className="gc-wrap">{incident.outcome_reason}</p> : null}
        <p className="muted small">{t('To change it, reopen the incident from the incident workspace (requires permission).')}</p>
        <ButtonLink to={screenPath('web-24', { id: incident.id })}>{t('Open incident workspace')}</ButtonLink>
      </Card>
    );
  } else if (incident.assignee && !mine) {
    blocker = (
      <Card title={t('Owned by another responder')}>
        <p>
          {t('{name} is handling this alert. You can follow it here; only the assignee records the outcome.', {
            name: incident.assignee.display_name,
          })}
        </p>
        <ButtonLink to={screenPath('web-20', { id: incident.id })}>{t('Back to alert')}</ButtonLink>
      </Card>
    );
  } else if (incident.status === 'new') {
    blocker = (
      <Card title={t('Acknowledge first')}>
        <p>{t('Acknowledge to take ownership before recording an outcome.')}</p>
        <div className="action-row">
          <Button onClick={() => void claim.run(undefined)} pending={claim.pending}>
            {t('Acknowledge')}
          </Button>
          <ButtonLink to={screenPath('web-20', { id: incident.id })}>{t('Back to alert')}</ButtonLink>
        </div>
      </Card>
    );
  }

  if (blocker) {
    return (
      <div className="grid detail-grid">
        {blocker}
        {evidenceCard}
      </div>
    );
  }
  return <OutcomeForm incident={incident} evidenceCard={evidenceCard} onConflict={onConflict} />;
}

interface Draft {
  outcome: IncidentOutcome | '';
  reason: string;
  observed: string;
  loss: string;
  recovered: string;
  reviewed: boolean;
}

function parseAmount(v: string): number | null | 'invalid' {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 999_999_999 && Number.isInteger(n) ? n : 'invalid';
}

function OutcomeForm({
  incident,
  evidenceCard,
  onConflict,
}: {
  incident: IncidentDetail;
  evidenceCard: ReactNode;
  onConflict: (e: ApiError) => boolean;
}) {
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>({ outcome: '', reason: '', observed: '', loss: '', recovered: '', reviewed: false });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const hasEvidence = incident.evidence.length > 0;
  const money = draft.outcome !== 'false_alert';
  const loss = money ? parseAmount(draft.loss) : null;
  const recovered = money ? parseAmount(draft.recovered) : null;
  const currency = incident.currency ?? 'JPY';

  const errors = {
    outcome: !draft.outcome ? t('Select an outcome.') : null,
    reason: draft.reason.trim().length < 3 ? t('Enter a reason of at least {n} characters.', { n: 3 }) : null,
    loss: loss === 'invalid' ? t('Enter a whole amount of 0 or more.') : null,
    recovered: recovered === 'invalid' ? t('Enter a whole amount of 0 or more.') : null,
    reviewed: hasEvidence && !draft.reviewed ? t('Confirm that you reviewed the evidence.') : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  const save = useMutation(
    () =>
      gc.outcome(incident.id, {
        expected_version: incident.version,
        outcome: draft.outcome as IncidentOutcome,
        reason: draft.reason.trim(),
        ...(draft.observed.trim() ? { observed_behavior: draft.observed.trim() } : {}),
        ...(typeof loss === 'number' ? { loss_value: loss } : {}),
        ...(typeof recovered === 'number' ? { recovered_value: recovered } : {}),
      }),
    {
      successMessage: t('Outcome recorded'),
      onSuccess: (updated) => navigate(screenPath('web-24', { id: updated.id })),
      onError: (e) => onConflict(e) || e.status === 422,
    },
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    await save.run(undefined);
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const server = save.fieldErrors;

  return (
    <div className="grid detail-grid">
      <div className="gc-stack">
        <Card title={t('Record incident outcome')}>
          <form onSubmit={submit} noValidate className="gc-form">
            <fieldset className="gc-radio-group" aria-describedby={show('outcome') ? 'outcome-err' : undefined}>
              <legend>
                {t('Outcome')}
                <span className="required-marker" aria-hidden="true">
                  {' '}
                  *
                </span>
              </legend>
              {OUTCOMES.map((o) => (
                <label className="gc-radio" key={o}>
                  <input type="radio" name="outcome" value={o} checked={draft.outcome === o} onChange={() => set('outcome', o)} />
                  <span>
                    <span className="gc-radio-label">{t(OUTCOME_KEY[o])}</span>
                    <span className="gc-radio-hint">{t(OUTCOME_HINT[o])}</span>
                  </span>
                </label>
              ))}
              {show('outcome') || server.outcome ? (
                <div className="field-error gc-group-error" id="outcome-err">
                  {show('outcome') ?? fieldError(t, server.outcome)}
                </div>
              ) : null}
            </fieldset>
            {draft.outcome === 'confirmed' && incident.evidence_state === 'pending' ? (
              <Notice tone="warning">{t('Evidence is still uploading. A confirmed outcome can be recorded after it arrives; otherwise record inconclusive.')}</Notice>
            ) : null}
            <TextAreaField
              label={t('Reason')}
              required
              rows={3}
              maxLength={2000}
              value={draft.reason}
              onChange={(e) => set('reason', e.target.value)}
              hint={t('Describe what you verified in the footage. Recorded in the audit log with your name.')}
              error={show('reason') ?? fieldError(t, server.reason)}
            />
            <TextAreaField
              label={t('Observed behavior')}
              rows={3}
              maxLength={2000}
              value={draft.observed}
              onChange={(e) => set('observed', e.target.value)}
              hint={t('Facts only: what was seen, where and when. Do not record assumptions about identity or intent.')}
              error={fieldError(t, server.observed_behavior)}
            />
            {money ? (
              <div className="form-grid">
                <TextField
                  label={`${t('Loss value')} (${currency})`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={draft.loss}
                  onChange={(e) => set('loss', e.target.value)}
                  hint={t('Leave blank if unknown. Reports count values from confirmed incidents only.')}
                  error={show('loss') ?? fieldError(t, server.loss_value)}
                />
                <TextField
                  label={`${t('Recovered value')} (${currency})`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={draft.recovered}
                  onChange={(e) => set('recovered', e.target.value)}
                  hint={t('Value of goods recovered, if any. Leave blank if unknown.')}
                  error={show('recovered') ?? fieldError(t, server.recovered_value)}
                />
              </div>
            ) : null}
            {hasEvidence ? (
              <>
                <Checkbox
                  label={t('I reviewed the evidence')}
                  hint={t('Required before saving: you watched the clip or frame listed under Supporting evidence.')}
                  checked={draft.reviewed}
                  onChange={(e) => set('reviewed', e.target.checked)}
                  aria-invalid={show('reviewed') ? true : undefined}
                />
                {show('reviewed') ? <div className="field-error gc-group-error">{show('reviewed')}</div> : null}
              </>
            ) : (
              <Notice tone="info">{t('No evidence files are attached. Base the outcome on what staff observed and say so in the reason.')}</Notice>
            )}
            <div className="gc-form-actions">
              <Button type="submit" pending={save.pending}>
                {t('Save')}
              </Button>
              <ButtonLink to={screenPath('web-20', { id: incident.id })}>{t('Cancel')}</ButtonLink>
            </div>
          </form>
        </Card>
        {evidenceCard}
      </div>
      <div className="gc-stack">
        <Card title={t('Review before saving')}>
          <KeyValueList
            items={[
              { label: t('Incident'), value: incident.ref },
              { label: t('Outcome'), value: draft.outcome ? t(OUTCOME_KEY[draft.outcome]) : t('Not selected') },
              { label: t('Reason'), value: draft.reason.trim() ? <span className="gc-wrap">{draft.reason.trim()}</span> : t('Not entered') },
              {
                label: t('Observed behavior'),
                value: draft.observed.trim() ? <span className="gc-wrap">{draft.observed.trim()}</span> : t('Not entered'),
              },
              ...(money
                ? [
                    { label: t('Loss value'), value: typeof loss === 'number' ? fmt.currency(loss, currency) : t('Not entered') },
                    { label: t('Recovered value'), value: typeof recovered === 'number' ? fmt.currency(recovered, currency) : t('Not entered') },
                  ]
                : []),
              { label: t('Evidence'), value: <EvidenceStatePill state={incident.evidence_state} /> },
              { label: t('Current version'), value: incident.version },
            ]}
          />
          <Notice tone="warning">{t('AI signals require review. Check the footage and observed facts before recording an outcome.')}</Notice>
          <Notice tone="info">
            {t('Follow your store’s trained response procedure. RetailGuard does not direct staff to approach or confront anyone, and it does not establish legal authority.')}
          </Notice>
          <p className="muted small">{t('Saved changes appear in the audit log.')}</p>
          <p className="small">
            <Link to={screenPath('web-24', { id: incident.id })}>{t('Open incident workspace')}</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
