// web-39 Transaction reconciliation (?id=<checkout incident>).
//   GET /v1/incidents/{id}             lane video evidence + status
//   GET /v1/incidents/{id}/pos-events  POS events ±5 min around the capture time, integrations with
//                                      lane map and configured clock offset; available=false with
//                                      reason pos_unconfigured / pos_telemetry_missing.
// Missing telemetry is "unavailable", never "nothing was scanned". The screen only supports review;
// a person records the outcome (web-21).
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { useApiQuery } from '../api/hooks';
import { EvidenceStatePill, IncidentStatusPill, OutcomePill } from '../components/domain';
import { EvidencePlayer } from '../components/groupc/EvidencePanel';
import { POS_KIND_KEY } from '../components/groupc/labels';
import { useStoreTimeZone } from '../components/groupc/misc';
import { PageHeader } from '../components/PageHeader';
import { ButtonLink, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState, ErrorState, LoadingState, UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import { gc, type IncidentDetail, type PosEvent, type PosEventsResponse } from './_groupc-api';
import '../styles/group-c.css';

export default function CheckoutDetailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  const q = useApiQuery((signal) => gc.incident(id!, { signal }), [id], { enabled: Boolean(id) });
  if (!id) {
    return (
      <>
        <PageHeader screenId="web-39" />
        <EmptyState
          icon="cases"
          title={t('No checkout exception selected')}
          description={t('Open an exception from the checkout exceptions list.')}
          action={<ButtonLink to={screenPath('web-38')}>{t('Open checkout exceptions')}</ButtonLink>}
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        screenId="web-39"
        subtitle={q.data ? `${q.data.ref} · ${q.data.store_name} · ${t('Review evidence. Respond with confidence.')}` : undefined}
      />
      <RouteStateBoundary query={q} permission="incident.read">
        {(incident) => <Reconciliation incident={incident} />}
      </RouteStateBoundary>
    </>
  );
}

function formatOffset(ms: number | null | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (ms === null || ms === undefined) return t('Not configured');
  const s = ms / 1000;
  return `${s > 0 ? '+' : ''}${s.toFixed(3)} s`;
}

function Reconciliation({ incident }: { incident: IncidentDetail }) {
  const { t, fmt } = useI18n();
  const { me } = useSession();
  const tz = useStoreTimeZone()(incident.store_id, incident.store_timezone);
  const pos = useApiQuery((signal) => gc.posEvents(incident.id, { signal }), [incident.id]);
  const mine = incident.assignee?.id === me?.user.id;
  const captured = fmt.dateTime(incident.captured_at, tz, { withZone: true });
  return (
    <div className="grid detail-grid">
      <div className="gc-stack">
        <Card title={t('Video timeline')}>
          <EvidencePlayer state={incident.evidence_state} evidence={incident.evidence} cameraName={incident.camera_name} capturedLabel={captured} />
          <Notice tone="warning">{t('AI signals require review. Check the footage and observed facts before recording an outcome.')}</Notice>
          <p className="small">
            {t('Visual interaction captured at {time}.', { time: captured })}
          </p>
        </Card>
        <Card title={t('POS event')}>
          <PosEvents pos={pos} incident={incident} timeZone={tz} />
        </Card>
      </div>
      <Card title={t('Transaction')}>
        <KeyValueList
          items={[
            { label: t('Incident'), value: incident.ref },
            { label: t('Camera'), value: incident.camera_name ?? t('No camera') },
            { label: t('Captured'), value: captured },
            { label: t('Status'), value: <IncidentStatusPill status={incident.status} /> },
            { label: t('Outcome'), value: <OutcomePill outcome={incident.outcome} /> },
            { label: t('Evidence'), value: <EvidenceStatePill state={incident.evidence_state} /> },
            ...(pos.data?.integrations ?? []).map((i) => ({
              label: `${t('Clock offset')} · ${i.name}`,
              value: formatOffset(i.clock_offset_ms, t),
            })),
          ]}
        />
        <Notice tone="info">
          {t('“Not observed” is not “not paid”. A missing scan in this window can come from clock drift, an unmapped lane or a connector outage. Review the footage before recording an outcome.')}
        </Notice>
        <div className="action-row">
          {mine && (incident.status === 'acknowledged' || incident.status === 'reviewing') ? (
            <ButtonLink variant="primary" to={screenPath('web-21', { id: incident.id })}>
              {t('Record outcome')}
            </ButtonLink>
          ) : null}
          <ButtonLink to={screenPath('web-20', { id: incident.id })}>{t('Open alert view')}</ButtonLink>
        </div>
        <p className="small">
          <Link to={screenPath('web-24', { id: incident.id })}>{t('Open incident workspace')}</Link>
        </p>
      </Card>
    </div>
  );
}

function PosEvents({
  pos,
  incident,
  timeZone,
}: {
  pos: { data: PosEventsResponse | undefined; error: ApiError | undefined; loading: boolean; reload: () => void };
  incident: IncidentDetail;
  timeZone: string;
}) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  if (pos.loading) return <LoadingState variant="inline" />;
  if (pos.error && !pos.data) return <ErrorState error={pos.error} onRetry={pos.reload} compact />;
  const data = pos.data;
  if (!data) return null;
  const capturedMs = new Date(incident.captured_at).getTime();
  const delta = (e: PosEvent) => {
    const s = (new Date(e.occurred_at).getTime() - capturedMs) / 1000;
    return `${s > 0 ? '+' : ''}${s.toFixed(1)} s`;
  };
  return (
    <>
      {data.reason === 'pos_unconfigured' ? (
        <UnavailableNotice code="pos_unconfigured" title={t('No POS connector for this store')} action={can('integration.manage') ? <ButtonLink size="sm" to={screenPath('web-40')}>{t('Set up POS integration')}</ButtonLink> : undefined}>
          {t('Without POS telemetry this exception cannot be reconciled with scans or payments. It stays a visual candidate for review.')}
        </UnavailableNotice>
      ) : data.reason === 'pos_telemetry_missing' ? (
        <UnavailableNotice code="pos_telemetry_missing" title={t('POS telemetry is missing for this time')}>
          {t('The POS connector sent no events in the 10 minutes before this capture. Events below may be incomplete; absence of a scan is not evidence of non-payment.')}
        </UnavailableNotice>
      ) : null}
      {data.events.length === 0 ? (
        data.reason === 'pos_unconfigured' ? null : <p className="muted small">{t('No POS events were received within 5 minutes of the capture time.')}</p>
      ) : (
        <div className="dt-scroll">
          <table className="dt gc-table-compact">
            <caption className="visually-hidden">{t('POS events within 5 minutes of the capture time')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Scan timestamp')}</th>
                <th scope="col">{t('Δ to video')}</th>
                <th scope="col">{t('POS event')}</th>
                <th scope="col">{t('Lane')}</th>
                <th scope="col">{t('Transaction')}</th>
                <th scope="col">{t('Barcode')}</th>
                <th scope="col" className="align-end">
                  {t('Item count')}
                </th>
                <th scope="col" className="align-end">
                  {t('Amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e, i) => (
                <tr key={`${e.occurred_at}-${i}`}>
                  <td className="small">
                    {fmt.time(e.occurred_at, timeZone, { seconds: true })}.{String(new Date(e.occurred_at).getUTCMilliseconds()).padStart(3, '0')}
                  </td>
                  <td className="small mono">{delta(e)}</td>
                  <td>{POS_KIND_KEY[e.kind] ? t(POS_KIND_KEY[e.kind]!) : e.kind}</td>
                  <td>{e.lane ?? '—'}</td>
                  <td className="mono small">{e.transaction_id ?? '—'}</td>
                  <td className="mono small">{e.barcode ?? '—'}</td>
                  <td className="align-end">{e.item_count ?? '—'}</td>
                  <td className="align-end">{e.amount === null ? '—' : fmt.currency(e.amount, incident.currency ?? 'JPY')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {t('POS times are shown as the connector reported them, in store time. Use the configured clock offset when comparing with the video.')}
      </p>
    </>
  );
}
