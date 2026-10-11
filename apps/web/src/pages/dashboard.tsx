// web-09 Loss prevention overview. GET /v1/dashboard?store_id= (+ GET /v1/cameras for the
// latest verified snapshot). Null metrics render as "—" + "Unavailable", never as 0.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery } from '../api/hooks';
import type { Camera, Dashboard, IncidentSummary } from '../api/types';
import { AnalysisStatePill, ReadinessPill } from '../components/domain';
import { IncidentRow } from '../components/IncidentRow';
import { AuthenticatedImage } from '../components/media';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, Notice, StatCard } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { TrendChart } from '../components/TrendChart';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

export default function DashboardPage() {
  const { t } = useI18n();
  const { store, timeZone } = useSession();
  const { fmt } = useI18n();
  const q = useApiQuery((signal) => endpoints.dashboard(store?.id, { signal }), [store?.id], {
    enabled: Boolean(store),
    pollMs: 60_000,
  });

  return (
    <>
      <PageHeader
        screenId="web-09"
        action={
          <div className="page-action-stack">
            <Button variant="secondary" icon="refresh" onClick={q.reload} pending={q.fetching && q.data !== undefined}>
              {t('Refresh')}
            </Button>
            {q.data ? (
              <span className="muted small">
                {t('Last refresh')}: {fmt.time(q.data.last_refresh, timeZone, { seconds: true, withZone: true })}
              </span>
            ) : null}
          </div>
        }
      />
      {!store ? (
        <EmptyState icon="info" title={t('No stores assigned')} description={t('Ask an administrator to assign you to a store.')} />
      ) : (
        <RouteStateBoundary query={q} permission="dashboard.read">
          {(data) => <DashboardReady data={data} />}
        </RouteStateBoundary>
      )}
    </>
  );
}

function DashboardReady({ data }: { data: Dashboard }) {
  const { t, fmt } = useI18n();
  const cams = data.cameras;
  return (
    <>
      <div className="stats">
        <StatCard
          label={t('Open alerts')}
          value={data.open_alerts === null ? null : fmt.number(data.open_alerts)}
          caption={t('Current · selected store')}
          unavailableReason={t('Alert counts could not be computed.')}
          to="/web/alerts"
        />
        <StatCard
          label={t('Reviewed incidents')}
          value={data.reviewed_today === null ? null : fmt.number(data.reviewed_today)}
          caption={t('Today · reviewed data')}
          unavailableReason={t('No review data for today yet.')}
          to="/web/incidents?status=resolved"
        />
        <StatCard
          label={t('Online cameras')}
          value={cams ? `${fmt.number(cams.online)}/${fmt.number(cams.total)}` : null}
          caption={t('Current · reported by store edge')}
          unavailableReason={t('Camera status is not reported by the store edge.')}
          to="/web/cameras"
        />
        <StatCard
          label={t('Median acknowledgement')}
          value={data.median_ack_seconds === null ? null : fmt.duration(data.median_ack_seconds)}
          caption={t('Today · reviewed data')}
          unavailableReason={t('No acknowledged alerts today.')}
        />
      </div>
      <div className="grid">
        <AwaitingReview items={data.awaiting_review} />
        <Card title={t('Alert and review trends')}>
          {data.trend.length === 0 ? (
            <EmptyState compact icon="reports" title={t('No trend data yet')} description={t('Trends appear after alerts are detected and reviewed.')} />
          ) : (
            <TrendChart
              title={t('Alert and review trends')}
              data={data.trend}
              series={[
                { key: 'detections', label: t('Detections'), className: 'series-a' },
                { key: 'reviewed', label: t('Reviewed incidents'), className: 'series-b' },
              ]}
            />
          )}
          <Notice tone="warning">{t('Impact is measured from reviewed incidents')}</Notice>
        </Card>
        <CameraHealth items={data.camera_health} />
        <LivePreview preview={data.preview} />
      </div>
    </>
  );
}

function AwaitingReview({ items }: { items: IncidentSummary[] }) {
  const { t } = useI18n();
  return (
    <Card
      title={t('Alerts awaiting review')}
      actions={
        <Link to="/web/alerts" className="link-sm">
          {t('Open alert inbox')}
        </Link>
      }
    >
      {items.length === 0 ? (
        <EmptyState compact title={t('No pending alerts')} description={t('New alerts appear here when the store edge reports candidate evidence.')} />
      ) : (
        <ul className="rows">
          {items.map((it) => (
            <IncidentRow key={it.id} incident={it} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CameraHealth({ items }: { items: Dashboard['camera_health'] }) {
  const { t, fmt } = useI18n();
  return (
    <Card
      title={t('Camera health')}
      actions={
        <Link to="/web/cameras" className="link-sm">
          {t('Camera inventory')}
        </Link>
      }
    >
      {items.length === 0 ? (
        <EmptyState compact icon="cameras" title={t('No cameras added yet')} description={t('Add cameras from the camera inventory. They stay pending until real frames are verified.')} />
      ) : (
        <ul className="rows">
          {items.map((c) => (
            <li className="row" key={c.id}>
              <div className="row-main">
                <Link to={screenPath('web-15', { id: c.id })} className="row-title-plain">
                  {c.name}
                </Link>
                <div className="help">
                  {t('Last frame')}: {c.last_frame_at ? fmt.relative(c.last_frame_at) : t('none received')}
                </div>
              </div>
              <ReadinessPill readiness={c.readiness} />
              <AnalysisStatePill state={c.analysis_state} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type PreviewFrame = { mediaId: string; label: string; capturedAt: string };

/**
 * Latest verified snapshot. Uses dashboard.preview when the API provides it; otherwise falls
 * back to GET /v1/cameras (camera.read) and picks the newest snapshot.
 */
function LivePreview({ preview }: { preview: Dashboard['preview'] }) {
  const { t, fmt } = useI18n();
  const { store, timeZone, can } = useSession();
  const useFallback = preview === undefined;
  const q = useApiQuery((signal) => endpoints.cameras.list({ store_id: store?.id, limit: 100 }, { signal }), [store?.id], {
    enabled: useFallback && Boolean(store) && can('camera.read'),
    pollMs: 60_000,
  });
  let frame: PreviewFrame | null | undefined;
  let body: ReactNode = null;
  if (!useFallback) {
    frame = preview ? { mediaId: preview.media_id, label: preview.camera_name, capturedAt: preview.captured_at } : null;
  } else if (!can('camera.read')) {
    body = <EmptyState compact icon="lock" title={t('Camera views are not available for your role')} />;
  } else if (q.error && !q.data) {
    body = <ErrorState compact error={q.error} onRetry={q.reload} />;
  } else if (!q.data) {
    body = <LoadingState variant="inline" />;
  } else {
    const cam = q.data.items
      .filter((c): c is Camera & { snapshot: NonNullable<Camera['snapshot']> } => c.snapshot !== null)
      .sort((a, b) => b.snapshot.captured_at.localeCompare(a.snapshot.captured_at))[0];
    frame = cam ? { mediaId: cam.snapshot.media_id, label: `${cam.location} · ${cam.name}`, capturedAt: cam.snapshot.captured_at } : null;
  }
  if (frame) {
    body = (
      <div className="feed">
        <AuthenticatedImage mediaId={frame.mediaId} alt={t('Latest verified frame from {camera}', { camera: frame.label })} />
        <span className="feed-label">{frame.label}</span>
        <span className="feed-time">{fmt.dateTime(frame.capturedAt, timeZone, { withZone: true })}</span>
      </div>
    );
  } else if (frame === null) {
    body = (
      <EmptyState
        compact
        icon="video"
        title={t('No verified camera frame yet')}
        description={t('A preview appears after the store edge verifies a real frame from an activated camera.')}
      />
    );
  }
  return (
    <Card
      title={t('Live preview')}
      actions={
        can('camera.read') ? (
          <Link to="/web/live" className="link-sm">
            {t('Open live cameras')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </Card>
  );
}
