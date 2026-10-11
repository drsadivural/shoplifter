// web-47 System health. GET /v1/health/system (health.read), refreshed every 30 s:
//   edges (state, last seen, edge-reported health: decode latency p95, GPU, queue age, disk),
//   camera readiness counts, outbox (pending / oldest pending age / dead letter), worker heartbeat,
//   dependency availability (face_sdk, behavior_model, apns, oidc, smtp). Values an edge did not report
//   are "Unavailable", never 0; unconfigured dependencies are named explicitly.
import { Link } from 'react-router';
import { useApiQuery } from '../api/hooks';
import type { DependencyStatus } from '../api/types';
import { gb, type EdgeFull, type EdgeHealth, type SystemHealthFull } from '../components/groupb/api';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, KeyValueList, Notice, StatCard, StatusPill, type Tone } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { formatBytes, formatPercent } from '../lib/format';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

const DEPENDENCIES = ['face_sdk', 'behavior_model', 'apns', 'oidc', 'smtp'] as const;
type Dependency = (typeof DEPENDENCIES)[number];

const DEP_LABEL: Record<Dependency, string> = {
  face_sdk: 'dep|Face SDK',
  behavior_model: 'dep|Behavior model',
  apns: 'dep|Push notifications (APNs)',
  oidc: 'dep|Company SSO (OIDC)',
  smtp: 'dep|Email (SMTP)',
};

const DEP_STATUS: Record<DependencyStatus, [Tone, string]> = {
  available: ['ok', 'depstate|Available'],
  unavailable: ['critical', 'depstate|Unavailable'],
  unconfigured: ['neutral', 'depstate|Not configured'],
};

function healthOf(e: EdgeFull): EdgeHealth {
  return (e.health ?? {}) as EdgeHealth;
}

/** Worst (max or min) value of a metric across reporting edges, or null when none reported it. */
function worst(edges: EdgeFull[], pick: (h: EdgeHealth) => number | undefined, mode: 'max' | 'min'): { value: number; edge: string } | null {
  let best: { value: number; edge: string } | null = null;
  for (const e of edges) {
    const v = pick(healthOf(e));
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!best || (mode === 'max' ? v > best.value : v < best.value)) best = { value: v, edge: e.name };
  }
  return best;
}

const freeRatio = (h: EdgeHealth) =>
  typeof h.disk_free_bytes === 'number' && typeof h.disk_total_bytes === 'number' && h.disk_total_bytes > 0
    ? h.disk_free_bytes / h.disk_total_bytes
    : undefined;

export default function HealthPage() {
  const { t, fmt } = useI18n();
  const { timeZone } = useSession();
  const q = useApiQuery((signal) => gb.health({ signal }), [], { pollMs: 30_000 });
  return (
    <>
      <PageHeader
        screenId="web-47"
        subtitle={t('Current status reported by store edges, the alert pipeline and external services.')}
        action={
          <div className="page-action-stack">
            <Button variant="secondary" icon="refresh" onClick={q.reload} pending={q.fetching && q.data !== undefined}>
              {t('Refresh')}
            </Button>
            {q.data?.checked_at ? (
              <span className="muted small">
                {t('Last refresh')}: {fmt.time(q.data.checked_at, timeZone, { seconds: true, withZone: true })}
              </span>
            ) : null}
          </div>
        }
      />
      <RouteStateBoundary query={q} permission="health.read">
        {(data) => <HealthReady data={data} timeZone={timeZone} />}
      </RouteStateBoundary>
    </>
  );
}

function HealthReady({ data, timeZone }: { data: SystemHealthFull; timeZone: string }) {
  const { t, fmt, locale } = useI18n();
  const { stores } = useSession();
  const active = data.edges.filter((e) => e.state !== 'revoked');
  const online = active.filter((e) => e.state === 'online');
  const latency = worst(online, (h) => h.decode_latency_ms_p95, 'max');
  const gpu = worst(online, (h) => h.gpu_utilization, 'max');
  const queue = worst(online, (h) => h.queue_age_s, 'max');
  const storage = worst(online, freeRatio, 'min');
  const noOnline = t('No online edge appliance is reporting this metric.');
  const cams = data.cameras;

  return (
    <>
      <div className="stats">
        <StatCard
          label={t('Edge connectivity')}
          value={active.length === 0 ? null : `${fmt.number(online.length)}/${fmt.number(active.length)}`}
          caption={t('Online appliances')}
          unavailableReason={t('No edge appliance is paired.')}
          to={screenPath('web-08')}
        />
        <StatCard
          label={t('Decode latency')}
          value={latency ? `${fmt.number(latency.value)} ms` : null}
          caption={latency ? t('p95 · slowest edge: {name}', { name: latency.edge }) : undefined}
          unavailableReason={noOnline}
        />
        <StatCard
          label={t('GPU utilization')}
          value={gpu ? formatPercent(gpu.value > 1 ? gpu.value / 100 : gpu.value, locale, 0) : null}
          caption={gpu ? t('Busiest edge: {name}', { name: gpu.edge }) : undefined}
          unavailableReason={noOnline}
        />
        <StatCard
          label={t('Queue age')}
          value={queue ? fmt.duration(queue.value) : null}
          caption={queue ? t('Oldest queued frame · {name}', { name: queue.edge }) : undefined}
          unavailableReason={noOnline}
        />
      </div>

      <Card title={t('Edge appliances')}>
        {active.length === 0 ? (
          <EmptyState compact icon="wifiOff" title={t('No edge appliance paired')} description={t('Discovery, live view and analysis need a paired edge appliance at the store.')} />
        ) : (
          <div className="gb-table-wrap">
            <table className="gb-table">
              <caption className="visually-hidden">{t('Edge appliances')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('Device name')}</th>
                  <th scope="col">{t('Store')}</th>
                  <th scope="col">{t('Status')}</th>
                  <th scope="col">{t('Decode latency')}</th>
                  <th scope="col">{t('GPU utilization')}</th>
                  <th scope="col">{t('Queue age')}</th>
                  <th scope="col">{t('Storage')}</th>
                  <th scope="col">{t('Software version')}</th>
                </tr>
              </thead>
              <tbody>
                {active.map((e) => {
                  const h = healthOf(e);
                  const free = freeRatio(h);
                  const na = <span className="muted">{t('Unavailable')}</span>;
                  const tz = stores.find((s) => s.id === e.store_id)?.timezone ?? timeZone;
                  return (
                    <tr key={e.id}>
                      <td>
                        <strong>{e.name}</strong>
                        <div className="help">
                          {t('Last seen')}: {e.last_seen_at ? fmt.dateTime(e.last_seen_at, tz, { withZone: true }) : t('never')}
                        </div>
                      </td>
                      <td>{stores.find((s) => s.id === e.store_id)?.name ?? '—'}</td>
                      <td>
                        <StatusPill tone={e.state === 'online' ? 'ok' : 'critical'}>{e.state === 'online' ? t('edge|Online') : t('edge|Offline')}</StatusPill>
                        {e.state !== 'online' && e.health ? <div className="help">{t('Last reported values')}</div> : null}
                      </td>
                      <td>{typeof h.decode_latency_ms_p95 === 'number' ? `${fmt.number(h.decode_latency_ms_p95)} ms` : na}</td>
                      <td>{typeof h.gpu_utilization === 'number' ? formatPercent(h.gpu_utilization > 1 ? h.gpu_utilization / 100 : h.gpu_utilization, locale, 0) : na}</td>
                      <td>{typeof h.queue_age_s === 'number' ? fmt.duration(h.queue_age_s) : na}</td>
                      <td>
                        {free !== undefined ? (
                          <>
                            {t('{free} free of {total}', { free: formatBytes(h.disk_free_bytes, locale), total: formatBytes(h.disk_total_bytes, locale) })}
                            <div className="gb-meter" aria-hidden="true">
                              <span style={{ width: `${Math.round((1 - free) * 100)}%` }} />
                            </div>
                          </>
                        ) : (
                          na
                        )}
                      </td>
                      <td>{e.software_version || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {storage && storage.value < 0.1 ? <Notice tone="critical">{t('{name} has less than 10% storage free. Evidence spooling may stop.', { name: storage.edge })}</Notice> : null}
      </Card>

      <div className="grid gb-section">
        <Card
          title={t('Cameras')}
          actions={
            <Link className="link-sm" to={screenPath('web-14')}>
              {t('Camera inventory')}
            </Link>
          }
        >
          <KeyValueList
            items={[
              { label: t('Total'), value: fmt.number(cams.total) },
              { label: t('Ready'), value: fmt.number(cams.ready) },
              { label: t('readiness|Pending checks'), value: fmt.number(cams.pending) },
              { label: t('Degraded or offline'), value: fmt.number(cams.impaired) },
              { label: t('analysis|Analyzing'), value: fmt.number(cams.analyzing) },
            ]}
          />
        </Card>
        <Card title={t('Alert pipeline')}>
          <KeyValueList
            items={[
              {
                label: t('Worker'),
                value: (
                  <span className="gb-inline">
                    <StatusPill tone={data.worker.state === 'online' ? 'ok' : 'critical'}>
                      {data.worker.state === 'online' ? t('edge|Online') : t('edge|Offline')}
                    </StatusPill>
                    <span className="muted small">{data.worker.last_seen_at ? fmt.relative(data.worker.last_seen_at) : t('never')}</span>
                  </span>
                ),
              },
              { label: t('Outbox pending'), value: fmt.number(data.outbox.pending) },
              { label: t('Oldest pending'), value: data.outbox.oldest_pending_age_s === null ? t('None pending') : fmt.duration(data.outbox.oldest_pending_age_s) },
              {
                label: t('Dead letter'),
                value: data.outbox.dead_letter > 0 ? <StatusPill tone="critical">{fmt.number(data.outbox.dead_letter)}</StatusPill> : fmt.number(0),
              },
              ...(typeof data.pending_evidence === 'number' ? [{ label: t('Evidence uploads pending'), value: fmt.number(data.pending_evidence) }] : []),
            ]}
          />
          {data.worker.state !== 'online' ? (
            <Notice tone="critical">{t('The background worker is not reporting. Notifications and scheduled jobs are delayed until it recovers.')}</Notice>
          ) : null}
        </Card>
      </div>

      <Card title={t('Dependencies')} className="gb-section">
        <ul className="gb-dep-list">
          {DEPENDENCIES.map((d) => {
            const st = data.dependencies[d] ?? 'unavailable';
            const [tone, key] = DEP_STATUS[st] ?? DEP_STATUS.unavailable;
            return (
              <li key={d}>
                <div>
                  <strong>{t(DEP_LABEL[d])}</strong>
                  <div className="help">{t(`depinfo|${d}|${st}`)}</div>
                </div>
                <StatusPill tone={tone}>{t(key)}</StatusPill>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
