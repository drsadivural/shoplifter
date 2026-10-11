// web-46 Events & audit log. GET /v1/audit with actor/action/result/date/store filters (kept in the
// URL) and cursor pagination; a detail drawer shows the request id and the chain hash.
// Org admins can recompute the hash chain: GET /v1/audit/verify.
import '../styles/group-d.css';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { toApiError, useApiQuery, usePagedQuery } from '../api/hooks';
import { gd, type AuditEntryD, type AuditVerify } from '../components/groupd/api';
import { addDays, zonedDateToIso } from '../components/groupd/dates';
import { auditActionLabel } from '../components/groupd/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Select, TextInput } from '../components/forms';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Button, KeyValueList, Notice, StatusPill } from '../components/primitives';
import { EmptyState, ErrorState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';

const RESULTS = ['success', 'denied', 'failed'] as const;

function ResultPill({ result }: { result: string }) {
  const { t } = useI18n();
  if (result === 'success') return <StatusPill tone="ok">{t('result|Success')}</StatusPill>;
  if (result === 'denied') return <StatusPill tone="warning">{t('result|Denied')}</StatusPill>;
  if (result === 'failed') return <StatusPill tone="critical">{t('result|Failed')}</StatusPill>;
  return <StatusPill tone="neutral">{result}</StatusPill>;
}

export default function LogsPage() {
  const { t, fmt, locale } = useI18n();
  const { can, stores, me, timeZone } = useSession();
  const [params, setParams] = useSearchParams();
  const orgTz = me?.org.timezone ?? timeZone;
  const actor = params.get('actor') ?? '';
  const action = params.get('action') ?? '';
  const result = (RESULTS as readonly string[]).includes(params.get('result') ?? '') ? params.get('result')! : '';
  const storeId = stores.some((s) => s.id === params.get('store')) ? params.get('store')! : '';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get('from') ?? '') ? params.get('from')! : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get('to') ?? '') ? params.get('to')! : '';
  const filterTz = stores.find((s) => s.id === storeId)?.timezone ?? orgTz;
  const [actionDraft, setActionDraft] = useState(action);
  const [open, setOpen] = useState<AuditEntryD | null>(null);
  const [verify, setVerify] = useState<{ pending: boolean; result?: AuditVerify; error?: ApiError }>({ pending: false });

  const users = useApiQuery((signal) => endpoints.users.list({}, { signal }), [], { enabled: can('user.manage') });

  const list = usePagedQuery(
    (cursor, signal) =>
      gd.audit.list(
        {
          actor_id: actor || undefined,
          action: action || undefined,
          result: result || undefined,
          store_id: storeId || undefined,
          from: from ? zonedDateToIso(from, filterTz, 'start') ?? undefined : undefined,
          to: to ? zonedDateToIso(addDays(to, 1), filterTz, 'start') ?? undefined : undefined,
          cursor,
          limit: 50,
        },
        { signal },
      ),
    [actor, action, result, storeId, from, to, filterTz],
    { enabled: can('audit.read') },
  );

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const onAction = (e: FormEvent) => {
    e.preventDefault();
    setParam('action', actionDraft.trim());
  };
  const runVerify = async () => {
    setVerify({ pending: true });
    try {
      setVerify({ pending: false, result: await gd.audit.verify() });
    } catch (e) {
      setVerify({ pending: false, error: toApiError(e) });
    }
  };

  const storeName = (id: string | null) => (id ? (stores.find((s) => s.id === id)?.name ?? id.slice(0, 8)) : null);
  const tzFor = (e: AuditEntryD) => stores.find((s) => s.id === e.store_id)?.timezone ?? orgTz;
  const filtersActive = Boolean(actor || action || result || storeId || from || to);

  const columns: Column<AuditEntryD>[] = [
    { key: 'time', header: t('Time'), render: (e) => <span className="mono-ish">{fmt.dateTime(e.at, tzFor(e), { withZone: true })}</span> },
    {
      key: 'actor',
      header: t('Actor'),
      render: (e) => (e.actor ? e.actor.display_name ?? e.actor.id : <span className="muted">{e.actor_kind === 'edge' ? t('Edge appliance') : t('System')}</span>),
    },
    {
      key: 'action',
      header: t('Action'),
      primary: true,
      render: (e) => (
        <button type="button" className="link-btn gd-audit-action" onClick={() => setOpen(e)}>
          {auditActionLabel(t, locale, e.action)}
          <span className="muted small mono"> {e.action}</span>
        </button>
      ),
    },
    {
      key: 'resource',
      header: t('Resource'),
      render: (e) => (
        <span className="small">
          {e.resource_type}
          {e.resource_id ? <span className="muted mono"> · {e.resource_id.length > 13 ? `${e.resource_id.slice(0, 8)}…` : e.resource_id}</span> : null}
        </span>
      ),
    },
    { key: 'store', header: t('Store'), render: (e) => storeName(e.store_id) ?? <span className="muted">{t('Organization')}</span> },
    { key: 'result', header: t('Result'), render: (e) => <ResultPill result={e.result} /> },
  ];

  if (!can('audit.read')) {
    return (
      <>
        <PageHeader screenId="web-46" />
        <PermissionDenied permission="audit.read" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        screenId="web-46"
        action={
          can('org.manage') ? (
            <Button variant="secondary" icon="check" onClick={() => void runVerify()} pending={verify.pending}>
              {t('Verify chain')}
            </Button>
          ) : undefined
        }
      />
      {verify.result ? (
        verify.result.valid ? (
          <Notice tone="info" title={t('Audit chain verified')}>
            {t('{n} entries were recomputed and match their recorded hashes.', { n: verify.result.checked })}
            {verify.result.head ? <div className="mono small gd-break">{t('Head hash')}: {verify.result.head}</div> : null}
          </Notice>
        ) : (
          <Notice tone="critical" title={t('Audit chain broken')}>
            {t('The hash chain does not match after {n} verified entries. Treat the log after this point as untrusted and contact support.', { n: verify.result.checked })}
            {verify.result.broken_at ? <div className="mono small">{t('First mismatching entry')}: {verify.result.broken_at}</div> : null}
          </Notice>
        )
      ) : null}
      {verify.error ? <ErrorState compact error={verify.error} onRetry={() => void runVerify()} title={t('The chain could not be verified')} /> : null}
      <div className="card">
        <DataTable
          caption={t('Events & audit log')}
          query={list}
          columns={columns}
          rowKey={(e) => e.id}
          toolbar={
            <>
              {can('user.manage') && users.data ? (
                <label className="filter">
                  <span className="filter-label">{t('Actor')}</span>
                  <Select value={actor} onChange={(e) => setParam('actor', e.target.value)}>
                    <option value="">{t('Anyone')}</option>
                    {users.data.items.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <form className="gd-inline-form" onSubmit={onAction}>
                <label className="filter">
                  <span className="filter-label">{t('Action starts with')}</span>
                  <TextInput value={actionDraft} placeholder="profile." onChange={(e) => setActionDraft(e.target.value)} maxLength={80} />
                </label>
                <Button type="submit" size="sm" variant="secondary" icon="search">
                  {t('Apply')}
                </Button>
              </form>
              <label className="filter">
                <span className="filter-label">{t('Result')}</span>
                <Select value={result} onChange={(e) => setParam('result', e.target.value)}>
                  <option value="">{t('Any result')}</option>
                  <option value="success">{t('result|Success')}</option>
                  <option value="denied">{t('result|Denied')}</option>
                  <option value="failed">{t('result|Failed')}</option>
                </Select>
              </label>
              <label className="filter">
                <span className="filter-label">{t('Store')}</span>
                <Select value={storeId} onChange={(e) => setParam('store', e.target.value)}>
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
                <TextInput type="date" value={from} max={to || undefined} onChange={(e) => setParam('from', e.target.value)} />
              </label>
              <label className="filter">
                <span className="filter-label">{t('To')}</span>
                <TextInput type="date" value={to} min={from || undefined} onChange={(e) => setParam('to', e.target.value)} />
              </label>
              {filtersActive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setActionDraft('');
                    setParams(new URLSearchParams(), { replace: true });
                  }}
                >
                  {t('Clear filters')}
                </Button>
              ) : null}
            </>
          }
          empty={
            filtersActive ? (
              <EmptyState compact icon="search" title={t('No audit entries match these filters')} />
            ) : (
              <EmptyState compact icon="audit" title={t('No audit entries yet')} />
            )
          }
        />
        <p className="muted small">{t('Times are shown in each store’s timezone; organization-level entries use {tz}. Dates in the filter use {ftz}.', { tz: orgTz, ftz: filterTz })}</p>
      </div>
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open ? auditActionLabel(t, locale, open.action) : ''} size="lg">
        {open ? (
          <>
            <KeyValueList
              items={[
                { label: t('Time'), value: fmt.dateTime(open.at, tzFor(open), { withZone: true }) },
                { label: t('Actor'), value: open.actor ? open.actor.display_name ?? open.actor.id : open.actor_kind ?? t('System') },
                { label: t('Action'), value: <span className="mono">{open.action}</span> },
                { label: t('Resource'), value: <span className="mono gd-break">{open.resource_type}{open.resource_id ? ` · ${open.resource_id}` : ''}</span> },
                { label: t('Store'), value: storeName(open.store_id) ?? t('Organization') },
                { label: t('Result'), value: <ResultPill result={open.result} /> },
                { label: t('Request ID'), value: <span className="mono gd-break">{open.request_id || '—'}</span> },
                { label: t('Entry hash'), value: <span className="mono gd-break">{open.hash ?? '—'}</span> },
              ]}
            />
            <h3 className="gd-subhead">{t('Details')}</h3>
            {open.detail && Object.keys(open.detail).length ? (
              <pre className="gd-json">{JSON.stringify(open.detail, null, 2)}</pre>
            ) : (
              <p className="muted">{t('No additional details were recorded.')}</p>
            )}
          </>
        ) : null}
      </Modal>
    </>
  );
}
