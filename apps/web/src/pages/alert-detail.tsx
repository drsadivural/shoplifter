// web-20 Review an alert. GET /v1/incidents/{id} (id from ?id=).
//   Acknowledge    -> POST /v1/incidents/{id}/claim {expected_version}
//   Request review -> POST /v1/incidents/{id}/request-review {expected_version, reason}
// 409 -> ConflictBanner + refetch; never retried with the new version automatically.
// Signals are raw candidate evidence (not probabilities); outcomes are recorded by people only.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import type { Incident } from '../api/types';
import { ChannelLabel, EvidenceStatePill, IncidentStatusPill, OutcomePill, PriorityPill } from '../components/domain';
import { AuthenticatedImage, AuthenticatedVideo } from '../components/media';
import { ConfirmDialog } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState } from '../components/states';
import { hasTranslation, useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

export default function AlertDetailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  // Poll while evidence is still uploading so the clip appears without a manual refresh.
  const [evidencePending, setEvidencePending] = useState(false);
  const q = useApiQuery((signal) => endpoints.incidents.get(id!, { signal }), [id], {
    enabled: Boolean(id),
    pollMs: evidencePending ? 15_000 : undefined,
  });
  useEffect(() => setEvidencePending(q.data?.evidence_state === 'pending'), [q.data?.evidence_state]);
  const [conflict, setConflict] = useState<{ currentVersion: number | null } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { can } = useSession();
  const incident = q.data;
  const canRespond = can('incident.respond') && incident !== undefined && incident.status !== 'resolved';

  const onConflict = (e: ApiError) => {
    if (e.status !== 409) return false;
    setConflict({ currentVersion: e.currentVersion });
    q.reload();
    return true;
  };

  const requestReview = useMutation(
    (reason: string) => endpoints.incidents.requestReview(incident!.id, { expected_version: incident!.version, reason }),
    {
      successMessage: t('Review requested'),
      onSuccess: (updated) => q.setData(updated),
      onError: (e) => {
        if (onConflict(e)) {
          setReviewOpen(false);
          return true;
        }
        return false;
      },
    },
  );

  if (!id) {
    return (
      <>
        <PageHeader screenId="web-20" />
        <EmptyState
          icon="alerts"
          title={t('No alert selected')}
          description={t('Open an alert from the alert inbox.')}
          action={<ButtonLink to="/web/alerts">{t('Open alert inbox')}</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        screenId="web-20"
        subtitle={incident ? `${incident.ref} · ${incident.store_name} · ${t('Review evidence. Respond with confidence.')}` : undefined}
        action={
          canRespond && incident.status !== 'reviewing' ? (
            <Button variant="secondary" onClick={() => setReviewOpen(true)}>
              {t('Request review')}
            </Button>
          ) : undefined
        }
      />
      {conflict ? (
        <ConflictBanner
          currentVersion={incident?.version ?? conflict.currentVersion}
          reloading={q.fetching}
          onReload={() => {
            q.reload();
            setConflict(null);
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="incident.read">
        {(data) => <AlertReady incident={data} onUpdated={(i) => q.setData(i)} onConflict={onConflict} onRequestReview={() => setReviewOpen(true)} />}
      </RouteStateBoundary>
      {incident ? (
        <ConfirmDialog
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          title={t('Request review')}
          description={t('Ask an investigator or store manager to review {ref}. Your reason is recorded in the audit log.', { ref: incident.ref })}
          confirmLabel={t('Request review')}
          pending={requestReview.pending}
          error={requestReview.error && requestReview.error.status !== 409 ? t(errorMessageKey(requestReview.error)) : null}
          onConfirm={async (reason) => (await requestReview.run(reason)).ok}
        />
      ) : null}
    </>
  );
}

function AlertReady({
  incident,
  onUpdated,
  onConflict,
  onRequestReview,
}: {
  incident: Incident;
  onUpdated: (i: Incident) => void;
  onConflict: (e: ApiError) => boolean;
  onRequestReview: () => void;
}) {
  const { t, fmt } = useI18n();
  const { me, can, stores, timeZone } = useSession();
  const tz = incident.store_timezone ?? stores.find((s) => s.id === incident.store_id)?.timezone ?? timeZone;
  const claim = useMutation(() => endpoints.incidents.claim(incident.id, { expected_version: incident.version }), {
    successMessage: t('Alert acknowledged'),
    onSuccess: onUpdated,
    onError: (e) => onConflict(e),
  });

  const mine = incident.assignee?.id === me?.user.id;
  const ownedByOther = incident.assignee !== null && !mine;
  const respond = can('incident.respond') && incident.status !== 'resolved';

  return (
    <div className="grid detail-grid">
      <Card title={t('Evidence clip')} titleAddon={<Badge tone="warning">{t('Review required')}</Badge>}>
        <EvidenceView incident={incident} timeZone={tz} />
        <Notice tone="warning">{t('AI signals require review. Check the footage and observed facts before recording an outcome.')}</Notice>
        <h3>{t('Camera timeline')}</h3>
        {incident.timeline.length === 0 ? (
          <p className="muted">{t('No timeline events recorded.')}</p>
        ) : (
          <ol className="timeline-list">
            {incident.timeline.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="timeline-dot" aria-hidden="true" />
                <time dateTime={e.at}>{fmt.time(e.at, tz, { seconds: true })}</time> · {actionLabel(t, e.action)}
                {e.actor ? <span className="muted"> · {e.actor}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title={t('Trigger signals')}>
        <KeyValueList
          items={[
            { label: t('Incident'), value: incident.ref },
            { label: t('Type'), value: <ChannelLabel channel={incident.channel} /> },
            { label: t('Camera'), value: incident.camera_name ?? t('No camera') },
            { label: t('Captured'), value: fmt.dateTime(incident.captured_at, tz, { withZone: true }) },
            { label: t('Status'), value: <IncidentStatusPill status={incident.status} /> },
            { label: t('Outcome'), value: <OutcomePill outcome={incident.outcome} /> },
            { label: t('Priority'), value: <PriorityPill priority={incident.priority} /> },
            { label: t('Evidence'), value: <EvidenceStatePill state={incident.evidence_state} /> },
            ...(incident.ack_deadline
              ? [{ label: t('Acknowledgement deadline'), value: fmt.dateTime(incident.ack_deadline, tz, { withZone: true }) }]
              : []),
          ]}
        />
        <SignalList incident={incident} />
        <div className="assignee-row">
          <span>{t('Assignee')}</span>
          <strong>{incident.assignee ? incident.assignee.display_name : t('Unassigned')}</strong>
        </div>
        {respond ? (
          <div className="action-row">
            {incident.status === 'new' && !ownedByOther ? (
              <Button onClick={() => void claim.run(undefined)} pending={claim.pending}>
                {t('Acknowledge')}
              </Button>
            ) : null}
            {incident.status !== 'reviewing' ? (
              <Button variant="secondary" onClick={onRequestReview}>
                {t('Request review')}
              </Button>
            ) : null}
            {mine ? (
              <ButtonLink to={screenPath('web-21', { id: incident.id })} variant="secondary">
                {t('Record outcome')}
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
        <p className="muted small">
          {ownedByOther && incident.status !== 'resolved'
            ? t('{name} is handling this alert. You can follow it here; only the assignee records the outcome.', {
                name: incident.assignee!.display_name,
              })
            : incident.status === 'new' && respond
              ? t('Acknowledge to take ownership before recording an outcome.')
              : incident.status === 'resolved'
                ? t('This alert is resolved. Reopening is done from the incident workspace.')
                : null}
        </p>
        <p className="muted small">
          {t('Version {n}', { n: incident.version })}
          {incident.model_version ? ` · ${t('Model')} ${incident.model_version}` : ''}
          {' · '}
          <Link to={screenPath('web-24', { id: incident.id })}>{t('Open incident workspace')}</Link>
        </p>
      </Card>
    </div>
  );
}

function EvidenceView({ incident, timeZone }: { incident: Incident; timeZone: string }) {
  const { t, fmt } = useI18n();
  const clip = incident.evidence.find((e) => e.kind === 'clip');
  const frame = incident.evidence.find((e) => e.kind === 'frame');
  const label = `${incident.camera_name ?? t('No camera')} · ${fmt.dateTime(incident.captured_at, timeZone, { withZone: true })}`;
  if (incident.evidence_state === 'available' && (clip || frame)) {
    return (
      <div className="feed feed-video">
        {clip ? (
          <AuthenticatedVideo mediaId={clip.media_id} label={t('Evidence clip')} />
        ) : (
          <AuthenticatedImage mediaId={frame!.media_id} alt={t('Evidence frame')} />
        )}
        <span className="feed-label">{incident.camera_name ?? t('No camera')}</span>
        <span className="feed-time">{label}</span>
      </div>
    );
  }
  const text: Record<string, [string, string]> = {
    pending: ['Evidence is still uploading', 'The store edge has reported this alert but the clip has not arrived yet. It appears here automatically after upload; refresh to check.'],
    unavailable: ['No evidence clip for this alert', 'The store edge could not capture or upload a clip for this alert. Review the camera timeline and other records before deciding.'],
    expired: ['Evidence has expired', 'The clip passed the evidence retention period and was deleted. The alert record and audit history remain.'],
    available: ['Evidence record is empty', 'The alert is marked as having evidence, but no media is attached. Contact support with the incident reference.'],
  };
  const [title, body] = text[incident.evidence_state] ?? text.unavailable!;
  return (
    <div className="feed feed-empty" role="status">
      <div>
        <EvidenceStatePill state={incident.evidence_state} />
        <p className="feed-empty-title">{t(title)}</p>
        <p className="muted small">{t(body)}</p>
      </div>
    </div>
  );
}

function humanize(key: string): string {
  const s = key.replace(/[_.]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatSignalValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function SignalList({ incident }: { incident: Incident }) {
  const { t, locale } = useI18n();
  const entries = Object.entries(incident.signals ?? {});
  return (
    <div className="signals">
      {entries.length === 0 ? (
        <p className="muted">{t('No trigger signals were reported for this alert.')}</p>
      ) : (
        entries.map(([k, v]) => (
          <div className="signal" key={k}>
            <b>{hasTranslation(locale, `signal|${k}`) || hasTranslation('en', `signal|${k}`) ? t(`signal|${k}`) : humanize(k)}</b>
            <div className="signal-value mono">
              {t('Raw value')}: {formatSignalValue(v)}
            </div>
            <div className="help">{t('Candidate evidence · human review required')}</div>
          </div>
        ))
      )}
      {incident.gate_reason ? (
        <div className="signal">
          <b>{t('Gate reason')}</b>
          <div className="signal-value">{incident.gate_reason}</div>
        </div>
      ) : null}
      {incident.uncertainty.length > 0 ? (
        <div className="signal">
          <b>{t('Observed uncertainty')}</b>
          <ul className="plain-list">
            {incident.uncertainty.map((u) => (
              <li key={u}>{hasTranslation(locale, `uncertainty|${u}`) ? t(`uncertainty|${u}`) : humanize(u)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function actionLabel(t: (k: string) => string, action: string): string {
  const key = `timeline|${action}`;
  const s = t(key);
  return s === action ? humanize(action) : s;
}
