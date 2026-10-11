// web-10 Live camera wall. GET /v1/cameras?store_id= every 10 s; each tile shows the latest snapshot
// the store edge uploaded (privacy masks already applied on the edge) via /v1/media/{snapshot.media_id}.
// The relay is snapshot-based: tiles state frame freshness honestly and never imply a continuous
// stream. No RTSP address or credential ever reaches the browser.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery } from '../api/hooks';
import type { Camera } from '../api/types';
import { AnalysisStatePill, ReadinessPill } from '../components/domain';
import { ageSeconds } from '../components/groupb/api';
import { FreshnessPill } from '../components/groupb/ui';
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
type Filter = 'all' | 'analyzing' | 'attention';

export default function LivePage() {
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
      <Notice tone="info" title={t('Latest verified snapshots, not a continuous stream')}>
        {t('Each tile shows the most recent frame the store edge uploaded, with privacy masks already applied on the edge. Tiles refresh about every 10 seconds; the freshness label shows how old each frame is.')}
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
                    {items.map((c) => (
                      <CameraTile key={c.id} camera={c} timeZone={timeZone} now={now} />
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

function CameraTile({ camera: c, timeZone, now }: { camera: Camera; timeZone: string; now: number }) {
  const { t, fmt } = useI18n();
  const label = c.location ? `${c.location} · ${c.name}` : c.name;
  const offline = c.readiness === 'offline' || c.readiness === 'disabled';
  const snapAge = ageSeconds(c.snapshot?.captured_at, now);
  return (
    <li className="card gb-wall-tile">
      {c.snapshot ? (
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
        <Link to={screenPath('web-15', { id: c.id })}>{c.name}</Link>
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
