// web-38 Checkout exceptions. GET /v1/checkout/exceptions?store_id= (checkout_exception incidents,
// newest first, up to 200) with per-store POS telemetry status (pos_status). Lanes come from the
// POS integration lane→camera map (GET /v1/integrations). A checkout exception is a visual
// interaction to review against POS records — "not observed" is not "not paid".
import { useSearchParams } from 'react-router';
import { useApiQuery } from '../api/hooks';
import { DataTable, type Column } from '../components/DataTable';
import { EvidenceStatePill, IncidentStatusPill, OutcomePill } from '../components/domain';
import { Select } from '../components/forms';
import { useStoreName, useStoreTimeZone } from '../components/groupc/misc';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, Notice, StatusPill } from '../components/primitives';
import { EmptyState, ErrorState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import { gc, type CheckoutException, type PosStatus } from './_groupc-api';
import '../styles/group-c.css';

export default function CheckoutPage() {
  const { t, fmt } = useI18n();
  const { can, stores } = useSession();
  const [params, setParams] = useSearchParams();
  const storeId = stores.some((s) => s.id === params.get('store')) ? params.get('store')! : '';
  const tzFor = useStoreTimeZone();
  const storeName = useStoreName();
  const q = useApiQuery((signal) => gc.checkout(storeId || undefined, { signal }), [storeId], { enabled: can('incident.read') });
  const integrations = useApiQuery((signal) => gc.integrations({ signal }), [], { enabled: can('store.read') });

  if (!can('incident.read')) {
    return (
      <>
        <PageHeader screenId="web-38" />
        <PermissionDenied permission="incident.read" />
      </>
    );
  }

  // camera_id -> lane names from POS lane maps.
  const lanesByCamera = new Map<string, string[]>();
  for (const i of integrations.data?.items ?? []) {
    if (i.kind !== 'pos') continue;
    for (const [lane, cam] of Object.entries(i.config.lane_map ?? {})) lanesByCamera.set(cam, [...(lanesByCamera.get(cam) ?? []), lane]);
  }

  const columns: Column<CheckoutException>[] = [
    { key: 'ref', header: t('Incident'), primary: true, render: (r) => <span className="mono-ish">{r.ref}</span> },
    {
      key: 'lane',
      header: t('Lane'),
      render: (r) => {
        const lanes = r.camera_id ? lanesByCamera.get(r.camera_id) : undefined;
        return lanes?.length ? lanes.join(', ') : <span className="muted">{integrations.error ? t('Unavailable') : t('Not mapped')}</span>;
      },
    },
    { key: 'camera', header: t('Camera'), render: (r) => r.camera_name ?? <span className="muted">{t('No camera')}</span> },
    {
      key: 'visual',
      header: t('Visual interaction'),
      render: (r) => (
        <span>
          {fmt.dateTime(r.captured_at, tzFor(r.store_id, r.store_timezone), { withZone: true })}{' '}
          <EvidenceStatePill state={r.evidence_state} />
        </span>
      ),
    },
    {
      key: 'transaction',
      header: t('Transaction'),
      render: () => <span className="muted small">{t('Reconcile with POS events on the detail screen')}</span>,
      hideInCards: true,
    },
    {
      key: 'exception',
      header: t('Exception'),
      render: (r) => (
        <span className="gc-inline">
          <IncidentStatusPill status={r.status} />
          <OutcomePill outcome={r.outcome} />
        </span>
      ),
    },
  ];

  const posEntries = Object.entries(q.data?.pos_status ?? {});
  const anyConfigured = posEntries.some(([, s]) => s.configured);

  return (
    <>
      <PageHeader
        screenId="web-38"
        action={
          <Button variant="secondary" icon="refresh" onClick={q.reload}>
            {t('Refresh')}
          </Button>
        }
      />
      <Notice tone="info">
        {t('A checkout exception is a visual interaction that needs review against POS records. “Not observed” is not “not paid”, and missing POS telemetry means the comparison is unavailable — never that nothing was scanned.')}
      </Notice>
      <div className="grid detail-grid gc-section">
        <div className="card">
          <DataTable
            caption={t('Checkout exceptions')}
            rows={q.data?.items ?? []}
            loading={q.loading}
            error={q.error}
            onRetry={q.reload}
            columns={columns}
            rowKey={(r) => r.id}
            rowHref={(r) => screenPath('web-39', { id: r.id })}
            toolbar={
              <label className="filter">
                <span className="filter-label">{t('Store')}</span>
                <Select
                  value={storeId}
                  onChange={(e) => {
                    const next = new URLSearchParams(params);
                    if (e.target.value) next.set('store', e.target.value);
                    else next.delete('store');
                    setParams(next, { replace: true });
                  }}
                >
                  <option value="">{t('All stores')}</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>
            }
            empty={
              <EmptyState
                icon="cases"
                title={t('No checkout exceptions')}
                description={
                  anyConfigured
                    ? t('No checkout exceptions have been reported for these stores.')
                    : t('Checkout exceptions need a POS connector sending signed lane events and a visual checkout model on the store edge. Neither is reporting for these stores.')
                }
                action={
                  can('integration.manage') ? <ButtonLink to={screenPath('web-40')}>{t('Set up POS integration')}</ButtonLink> : undefined
                }
              />
            }
          />
        </div>
        <Card title={t('POS telemetry')}>
          {q.error && !q.data ? (
            <ErrorState error={q.error} onRetry={q.reload} compact />
          ) : posEntries.length === 0 ? (
            <p className="muted small">{q.loading ? t('Loading…') : t('No stores in scope.')}</p>
          ) : (
            <ul className="gc-list">
              {posEntries.map(([sid, s]) => (
                <li key={sid}>
                  <div className="gc-list-main">
                    <span className="gc-list-title">{storeName(sid)}</span>
                    <span className="muted small">
                      {t('Last heartbeat')}: {s.last_event_at ? fmt.dateTime(s.last_event_at, tzFor(sid), { withZone: true }) : t('none received')}
                    </span>
                  </div>
                  <PosStatusPill status={s} />
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">{t('Telemetry is “receiving” when a signed event arrived in the last 10 minutes.')}</p>
          {can('integration.manage') ? (
            <ButtonLink to={screenPath('web-40')} size="sm">
              {t('Manage integrations')}
            </ButtonLink>
          ) : null}
        </Card>
      </div>
    </>
  );
}

function PosStatusPill({ status }: { status: PosStatus }) {
  const { t } = useI18n();
  if (!status.configured) return <StatusPill tone="neutral">{t('pos|Not configured')}</StatusPill>;
  if (status.fresh) return <StatusPill tone="ok">{t('integration|Receiving')}</StatusPill>;
  return <StatusPill tone="critical">{t('pos|Telemetry missing')}</StatusPill>;
}
