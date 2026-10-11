// web-41 Reports & measured impact. GET /v1/reports/summary?store_id&from&to.
// Only measured, human-reviewed outcomes with stated denominators and sample sizes:
//   reviewed precision = confirmed / (confirmed + false alert) for automated alerts (n + 95% Wilson CI)
//   false alerts per analyzed camera-hour (numerator and denominator shown)
//   median acknowledgement time (n), confirmed loss (n with a recorded value), recovered value
// Null metrics render as "Insufficient data", never 0. No accuracy marketing figures.
import { useSearchParams } from 'react-router';
import { useApiQuery } from '../api/hooks';
import type { IncidentChannel } from '../api/types';
import { CHANNEL_LABEL } from '../components/domain';
import { Select, TextInput } from '../components/forms';
import { DailyChart, type DailyRow } from '../components/groupc/DailyChart';
import { CHANNELS } from '../components/groupc/labels';
import { useStoreTimeZone } from '../components/groupc/misc';
import { addDays, utcToZonedDate, zonedToUtcIso } from '../components/groupc/time';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, KeyValueList, Notice, StatCard } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { formatPercent } from '../lib/format';
import { useSession } from '../session/SessionProvider';
import { gc, type ReportSummaryFull } from './_groupc-api';
import '../styles/group-c.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fillDaily(r: ReportSummaryFull): DailyRow[] {
  const byDate = new Map(r.daily.map((d) => [d.date, d]));
  const start = r.from.slice(0, 10);
  const end = r.to.slice(0, 10);
  const out: DailyRow[] = [];
  for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) {
    // Days without incidents are omitted by the API; they are true zero-detection days.
    out.push(byDate.get(d) ?? { date: d, detections: 0, confirmed: 0, false_alert: 0, inconclusive: 0 });
  }
  return out;
}

export default function ReportsPage() {
  const { t } = useI18n();
  const { stores, can, me, timeZone } = useSession();
  const [params, setParams] = useSearchParams();
  const tzFor = useStoreTimeZone();
  const storeId = stores.some((s) => s.id === params.get('store')) ? params.get('store')! : '';
  const tz = storeId ? tzFor(storeId) : me?.org.timezone ?? timeZone;
  const today = utcToZonedDate(new Date(), tz);
  const from = DATE.test(params.get('from') ?? '') ? params.get('from')! : addDays(today, -29);
  const to = DATE.test(params.get('to') ?? '') ? params.get('to')! : today;
  const rangeInvalid = from > to;
  const q = useApiQuery(
    (signal) =>
      gc.reports(
        { store_id: storeId || undefined, from: zonedToUtcIso(from, tz) ?? undefined, to: zonedToUtcIso(addDays(to, 1), tz) ?? undefined },
        { signal },
      ),
    [storeId, from, to, tz],
    { enabled: can('report.read') && !rangeInvalid },
  );
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        screenId="web-41"
        action={
          <Button variant="secondary" icon="refresh" onClick={q.reload}>
            {t('Refresh')}
          </Button>
        }
      />
      <div className="toolbar gc-report-filters">
        <label className="filter">
          <span className="filter-label">{t('Store')}</span>
          <Select value={storeId} onChange={(e) => set('store', e.target.value)}>
            <option value="">{t('All stores')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="filter">
          <span className="filter-label">{t('From')}</span>
          <TextInput type="date" className="gc-filter-date" value={from} max={to} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="filter">
          <span className="filter-label">{t('To')}</span>
          <TextInput type="date" className="gc-filter-date" value={to} min={from} onChange={(e) => set('to', e.target.value)} />
        </label>
        <span className="muted small">{t('Dates in {tz}', { tz })}</span>
      </div>
      {rangeInvalid ? (
        <EmptyState compact icon="warning" title={t('The start date is after the end date')} />
      ) : (
        <RouteStateBoundary query={q} permission="report.read">
          {(r) => <ReportReady r={r} />}
        </RouteStateBoundary>
      )}
    </>
  );
}

function ReportReady({ r }: { r: ReportSummaryFull }) {
  const { t, fmt, locale } = useI18n();
  const p = r.reviewed_precision;
  const fa = r.false_alerts_per_camera_hour;
  const pct = (v: number) => formatPercent(v, locale, 1);
  const daily = fillDaily(r);
  const nothing = r.detections.total === 0 && r.reviewed === 0;
  return (
    <>
      <div className="stats">
        <StatCard
          label={t('Reviewed precision')}
          value={p.value === null ? null : pct(p.value)}
          unavailableReason={t('Insufficient data — no automated alert has a confirmed or false-alert outcome in this period.')}
          caption={
            <>
              n = {fmt.number(p.n)}
              {p.ci95 ? ` · ${t('95% CI {lo}–{hi}', { lo: pct(p.ci95[0]), hi: pct(p.ci95[1]) })}` : ''}
            </>
          }
        />
        <StatCard
          label={t('False alerts per camera-hour')}
          value={fa.value === null ? null : fmt.number(fa.value, { maximumFractionDigits: 4 })}
          unavailableReason={t('Insufficient data — no analyzed camera-hours were reported by store edges in this period.')}
          caption={t('{n} false alerts / {h} analyzed camera-hours', { n: fmt.number(fa.false_alerts), h: fmt.number(fa.camera_hours) })}
        />
        <StatCard
          label={t('Acknowledgement time')}
          value={r.median_ack_seconds === null ? null : fmt.duration(r.median_ack_seconds)}
          unavailableReason={t('Insufficient data — no alert was acknowledged in this period.')}
          caption={t('Median · n = {n} acknowledged alerts', { n: fmt.number(r.ack_n) })}
        />
        <StatCard
          label={t('Confirmed loss')}
          value={r.loss_n === 0 ? null : fmt.currency(r.confirmed_loss, r.currency)}
          unavailableReason={t('Insufficient data — no confirmed incident has a recorded loss value.')}
          caption={t('Sum over {n} confirmed incidents with a recorded value', { n: fmt.number(r.loss_n) })}
        />
      </div>
      <Notice tone="warning">{t('Impact is measured from reviewed incidents')}</Notice>
      <div className="grid detail-grid gc-section">
        <Card title={t('Detections and reviewed outcomes')}>
          {nothing ? (
            <EmptyState compact icon="reports" title={t('No detections or reviews in this period')} description={t('Measured results appear after alerts are detected and people record outcomes.')} />
          ) : (
            <DailyChart rows={daily} title={t('Daily detections and reviewed outcomes')} />
          )}
          <p className="muted small">{t('Daily bars use UTC calendar days (as grouped by the server); the totals use the selected dates.')}</p>
          <div className="dt-scroll">
            <table className="dt gc-table-compact">
              <caption className="visually-hidden">{t('Detections by channel')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('Event type')}</th>
                  <th scope="col" className="align-end">
                    {t('Detections')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {CHANNELS.map((c: IncidentChannel) => (
                  <tr key={c}>
                    <th scope="row">{t(CHANNEL_LABEL[c])}</th>
                    <td className="align-end">{fmt.number(r.detections.by_channel[c] ?? 0)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">{t('Total')}</th>
                  <td className="align-end">
                    <strong>{fmt.number(r.detections.total)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <div className="gc-stack">
          <Card title={t('Reviewed incidents')}>
            <KeyValueList
              items={[
                { label: t('Detections'), value: fmt.number(r.detections.total) },
                { label: t('Reviewed incidents'), value: fmt.number(r.reviewed) },
                { label: t('Confirmed incident'), value: fmt.number(r.confirmed) },
                { label: t('False alerts'), value: fmt.number(r.false_alert) },
                { label: t('Inconclusive'), value: fmt.number(r.inconclusive) },
                { label: t('Not yet reviewed'), value: fmt.number(Math.max(0, r.detections.total - r.reviewed)) },
                {
                  label: t('Recovered value'),
                  value: r.confirmed === 0 ? t('Insufficient data') : fmt.currency(r.recovered_value, r.currency),
                },
              ]}
            />
            <p className="muted small">{t('Recovered value is the sum recorded on confirmed incidents; blank values are not counted.')}</p>
          </Card>
          <Card title={t('Definitions')}>
            <p className="small">
              <strong>{t('Reviewed precision')}</strong>
            </p>
            <p className="gc-definition">{t('Confirmed ÷ (confirmed + false alert) for automated alerts that a person reviewed. Inconclusive and manual reports are excluded. The 95% interval is a Wilson score interval.')}</p>
            <p className="small">
              <strong>{t('False alerts per camera-hour')}</strong>
            </p>
            <p className="gc-definition">{t('Human-reviewed false alerts ÷ analyzed camera-hours reported by store edge heartbeats.')}</p>
            <p className="small">
              <strong>{t('Acknowledgement time')}</strong>
            </p>
            <p className="gc-definition">{t('Median time from the alert reaching the server to a responder pressing Acknowledge.')}</p>
            <Notice tone="info">{t('RetailGuard shows no overall accuracy figure. Unreviewed alerts are not counted as correct or incorrect.')}</Notice>
          </Card>
        </div>
      </div>
    </>
  );
}
