// web-10 Live cameras.
//   ?camera=<id>  one camera, large live player (LivePlayer: on-demand HLS relayed by its edge).
//   ?edge=<id>    every camera of one edge appliance, live (GET /v1/edges/tree).
//   (default)     the selected store's wall: GET /v1/cameras?store_id= every 10 s; ready cameras play
//                 live (up to MAX_LIVE_TILES), others show the latest verified snapshot or why not.
// Video leaves the edge only while someone watches, a few seconds behind real time, with privacy
// masks burned in on the edge. No RTSP address or credential ever reaches the browser.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery } from '../api/hooks';
import type { Camera } from '../api/types';
import { AnalysisStatePill, ReadinessPill } from '../components/domain';
import { ageSeconds } from '../components/groupb/api';
import { FreshnessPill } from '../components/groupb/ui';
import { LivePlayer } from '../components/LivePlayer';
import { AuthenticatedImage } from '../components/media';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, FilterTabs, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState, LoadingState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

const REFRESH_MS = 10_000;
/** Live players on one wall; more would mostly cost bandwidth on the store uplink. */
const MAX_LIVE_TILES = 9;
type Filter = 'all' | 'analyzing' | 'attention';

export default function LivePage() {
  const [params] = useSearchParams();
  const cameraId = params.get('camera');
  const edgeId = params.get('edge');
  if (cameraId) return <SingleCamera key={cameraId} cameraId={cameraId} />;
  if (edgeId) return <EdgeWall key={edgeId} edgeId={edgeId} />;
  return <StoreWall />;
}

function SingleCamera({ cameraId }: { cameraId: string }) {
  const { t } = useI18n();
  const q = useApiQuery((signal) => endpoints.cameras.get(cameraId, { signal }), [cameraId]);
  return (
    <>
      <PageHeader screenId="web-10" subtitle={q.data ? (q.data.location ? `${q.data.location} · ${q.data.name}` : q.data.name) : undefined} />
      <RouteStateBoundary query={q} permission="camera.read" loading={<LoadingState variant="cards" rows={1} />}>
        {(c) => (
          <div className="live-single">
            <LivePlayer cameraId={c.id} name={c.name} large />
            <div className="gb-tile-foot">
              <Link to={screenPath('web-15', { id: c.id })}>{t('Camera readiness')}</Link>
              <span className="gb-inline">
                <ReadinessPill readiness={c.readiness} />
                <AnalysisStatePill state={c.analysis_state} />
              </span>
            </div>
            <p className="muted small">{t('live|Live video is relayed by the edge appliance only while someone is watching, a few seconds behind real time. Privacy masks are applied on the appliance.')}</p>
          </div>
        )}
      </RouteStateBoundary>
    </>
  );
}

function EdgeWall({ edgeId }: { edgeId: string }) {
  const { t } = useI18n();
  const q = useApiQuery((signal) => endpoints.edges.tree({ signal }), [], { pollMs: 30_000 });
  const edge = q.data?.items.find((e) => e.id === edgeId);
  return (
    <>
      <PageHeader screenId="web-10" subtitle={edge ? `${edge.name} · ${edge.store_name}` : undefined} />
      <RouteStateBoundary query={q} permission="camera.read" loading={<LoadingState variant="cards" rows={4} />}>
        {() =>
          !edge ? (
            <EmptyState icon="video" title={t('live|Edge appliance not found')} description={t('live|It may have been revoked or belong to a store you cannot access.')} />
          ) : edge.cameras.length === 0 ? (
            <EmptyState
              icon="video"
              title={t('No cameras yet')}
              description={t('live|Add cameras to this edge appliance from camera discovery.')}
              action={<ButtonLink to={`${screenPath('web-11')}?store_id=${encodeURIComponent(edge.store_id)}&edge_id=${encodeURIComponent(edge.id)}`}>{t('Add cameras')}</ButtonLink>}
            />
          ) : (
            <>
              {edge.state !== 'online' ? <Notice tone="warning">{t('live|The edge appliance serving this camera is offline.')}</Notice> : null}
              <ul className="gb-wall plain-list" aria-label={t('Camera wall')}>
                {edge.cameras.slice(0, MAX_LIVE_TILES).map((c) => (
                  <li key={c.id} className="card gb-wall-tile">
                    {c.readiness === 'ready' ? (
                      <LivePlayer cameraId={c.id} name={c.name} />
                    ) : (
                      <div className="feed feed-empty" role="status">
                        <p className="feed-empty-title">{t('No verified frame yet')}</p>
                      </div>
                    )}
                    <div className="gb-tile-foot">
                      <Link to={`/web/live?camera=${encodeURIComponent(c.id)}`}>{c.name}</Link>
                      <span className="gb-inline">
                        <ReadinessPill readiness={c.readiness} />
                        <AnalysisStatePill state={c.analysis_state} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {edge.cameras.length > MAX_LIVE_TILES ? (
                <p className="muted small">{t('live|Showing {n} cameras live. Open a camera from the side menu to watch the others.', { n: MAX_LIVE_TILES })}</p>
              ) : null}
            </>
          )
        }
      </RouteStateBoundary>
    </>
  );
}

function StoreWall() {
  const { t, fmt } = useI18n();
  const { store, timeZone, can } = useSession();
  const [filter, setFilter] = useState<Filter>('all');
  const q = useApiQuery((signal) => endpoints.cameras.list({ store_id: store?.id, limit: 100 }, { signal }), [store?.id], {
    enabled: Boolean(store),
    pollMs: REFRESH_MS,
  });
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  useEffect(() => {
    if (q.data) setCheckedAt(Date.now());
  }, [q.data]);

  return (
    <>
      <PageHeader
        screenId="web-10"
        action={
          <div className="page-action-stack">
            <Button variant="secondary" icon="refresh" onClick={q.reload} pending={q.fetching && q.data !== undefined}>
              {t('Refresh')}
            </Button>
            {checkedAt ? (
              <span className="muted small">
                {t('Last refresh')}: {fmt.time(new Date(checkedAt).toISOString(), timeZone, { seconds: true, withZone: true })}
              </span>
            ) : null}
          </div>
        }
      />
      <Notice tone="info" title={t('live|Live video from the store edge')}>
        {t('live|Ready cameras play live video relayed by their edge appliance, a few seconds behind real time, with privacy masks applied on the appliance. Video is sent only while someone is watching. Other cameras show their latest verified snapshot.')}
      </Notice>
      {!store ? (
        <EmptyState icon="info" title={t('No stores assigned')} description={t('Ask an administrator to assign you to a store.')} />
      ) : (
        <RouteStateBoundary
          query={q}
          permission="camera.read"
          loading={<LoadingState variant="cards" rows={4} />}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <EmptyState
              icon="video"
              title={t('No cameras added yet')}
              description={t('Add cameras from the camera inventory. They stay pending until real frames are verified.')}
              action={can('camera.read') ? <ButtonLink to={screenPath('web-14')}>{t('Camera inventory')}</ButtonLink> : undefined}
            />
          }
        >
          {(data) => {
            const now = checkedAt ?? Date.now();
            const items = data.items.filter((c) =>
              filter === 'all' ? true : filter === 'analyzing' ? c.analysis_state === 'analyzing' : c.readiness !== 'ready' || !c.snapshot,
            );
            return (
              <>
                <div className="gb-toolbar">
                  <FilterTabs<Filter>
                    label={t('Show cameras')}
                    value={filter}
                    onChange={setFilter}
                    items={[
                      { value: 'all', label: t('All cameras'), count: data.items.length },
                      { value: 'analyzing', label: t('analysis|Analyzing'), count: data.items.filter((c) => c.analysis_state === 'analyzing').length },
                      { value: 'attention', label: t('Needs attention'), count: data.items.filter((c) => c.readiness !== 'ready' || !c.snapshot).length },
                    ]}
                  />
                </div>
                {items.length === 0 ? (
                  <EmptyState compact icon="check" title={t('No cameras in this view')} />
                ) : (
                  <ul className="gb-wall plain-list" aria-label={t('Camera wall')}>
                    {items.map((c, i) => (
                      <CameraTile
                        key={c.id}
                        camera={c}
                        timeZone={timeZone}
                        now={now}
                        live={c.readiness === 'ready' && items.slice(0, i).filter((x) => x.readiness === 'ready').length < MAX_LIVE_TILES}
                      />
                    ))}
                  </ul>
                )}
              </>
            );
          }}
        </RouteStateBoundary>
      )}
    </>
  );
}

function CameraTile({ camera: c, timeZone, now, live }: { camera: Camera; timeZone: string; now: number; live: boolean }) {
  const { t, fmt } = useI18n();
  const label = c.location ? `${c.location} · ${c.name}` : c.name;
  const offline = c.readiness === 'offline' || c.readiness === 'disabled';
  const snapAge = ageSeconds(c.snapshot?.captured_at, now);
  return (
    <li className="card gb-wall-tile">
      {live ? (
        <LivePlayer cameraId={c.id} name={label} />
      ) : c.snapshot ? (
        <div className={`feed ${offline ? 'gb-feed-offline' : ''}`}>
          <AuthenticatedImage
            mediaId={c.snapshot.media_id}
            alt={t('Latest verified frame from {camera}', { camera: label })}
          />
          <span className="feed-label">{label}</span>
          <span className="feed-time">
            {fmt.dateTime(c.snapshot.captured_at, timeZone, { withZone: true })}
            {snapAge !== null && snapAge > 120 ? ` · ${t('Stale')}` : ''}
          </span>
        </div>
      ) : (
        <div className="feed feed-empty" role="status">
          <div>
            <p className="feed-empty-title">{offline ? t('Camera offline') : t('No verified frame yet')}</p>
            <p className="muted small">
              {offline
                ? t('The store edge cannot read this camera. Check power, network and credentials.')
                : c.readiness === 'ready'
                  ? t('The camera passed readiness checks but the edge has not uploaded a snapshot yet.')
                  : t('Frames appear after the store edge connects to the camera and verifies decoded video.')}
            </p>
          </div>
        </div>
      )}
      {c.snapshot && offline ? (
        <p className="muted small">{t('Camera offline — showing the last verified frame.')}</p>
      ) : null}
      <div className="gb-tile-foot">
        <Link to={`/web/live?camera=${encodeURIComponent(c.id)}`}>{c.name}</Link>
        <span className="gb-inline">
          <ReadinessPill readiness={c.readiness} />
          <AnalysisStatePill state={c.analysis_state} />
        </span>
      </div>
      <div className="gb-tile-foot muted small">
        <span>{t('Frame freshness')}</span>
        <FreshnessPill at={c.last_frame_at} now={now} />
      </div>
    </li>
  );
}
