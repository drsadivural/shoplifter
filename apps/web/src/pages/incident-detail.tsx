// web-24 Incident workspace. GET /v1/incidents/{id} (?id=) with:
//   evidence player + hashes, notes (POST /notes), related visits (GET /visit — re-identification is
//   not installed, so only time-adjacent events are listed and never linked to the same person),
//   review history (reviews + audit timeline), create case (POST /v1/cases), claim / request review /
//   escalate / reopen with expected_version, legal hold place/release (privacy.manage) and watchlist
//   association accept/reject (watchlist candidates only).
// Facts are confirmed only through a human outcome (web-21). 409 -> ConflictBanner + refetch.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import { ChannelLabel, CHANNEL_LABEL, EvidenceStatePill, IncidentStatusPill, OutcomePill, PriorityPill } from '../components/domain';
import { TextAreaField, TextField } from '../components/forms';
import { ActivityTimeline, NotesPanel } from '../components/groupc/Activity';
import { EscalateIncidentForm } from '../components/groupc/EscalateIncidentForm';
import { EvidenceList, EvidencePlayer } from '../components/groupc/EvidencePanel';
import { fieldError, OUTCOME_KEY, reviewActionLabel } from '../components/groupc/labels';
import { ConflictNotice, useConflict, useStoreTimeZone } from '../components/groupc/misc';
import { ConfirmDialog, Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState, ErrorState, LoadingState, UnavailableNotice } from '../components/states';
import { hasTranslation, useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import type { ApiError } from '../api/client';
import { gc, type IncidentDetail } from './_groupc-api';
import '../styles/group-c.css';

type Dialog = null | 'review' | 'escalate' | 'reopen' | 'case' | 'hold' | 'release' | 'accept' | 'reject';

export default function IncidentDetailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  const [evidencePending, setEvidencePending] = useState(false);
  const q = useApiQuery((signal) => gc.incident(id!, { signal }), [id], {
    enabled: Boolean(id),
    pollMs: evidencePending ? 15_000 : undefined,
  });
  useEffect(() => setEvidencePending(q.data?.evidence_state === 'pending'), [q.data?.evidence_state]);
  const { conflict, setConflict, onConflict } = useConflict(q.reload);
  const incident = q.data;

  if (!id) {
    return (
      <>
        <PageHeader screenId="web-24" />
        <EmptyState
          icon="incidents"
          title={t('No incident selected')}
          description={t('Open an incident from the incident register.')}
          action={<ButtonLink to={screenPath('web-23')}>{t('Open incident register')}</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        screenId="web-24"
        subtitle={incident ? `${incident.ref} · ${incident.store_name} · ${t('Review evidence. Respond with confidence.')}` : undefined}
      />
      {conflict ? (
        <ConflictNotice
          conflict={conflict}
          currentVersion={incident?.version}
          reloading={q.fetching}
          onReload={() => {
            q.reload();
            setConflict(null);
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="incident.read">
        {(data) => <IncidentReady incident={data} onUpdated={(i) => q.setData(i)} onConflict={onConflict} reload={q.reload} />}
      </RouteStateBoundary>
    </>
  );
}

function IncidentReady({
  incident,
  onUpdated,
  onConflict,
  reload,
}: {
  incident: IncidentDetail;
  onUpdated: (i: IncidentDetail) => void;
  onConflict: (e: ApiError) => boolean;
  reload: () => void;
}) {
  const { t, fmt } = useI18n();
  const { me, can } = useSession();
  const navigate = useNavigate();
  const tz = useStoreTimeZone()(incident.store_id, incident.store_timezone);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  const mine = incident.assignee?.id === me?.user.id;
  const ownedByOther = incident.assignee !== null && !mine;
  const resolved = incident.status === 'resolved';
  const respond = can('incident.respond');

  const claim = useMutation(() => gc.claim(incident.id, incident.version), {
    successMessage: t('Alert acknowledged'),
    onSuccess: onUpdated,
    onError: onConflict,
  });
  const requestReview = useMutation((reason: string) => gc.requestReview(incident.id, incident.version, reason), {
    successMessage: t('Review requested'),
    onSuccess: onUpdated,
    onError: (e) => (onConflict(e) ? (close(), true) : false),
  });
  const reopen = useMutation((reason: string) => gc.reopen(incident.id, incident.version, reason), {
    successMessage: t('Incident reopened'),
    onSuccess: onUpdated,
    onError: (e) => (onConflict(e) ? (close(), true) : false),
  });
  const addNote = useMutation((body: string) => gc.addNote(incident.id, body), {
    successMessage: t('Note added'),
    onSuccess: onUpdated,
  });
  const association = useMutation(
    (a: { decision: 'accepted' | 'rejected'; reason: string }) => gc.association(incident.id, a),
    {
      successMessage: (r) => (r.association_decision === 'accepted' ? t('Association accepted') : t('Association rejected')),
      onSuccess: onUpdated,
      onError: (e) => (onConflict(e) ? (close(), true) : false),
    },
  );
  const release = useMutation((reason: string) => gc.releaseHold(incident.id, { reason }), {
    successMessage: t('Legal hold released'),
    onSuccess: () => reload(),
    onError: (e) => (onConflict(e) ? (close(), true) : false),
  });

  const captured = fmt.dateTime(incident.captured_at, tz, { withZone: true });
  const canCreateCase = can('case.manage');
  const canHold = can('privacy.manage');

  const actions = (
    <div className="action-row">
      {respond && incident.status === 'new' && !ownedByOther ? (
        <Button onClick={() => void claim.run(undefined)} pending={claim.pending}>
          {t('Acknowledge')}
        </Button>
      ) : null}
      {respond && mine && (incident.status === 'acknowledged' || incident.status === 'reviewing') ? (
        <ButtonLink variant="primary" to={screenPath('web-21', { id: incident.id })}>
          {t('Record outcome')}
        </ButtonLink>
      ) : null}
      {respond && !ownedByOther && (incident.status === 'new' || incident.status === 'acknowledged') ? (
        <Button variant="secondary" onClick={() => setDialog('review')}>
          {t('Request review')}
        </Button>
      ) : null}
      {respond && !resolved ? (
        <Button variant="secondary" onClick={() => setDialog('escalate')}>
          {t('Escalate')}
        </Button>
      ) : null}
      {resolved && can('incident.reopen') ? (
        <Button variant="secondary" onClick={() => setDialog('reopen')}>
          {t('Reopen')}
        </Button>
      ) : null}
      {canCreateCase ? (
        <Button variant="secondary" onClick={() => setDialog('case')}>
          {t('Create case')}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="grid detail-grid">
      <div className="gc-stack">
        <Card title={t('Evidence')} titleAddon={<Badge tone="warning">{t('Review required')}</Badge>}>
          <EvidencePlayer state={incident.evidence_state} evidence={incident.evidence} cameraName={incident.camera_name} capturedLabel={captured} />
          <Notice tone="warning">{t('AI signals require review. Check the footage and observed facts before recording an outcome.')}</Notice>
          {incident.description ? (
            <>
              <h3 className="gc-subhead">{t('Description')}</h3>
              <p className="gc-wrap">{incident.description}</p>
            </>
          ) : null}
          {incident.uncertainty.length > 0 ? (
            <>
              <h3 className="gc-subhead">{t('Observed uncertainty')}</h3>
              <ul className="plain-list">
                {incident.uncertainty.map((u) => (
                  <li key={u}>{hasTranslation('en', `uncertainty|${u}`) ? t(`uncertainty|${u}`) : u}</li>
                ))}
              </ul>
            </>
          ) : null}
          <h3 className="gc-subhead">{t('Evidence files')}</h3>
          <EvidenceList evidence={incident.evidence} />
        </Card>

        <Card title={t('Notes')}>
          <NotesPanel
            notes={incident.notes}
            timeZone={tz}
            canAdd={respond}
            pending={addNote.pending}
            onAdd={async (body) => (await addNote.run(body)).ok}
          />
        </Card>

        <Card title={t('Review history')}>
          {incident.reviews.length === 0 ? (
            <p className="muted small">{t('No review actions recorded yet.')}</p>
          ) : (
            <ul className="gc-list">
              {incident.reviews.map((r) => (
                <li key={r.id}>
                  <div className="gc-list-main">
                    <span className="gc-list-title">
                      {reviewActionLabel(t, r.action)}
                      {r.outcome ? ` · ${t(OUTCOME_KEY[r.outcome])}` : ''}
                    </span>
                    {r.reason ? <span className="small gc-wrap">{r.reason}</span> : null}
                    <span className="muted small">
                      {r.actor} · {fmt.dateTime(r.created_at, tz, { withZone: true })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h3 className="gc-subhead">{t('Timeline')}</h3>
          <ActivityTimeline entries={incident.timeline} timeZone={tz} />
        </Card>
      </div>

      <div className="gc-stack">
        <Card title={t('Incident')}>
          <KeyValueList
            items={[
              { label: t('Incident'), value: incident.ref },
              { label: t('Type'), value: <ChannelLabel channel={incident.channel} /> },
              { label: t('Store'), value: incident.store_name },
              { label: t('Camera'), value: incident.camera_name ?? t('No camera') },
              { label: t('Captured'), value: captured },
              { label: t('Status'), value: <IncidentStatusPill status={incident.status} /> },
              { label: t('Outcome'), value: <OutcomePill outcome={incident.outcome} /> },
              ...(incident.outcome_reason ? [{ label: t('Outcome reason'), value: <span className="gc-wrap">{incident.outcome_reason}</span> }] : []),
              ...(incident.observed_behavior
                ? [{ label: t('Observed behavior'), value: <span className="gc-wrap">{incident.observed_behavior}</span> }]
                : []),
              ...(incident.loss_value !== null
                ? [{ label: t('Loss value'), value: fmt.currency(incident.loss_value, incident.currency ?? 'JPY') }]
                : []),
              ...(incident.recovered_value !== null
                ? [{ label: t('Recovered value'), value: fmt.currency(incident.recovered_value, incident.currency ?? 'JPY') }]
                : []),
              { label: t('Priority'), value: <PriorityPill priority={incident.priority} /> },
              { label: t('Evidence'), value: <EvidenceStatePill state={incident.evidence_state} /> },
              { label: t('Assignee'), value: incident.assignee ? incident.assignee.display_name : t('Unassigned') },
              ...(incident.escalated_at ? [{ label: t('Escalated'), value: fmt.dateTime(incident.escalated_at, tz, { withZone: true }) }] : []),
              {
                label: t('Legal hold'),
                value: incident.legal_hold ? (
                  <span>
                    <Badge tone="info">{t('On hold')}</Badge>{' '}
                    <span className="small gc-wrap">{incident.legal_hold.reason}</span>
                    {incident.legal_hold.review_at ? (
                      <span className="muted small"> · {t('Review by {date}', { date: fmt.date(incident.legal_hold.review_at, tz) })}</span>
                    ) : null}
                  </span>
                ) : (
                  t('None')
                ),
              },
              {
                label: t('Cases'),
                value:
                  incident.cases.length === 0 ? (
                    t('Not linked to a case')
                  ) : (
                    <span className="gc-inline">
                      {incident.cases.map((c) =>
                        can('case.read') ? (
                          <Link key={c.id} to={screenPath('web-26', { id: c.id })}>
                            {c.ref}
                          </Link>
                        ) : (
                          <span key={c.id}>{c.ref}</span>
                        ),
                      )}
                    </span>
                  ),
              },
            ]}
          />
          {actions}
          <p className="muted small">
            {ownedByOther && !resolved
              ? t('{name} is handling this alert. You can follow it here; only the assignee records the outcome.', {
                  name: incident.assignee!.display_name,
                })
              : incident.status === 'new' && respond
                ? t('Acknowledge to take ownership before recording an outcome.')
                : null}
          </p>
          {canHold ? (
            <div className="action-row">
              {incident.legal_hold ? (
                <Button variant="secondary" size="sm" onClick={() => setDialog('release')}>
                  {t('Release legal hold')}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setDialog('hold')}>
                  {t('Place legal hold')}
                </Button>
              )}
            </div>
          ) : null}
          <p className="muted small">
            {t('Version {n}', { n: incident.version })}
            {incident.model_version ? ` · ${t('Model')} ${incident.model_version}` : ''}
            {' · '}
            <Link to={screenPath('web-20', { id: incident.id })}>{t('Open alert view')}</Link>
            {incident.channel === 'checkout_exception' ? (
              <>
                {' · '}
                <Link to={screenPath('web-39', { id: incident.id })}>{t('Open transaction reconciliation')}</Link>
              </>
            ) : null}
          </p>
        </Card>

        {incident.channel === 'watchlist_candidate' ? (
          <Card title={t('Watchlist association')}>
            <Notice tone="warning">
              {t('A watchlist match is a candidate, not proof of wrongdoing. Accept only after comparing the footage with the approved reference photos yourself.')}
            </Notice>
            <p>
              {t('Current decision')}:{' '}
              <strong>
                {incident.association_decision === 'accepted'
                  ? t('Accepted by a reviewer')
                  : incident.association_decision === 'rejected'
                    ? t('Rejected by a reviewer')
                    : t('Not reviewed')}
              </strong>
            </p>
            {respond ? (
              <div className="action-row">
                {incident.association_decision !== 'accepted' ? (
                  <Button variant="secondary" onClick={() => setDialog('accept')}>
                    {t('Accept association')}
                  </Button>
                ) : null}
                {incident.association_decision !== 'rejected' ? (
                  <Button variant="secondary" onClick={() => setDialog('reject')}>
                    {t('Reject association')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Card>
        ) : null}

        <RelatedVisits incidentId={incident.id} timeZone={tz} />
      </div>

      <ConfirmDialog
        open={dialog === 'review'}
        onClose={close}
        title={t('Request review')}
        description={t('Ask an investigator or store manager to review {ref}. Your reason is recorded in the audit log.', { ref: incident.ref })}
        confirmLabel={t('Request review')}
        pending={requestReview.pending}
        error={requestReview.error && requestReview.error.status !== 409 ? t(errorMessageKey(requestReview.error)) : null}
        onConfirm={async (reason) => (await requestReview.run(reason)).ok}
      />
      <ConfirmDialog
        open={dialog === 'reopen'}
        onClose={close}
        title={t('Reopen incident')}
        description={t('The recorded outcome is cleared and you become the assignee. The previous outcome stays in the review history.')}
        confirmLabel={t('Reopen')}
        pending={reopen.pending}
        error={reopen.error && reopen.error.status !== 409 ? t(errorMessageKey(reopen.error)) : null}
        onConfirm={async (reason) => (await reopen.run(reason)).ok}
      />
      <ConfirmDialog
        open={dialog === 'accept' || dialog === 'reject'}
        onClose={close}
        title={dialog === 'accept' ? t('Accept association') : t('Reject association')}
        description={t('Your decision and reason are recorded in the review history. Rejected links are preserved.')}
        confirmLabel={dialog === 'accept' ? t('Accept association') : t('Reject association')}
        pending={association.pending}
        error={association.error && association.error.status !== 409 ? t(errorMessageKey(association.error)) : null}
        onConfirm={async (reason) => (await association.run({ decision: dialog === 'accept' ? 'accepted' : 'rejected', reason })).ok}
      />
      <ConfirmDialog
        open={dialog === 'release'}
        onClose={close}
        title={t('Release legal hold')}
        description={t('After release, the evidence follows the normal retention period again.')}
        confirmLabel={t('Release legal hold')}
        confirmVariant="danger"
        pending={release.pending}
        error={release.error && release.error.status !== 409 ? t(errorMessageKey(release.error)) : null}
        onConfirm={async (reason) => (await release.run(reason)).ok}
      />
      <Modal open={dialog === 'escalate'} onClose={close} title={t('Escalate')} size="sm">
        <EscalateIncidentForm
          incident={incident}
          onUpdated={(i) => {
            onUpdated(i);
            close();
          }}
          onConflict={(e) => (onConflict(e) ? (close(), true) : false)}
          onCancel={close}
        />
      </Modal>
      <CreateCaseDialog
        open={dialog === 'case'}
        onClose={close}
        incident={incident}
        onCreated={(caseId) => navigate(screenPath('web-26', { id: caseId }))}
      />
      <LegalHoldDialog open={dialog === 'hold'} onClose={close} incidentId={incident.id} onPlaced={reload} />
    </div>
  );
}

function RelatedVisits({ incidentId, timeZone }: { incidentId: string; timeZone: string }) {
  const { t, fmt } = useI18n();
  const v = useApiQuery((signal) => gc.visit(incidentId, { signal }), [incidentId]);
  return (
    <Card title={t('Related visits')}>
      {v.loading ? (
        <LoadingState variant="inline" />
      ) : v.error && !v.data ? (
        <ErrorState error={v.error} onRetry={v.reload} compact />
      ) : v.data ? (
        <>
          {!v.data.available ? (
            <UnavailableNotice code={v.data.reason ?? undefined} title={t('Re-identification unavailable')}>
              {t('No validated person re-identification model is installed, so visits are not reconstructed. Events below are listed by time only and are not linked to the same person.')}
            </UnavailableNotice>
          ) : null}
          <h3 className="gc-subhead">{t('Events within 30 minutes (time only)')}</h3>
          {v.data.nearby_events.length === 0 ? (
            <p className="muted small">{t('No other camera events were recorded in this store within 30 minutes.')}</p>
          ) : (
            <ul className="gc-list">
              {v.data.nearby_events.map((e) => (
                <li key={e.id}>
                  <div className="gc-list-main">
                    <span className="gc-list-title">
                      {fmt.time(e.captured_at, timeZone, { seconds: true })} · {e.camera_name ?? t('No camera')}
                      {e.id === incidentId ? ` · ${t('This incident')}` : ''}
                    </span>
                    <span className="muted small">
                      {t(CHANNEL_LABEL[e.channel])}
                      {e.location ? ` · ${e.location}` : ''}
                    </span>
                  </div>
                  {e.id !== incidentId ? (
                    <Link className="small" to={screenPath('web-24', { id: e.id })}>
                      {t('Open')}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="small">
            <Link to={screenPath('web-37', { id: incidentId })}>{t('Open visit reconstruction')}</Link>
          </p>
        </>
      ) : null}
    </Card>
  );
}

function CreateCaseDialog({
  open,
  onClose,
  incident,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  incident: IncidentDetail;
  onCreated: (caseId: string) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle(`${incident.ref} · ${incident.store_name}`);
      setTouched(false);
    }
  }, [open, incident.ref, incident.store_name]);
  const m = useMutation(() => gc.createCase({ title: title.trim(), store_id: incident.store_id, incident_ids: [incident.id] }), {
    successMessage: t('Case created'),
    onSuccess: (c) => onCreated(c.id),
    onError: (e) => e.status === 422,
  });
  const invalid = title.trim().length === 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!invalid) await m.run(undefined);
  };
  return (
    <Modal open={open} onClose={onClose} title={t('Create case')} description={t('The case links this incident. Original evidence is preserved; links are recorded separately.')} size="sm" dismissible={!m.pending}>
      <form onSubmit={submit} noValidate>
        <TextField
          label={t('Case title')}
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={touched && invalid ? t('Enter a case title.') : fieldError(t, m.fieldErrors.title ?? m.fieldErrors.store_id)}
        />
        {m.error && m.error.status !== 422 ? (
          <div className="field-error" role="alert">
            {t(errorMessageKey(m.error))}
          </div>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={m.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={m.pending}>
            {t('Create case')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LegalHoldDialog({ open, onClose, incidentId, onPlaced }: { open: boolean; onClose: () => void; incidentId: string; onPlaced: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setDays('');
      setTouched(false);
    }
  }, [open]);
  const m = useMutation(
    () => gc.placeHold(incidentId, { reason: reason.trim(), ...(days ? { review_days: Number(days) } : {}) }),
    {
      successMessage: t('Legal hold placed'),
      onSuccess: () => {
        onPlaced();
        onClose();
      },
      onError: (e) => e.status === 422,
    },
  );
  const reasonInvalid = reason.trim().length < 3;
  const daysInvalid = days !== '' && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!reasonInvalid && !daysInvalid) await m.run(undefined);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Place legal hold')}
      description={t('A legal hold keeps this incident’s evidence beyond the retention period. It needs a reason and a review date; it is not indefinite.')}
      size="sm"
      dismissible={!m.pending}
    >
      <form onSubmit={submit} noValidate>
        <TextAreaField
          label={t('Reason')}
          required
          rows={3}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={t('Recorded in the audit log with your name.')}
          error={touched && reasonInvalid ? t('Enter a reason of at least {n} characters.', { n: 3 }) : fieldError(t, m.fieldErrors.reason)}
        />
        <TextField
          label={t('Review in (days)')}
          type="number"
          min={1}
          max={365}
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          hint={t('Leave blank to use the organization’s default review period.')}
          error={touched && daysInvalid ? t('Enter a whole number from {min} to {max}.', { min: 1, max: 365 }) : fieldError(t, m.fieldErrors.review_days)}
        />
        {m.error && m.error.status !== 422 ? (
          <div className="field-error" role="alert">
            {t(errorMessageKey(m.error))}
          </div>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={m.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={m.pending}>
            {t('Place legal hold')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
