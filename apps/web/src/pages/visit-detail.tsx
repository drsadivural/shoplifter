// web-37 Visit reconstruction (?id=<incident>). GET /v1/incidents/{id} + GET /v1/incidents/{id}/visit.
// Visit reconstruction (entry → camera transitions → exit) needs a validated person
// re-identification model; none is installed, so the API returns available=false/reid_unavailable.
// This screen states that prominently and lists other events from the same store within ±30 min by
// time only. It never draws a path or implies that the events show the same person.
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { useApiQuery } from '../api/hooks';
import { CHANNEL_LABEL, ChannelLabel, EvidenceStatePill, IncidentStatusPill } from '../components/domain';
import { useStoreTimeZone } from '../components/groupc/misc';
import { PageHeader } from '../components/PageHeader';
import { ButtonLink, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState, ErrorState, LoadingState, UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { gc, type IncidentDetail, type VisitResponse } from './_groupc-api';
import '../styles/group-c.css';

export default function VisitDetailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  const incident = useApiQuery((signal) => gc.incident(id!, { signal }), [id], { enabled: Boolean(id) });
  const visit = useApiQuery((signal) => gc.visit(id!, { signal }), [id], { enabled: Boolean(id) });

  if (!id) {
    return (
      <>
        <PageHeader screenId="web-37" />
        <EmptyState
          icon="search"
          title={t('No incident selected')}
          description={t('Open visit reconstruction from an incident or a search result.')}
          action={<ButtonLink to={screenPath('web-35')}>{t('Open historical search')}</ButtonLink>}
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        screenId="web-37"
        subtitle={incident.data ? `${incident.data.ref} · ${incident.data.store_name} · ${t('Review evidence. Respond with confidence.')}` : undefined}
      />
      <RouteStateBoundary query={incident} permission="incident.read">
        {(inc) => <VisitReady incident={inc} visit={visit} />}
      </RouteStateBoundary>
    </>
  );
}

function VisitReady({
  incident,
  visit,
}: {
  incident: IncidentDetail;
  visit: { data: VisitResponse | undefined; error: ApiError | undefined; loading: boolean; reload: () => void };
}) {
  const { t, fmt } = useI18n();
  const tz = useStoreTimeZone()(incident.store_id, incident.store_timezone);
  const notAvailable = <span className="muted">{t('Not available — re-identification is not installed')}</span>;
  return (
    <>
      {visit.data?.available ? (
        <Notice tone="info">{t('The server reports reconstruction data, but this console version cannot display it. Nothing is inferred here.')}</Notice>
      ) : (
        <UnavailableNotice code={visit.data?.reason ?? 'reid_unavailable'} title={t('Re-identification unavailable')}>
          {t('Reconstructing a visit across cameras needs a validated person re-identification model. None is installed, so RetailGuard does not link events to the same person or draw a path through the store.')}
        </UnavailableNotice>
      )}
      <div className="grid detail-grid gc-section">
        <div className="gc-stack">
          <Card title={t('Visit reconstruction')}>
            <KeyValueList
              items={[
                { label: t('Entry'), value: notAvailable },
                { label: t('Camera transitions'), value: notAvailable },
                { label: t('Candidate associations'), value: notAvailable },
                { label: t('Exit'), value: notAvailable },
                {
                  label: t('Review uncertainty'),
                  value: t('Not assessed. Any future association will be a candidate with stated uncertainty that a reviewer accepts or rejects.'),
                },
              ]}
            />
          </Card>
          <Card title={t('Events near this time')}>
            <Notice tone="warning">{t('Listed by time only. These events are not linked to the same person and must not be read as one visit.')}</Notice>
            {visit.loading ? (
              <LoadingState variant="inline" />
            ) : visit.error && !visit.data ? (
              <ErrorState error={visit.error} onRetry={visit.reload} compact />
            ) : visit.data && visit.data.nearby_events.length > 0 ? (
              <ol className="timeline-list">
                {visit.data.nearby_events.map((e) => (
                  <li key={e.id}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <time dateTime={e.captured_at}>{fmt.time(e.captured_at, tz, { seconds: true })}</time> · {e.camera_name ?? t('No camera')}
                    {e.location ? <span className="muted"> · {e.location}</span> : null}
                    <span className="muted"> · {t(CHANNEL_LABEL[e.channel])}</span>
                    {e.id === incident.id ? (
                      <strong> · {t('This incident')}</strong>
                    ) : (
                      <Link className="small" to={screenPath('web-24', { id: e.id })}>
                        {t('Open')}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">{t('No camera events were recorded in this store within 30 minutes of this incident.')}</p>
            )}
          </Card>
        </div>
        <Card title={t('Incident')}>
          <KeyValueList
            items={[
              { label: t('Incident'), value: incident.ref },
              { label: t('Type'), value: <ChannelLabel channel={incident.channel} /> },
              { label: t('Camera'), value: incident.camera_name ?? t('No camera') },
              { label: t('Captured'), value: fmt.dateTime(incident.captured_at, tz, { withZone: true }) },
              { label: t('Status'), value: <IncidentStatusPill status={incident.status} /> },
              { label: t('Evidence'), value: <EvidenceStatePill state={incident.evidence_state} /> },
            ]}
          />
          <p className="small">
            <Link to={screenPath('web-24', { id: incident.id })}>{t('Open incident workspace')}</Link>
          </p>
          <p className="muted small">{t('Window: 30 minutes before and after the capture time, same store, cameras only.')}</p>
        </Card>
      </div>
    </>
  );
}
