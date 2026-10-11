// web-18 Store calibration.
//   GET /v1/reports/summary?store_id=&from=&to= -> reviewed precision {value, n, ci95} and false alerts per
//   camera-hour {value, false_alerts, camera_hours} computed from human-reviewed outcomes only.
//   Null values are "insufficient data", never 0. Recall cannot be computed from alerts: it needs
//   adjudicated, complete recordings (missed incidents never become alerts).
//   GET/PUT /v1/stores/{id}/policies/calibration {expected_version, settings: {published, threshold, reason}}.
import { useEffect, useMemo, useState } from 'react';
import type { ApiError } from '../api/client';
import { useApiQuery, useMutation } from '../api/hooks';
import type { StorePolicy } from '../api/types';
import { SelectField, TextField, fieldErrorText } from '../components/forms';
import { gb, type CalibrationSettings, type ReportSummaryFull } from '../components/groupb/api';
import { StoreSelect, useScopedStore } from '../components/groupb/ui';
import { ConfirmDialog } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, KeyValueList, Notice, StatCard } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState, ErrorState, LoadingState } from '../components/states';
import { TrendChart } from '../components/TrendChart';
import { useI18n } from '../i18n';
import { formatPercent } from '../lib/format';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

const RANGES = [7, 30, 90] as const;

export default function CalibrationPage() {
  const { t } = useI18n();
  const { store } = useScopedStore();
  const { stores, can } = useSession();
  const [storeId, setStoreId] = useState(store?.id ?? '');
  useEffect(() => {
    if (!storeId && store) setStoreId(store.id);
  }, [store, storeId]);
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const current = stores.find((s) => s.id === storeId);
  // Window end is fixed per selection so polling/refetches compare the same period.
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days, storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const policy = useApiQuery((signal) => gb.policy<CalibrationSettings>(storeId, 'calibration', { signal }), [storeId], { enabled: Boolean(storeId) });
  const report = useApiQuery((signal) => gb.report({ store_id: storeId, ...range }, { signal }), [storeId, range.from], {
    enabled: Boolean(storeId) && can('report.read'),
  });

  return (
    <>
      <PageHeader
        screenId="web-18"
        subtitle={current ? `${current.name} · ${t('Measured from human-reviewed outcomes. No figures are estimated or invented.')}` : undefined}
      />
      {!storeId ? (
        <EmptyState icon="info" title={t('No stores assigned')} description={t('Ask an administrator to assign you to a store.')} />
      ) : (
        <RouteStateBoundary query={policy} permission="policy.manage">
          {(p) => (
            <>
              <div className="gb-toolbar">
                <StoreSelect value={storeId} onChange={setStoreId} />
                <SelectField
                  label={t('Period')}
                  value={String(days)}
                  onChange={(e) => setDays(Number(e.target.value) as (typeof RANGES)[number])}
                  options={RANGES.map((d) => ({ value: String(d), label: t('Last {n} days', { n: d }) }))}
                />
              </div>
              <Metrics report={report.data} error={report.error} loading={report.loading} onRetry={report.reload} canRead={can('report.read')} policy={p} />
              <PublishCard
                storeId={storeId}
                policy={p}
                timeZone={current?.timezone ?? 'UTC'}
                setPolicy={policy.setData}
                reload={policy.reload}
                reloading={policy.fetching}
                report={report.data}
              />
            </>
          )}
        </RouteStateBoundary>
      )}
    </>
  );
}

function Metrics({
  report,
  error,
  loading,
  onRetry,
  canRead,
  policy,
}: {
  report: ReportSummaryFull | undefined;
  error: ApiError | undefined;
  loading: boolean;
  onRetry: () => void;
  canRead: boolean;
  policy: StorePolicy<CalibrationSettings>;
}) {
  const { t, fmt, locale } = useI18n();
  const cal = policy.settings;
  const threshold = (
    <StatCard
      label={t('Threshold')}
      value={cal.published && cal.threshold !== null ? fmt.number(cal.threshold, { maximumFractionDigits: 3 }) : null}
      caption={t('Published calibration')}
      unavailableReason={t('No calibration published yet.')}
    />
  );
  const recall = (
    <StatCard
      label={t('Recall sample')}
      value={null}
      unavailableReason={t('Requires adjudicated, complete recordings. Missed incidents never become alerts, so recall cannot be computed from alerts.')}
    />
  );
  if (!canRead) {
    return (
      <>
        <Notice tone="info">{t('Your role cannot read reports, so measured outcomes are not shown.')}</Notice>
        <div className="stats">
          {recall}
          {threshold}
        </div>
      </>
    );
  }
  if (error && !report) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading || !report) return <LoadingState />;
  const p = report.reviewed_precision;
  const f = report.false_alerts_per_camera_hour;
  const daily = (report.daily as { date: string; confirmed?: number; false_alert?: number; inconclusive?: number }[]).map((d) => ({
    date: d.date,
    confirmed: d.confirmed ?? 0,
    false_alert: d.false_alert ?? 0,
    inconclusive: d.inconclusive ?? 0,
  }));
  return (
    <>
      <div className="stats">
        <StatCard
          label={t('False alerts per camera-hour')}
          value={f.value === null ? null : fmt.number(f.value, { maximumFractionDigits: 3 })}
          caption={t('{false} false alerts / {hours} analyzed camera-hours', { false: fmt.number(f.false_alerts), hours: fmt.number(f.camera_hours) })}
          unavailableReason={t('Insufficient data: no analyzed camera-hours reported by the edge in this period.')}
        />
        <StatCard
          label={t('Reviewed precision')}
          value={p.value === null ? null : formatPercent(p.value, locale)}
          caption={
            p.ci95
              ? t('n = {n} · 95% CI {low}–{high}', { n: fmt.number(p.n), low: formatPercent(p.ci95[0], locale), high: formatPercent(p.ci95[1], locale) })
              : t('n = {n}', { n: fmt.number(p.n) })
          }
          unavailableReason={t('Insufficient data: no automated alerts with a confirmed or false-alert outcome in this period.')}
        />
        {recall}
        {threshold}
      </div>
      <div className="grid gb-form-layout">
        <Card title={t('Reviewed outcomes')}>
          {daily.length === 0 ? (
            <EmptyState compact icon="reports" title={t('No reviewed outcomes in this period')} description={t('Outcomes appear after responders record confirmed, false alert or inconclusive results.')} />
          ) : (
            <TrendChart
              title={t('Reviewed outcomes')}
              data={daily}
              series={[
                { key: 'confirmed', label: t('Confirmed incident'), className: 'series-b' },
                { key: 'false_alert', label: t('False alert'), className: 'series-a' },
                { key: 'inconclusive', label: t('Inconclusive'), className: 'gb-series-c' },
              ]}
            />
          )}
          <KeyValueList
            items={[
              { label: t('Reviewed incidents'), value: fmt.number(report.reviewed) },
              { label: t('Confirmed incident'), value: fmt.number(report.confirmed) },
              { label: t('False alert'), value: fmt.number(report.false_alert) },
              { label: t('Inconclusive'), value: fmt.number(report.inconclusive) },
            ]}
          />
        </Card>
        <Card title={t('How these figures are defined')}>
          <ul className="gb-steps-list">
            <li>{t('Reviewed precision = confirmed ÷ (confirmed + false alert) for automated alerts with a human outcome. Inconclusive results are excluded. The interval is a 95% Wilson interval.')}</li>
            <li>{t('False alerts per camera-hour = human-reviewed false alerts ÷ analyzed camera-hours reported by edge heartbeats.')}</li>
            <li>{t('Recall needs a sample of complete recordings reviewed by people for missed incidents. It is not computed here.')}</li>
          </ul>
          <Notice tone="warning">{t('Small samples give wide intervals. Do not publish a calibration from a handful of reviews.')}</Notice>
        </Card>
      </div>
    </>
  );
}

function PublishCard({
  storeId,
  policy,
  timeZone,
  setPolicy,
  reload,
  reloading,
  report,
}: {
  storeId: string;
  policy: StorePolicy<CalibrationSettings>;
  timeZone: string;
  setPolicy: (p: StorePolicy<CalibrationSettings>) => void;
  reload: () => void;
  reloading: boolean;
  report: ReportSummaryFull | undefined;
}) {
  const { t, fmt, locale } = useI18n();
  const cal = policy.settings;
  const [threshold, setThreshold] = useState(cal.threshold !== null ? String(cal.threshold) : '');
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'withdraw' | null>(null);
  const [conflict, setConflict] = useState(false);

  const put = useMutation(
    (settings: { published: boolean; threshold: number | null; reason: string }) =>
      gb.putPolicy<Partial<CalibrationSettings>>(storeId, 'calibration', { expected_version: policy.version, settings }),
    {
      successMessage: (r) => (r.settings.published ? t('Calibration published') : t('Calibration withdrawn')),
      onSuccess: (r) => {
        setPolicy(r as StorePolicy<CalibrationSettings>);
        setConflict(false);
      },
      onError: (e) => {
        if (e.status === 409) {
          setConflict(true);
          setConfirm(null);
          reload();
          return true;
        }
        if (e.status === 422 && e.fieldErrors['settings.threshold']) {
          setThresholdError(fieldErrorText(e.fieldErrors['settings.threshold'], locale));
          setConfirm(null);
          return true;
        }
        return false;
      },
    },
  );

  const openPublish = () => {
    const v = Number(threshold);
    if (threshold.trim() === '' || !Number.isFinite(v) || v < 0 || v > 1) {
      setThresholdError(t('Enter a number from {min} to {max}.', { min: 0, max: 1 }));
      return;
    }
    setThresholdError(null);
    setConfirm('publish');
  };

  const n = report?.reviewed_precision.n;
  return (
    <Card title={t('Publish calibration')} className="gb-section">
      {conflict ? (
        <ConflictBanner
          currentVersion={policy.version}
          reloading={reloading}
          onReload={() => {
            setConflict(false);
            reload();
          }}
        />
      ) : null}
      <KeyValueList
        items={[
          { label: t('Status'), value: cal.published ? <Badge tone="ok">{t('Published')}</Badge> : <Badge tone="warning">{t('Not published — design defaults in use')}</Badge> },
          ...(cal.published
            ? [
                { label: t('Threshold'), value: cal.threshold ?? '—' },
                { label: t('Reason'), value: cal.reason || '—' },
                { label: t('Based on reviewed incidents'), value: fmt.number(cal.based_on_reviewed_incidents) },
              ]
            : []),
          { label: t('Last updated'), value: policy.updated_at ? fmt.dateTime(policy.updated_at, timeZone, { withZone: true }) : t('never') },
          { label: t('Version'), value: policy.version },
        ]}
      />
      <div className="form-grid">
        <TextField
          label={t('Threshold')}
          type="number"
          inputMode="decimal"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(e) => {
            setThreshold(e.target.value);
            setThresholdError(null);
          }}
          error={thresholdError}
          hint={t('Behavior evidence score (0–1) chosen from the reviewed outcomes above.')}
        />
      </div>
      {n !== undefined && n < 30 ? (
        <Notice tone="warning">{t('Only {n} reviewed automated alerts in this period. Consider collecting more reviews before publishing.', { n })}</Notice>
      ) : null}
      <div className="action-row">
        <Button onClick={openPublish}>{t('Publish calibration')}</Button>
        {cal.published ? (
          <Button variant="secondary" onClick={() => setConfirm('withdraw')}>
            {t('Withdraw calibration')}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'withdraw' ? t('Withdraw calibration') : t('Publish calibration')}
        description={
          confirm === 'withdraw'
            ? t('Detection rules for this store return to uncalibrated design defaults.')
            : t('Publish threshold {value} for this store. The store edge applies it on its next sync and detection rules are marked calibrated.', { value: threshold })
        }
        confirmLabel={confirm === 'withdraw' ? t('Withdraw calibration') : t('Publish calibration')}
        confirmVariant={confirm === 'withdraw' ? 'danger' : 'primary'}
        pending={put.pending}
        reasonHint={t('Explain which reviewed data supports this change. Recorded in the audit log with your name.')}
        onConfirm={async (reason) =>
          (await put.run(
            confirm === 'withdraw'
              ? { published: false, threshold: cal.threshold, reason }
              : { published: true, threshold: Number(threshold), reason },
          )).ok
        }
      />
    </Card>
  );
}
