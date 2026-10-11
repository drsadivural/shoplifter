// web-23 Incident register. GET /v1/incidents (cursor pages, stable captured_at+id order) across
// all stores the user may access, including resolved incidents. Filters live in the URL.
// Dates are entered in the store timezone and sent as UTC.
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { usePagedQuery } from '../api/hooks';
import type { IncidentListParams, IncidentSummary } from '../api/types';
import { DataTable, type Column } from '../components/DataTable';
import { CHANNEL_LABEL, ChannelLabel, EvidenceStatePill, IncidentStatusPill, OutcomePill } from '../components/domain';
import { Select, TextInput } from '../components/forms';
import { CHANNELS, OUTCOMES, OUTCOME_KEY, STATUSES, STATUS_KEY } from '../components/groupc/labels';
import { useStoreTimeZone } from '../components/groupc/misc';
import { addDays, zonedToUtcIso } from '../components/groupc/time';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink } from '../components/primitives';
import { EmptyState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-c.css';

const PARAMS = ['store', 'status', 'outcome', 'channel', 'from', 'to', 'q'] as const;

export default function IncidentsPage() {
  const { t, fmt } = useI18n();
  const { stores, can, timeZone, me } = useSession();
  const [params, setParams] = useSearchParams();
  const tzFor = useStoreTimeZone();
  const get = (k: (typeof PARAMS)[number]) => params.get(k) ?? '';
  const storeId = stores.some((s) => s.id === get('store')) ? get('store') : '';
  const status = (STATUSES as string[]).includes(get('status')) ? get('status') : '';
  const outcome = [...OUTCOMES, 'none'].includes(get('outcome')) ? get('outcome') : '';
  const channel = (CHANNELS as string[]).includes(get('channel')) ? get('channel') : '';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(get('from')) ? get('from') : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(get('to')) ? get('to') : '';
  const q = get('q').slice(0, 100);
  const [qDraft, setQDraft] = useState(q);
  // Date filters use the chosen store's timezone (or the organization's when all stores are shown).
  const filterTz = storeId ? tzFor(storeId) : me?.org.timezone ?? timeZone;
  const rangeInvalid = Boolean(from && to && from > to);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const list = usePagedQuery(
    (cursor, signal) =>
      endpoints.incidents.list(
        {
          store_id: storeId || undefined,
          status: status || undefined,
          outcome: (outcome || undefined) as IncidentListParams['outcome'],
          channel: channel || undefined,
          from: from ? zonedToUtcIso(from, filterTz) ?? undefined : undefined,
          to: to ? zonedToUtcIso(addDays(to, 1), filterTz) ?? undefined : undefined,
          q: q || undefined,
          cursor: cursor ?? undefined,
          limit: 50,
        },
        { signal },
      ),
    [storeId, status, outcome, channel, from, to, q, filterTz],
    { enabled: can('incident.read') && !rangeInvalid },
  );

  if (!can('incident.read')) {
    return (
      <>
        <PageHeader screenId="web-23" />
        <PermissionDenied permission="incident.read" />
      </>
    );
  }

  const columns: Column<IncidentSummary>[] = [
    { key: 'ref', header: t('Incident'), primary: true, render: (r) => <span className="mono-ish">{r.ref}</span> },
    {
      key: 'time',
      header: t('Captured'),
      render: (r) => (
        <span>
          {fmt.dateTime(r.captured_at, tzFor(r.store_id, r.store_timezone), { withZone: true, seconds: false })}
          {r.delayed ? (
            <>
              {' '}
              <Badge tone="warning">{t('Delayed delivery')}</Badge>
            </>
          ) : null}
        </span>
      ),
    },
    { key: 'store', header: t('Store'), render: (r) => r.store_name },
    { key: 'type', header: t('Type'), render: (r) => <ChannelLabel channel={r.channel} /> },
    { key: 'status', header: t('Status'), render: (r) => <IncidentStatusPill status={r.status} /> },
    { key: 'outcome', header: t('Outcome'), render: (r) => <OutcomePill outcome={r.outcome} /> },
    { key: 'evidence', header: t('Evidence'), render: (r) => <EvidenceStatePill state={r.evidence_state} /> },
    {
      key: 'reviewer',
      header: t('Reviewer'),
      render: (r) => (r.assignee ? r.assignee.display_name : <span className="muted">{t('Unassigned')}</span>),
    },
  ];

  const filtersActive = Boolean(storeId || status || outcome || channel || from || to || q);
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setParam('q', qDraft.trim());
  };

  return (
    <>
      <PageHeader
        screenId="web-23"
        action={
          <>
            {can('search.metadata') ? (
              <ButtonLink to={screenPath('web-35')} icon="search">
                {t('Search')}
              </ButtonLink>
            ) : null}
            <Button variant="secondary" icon="refresh" onClick={list.reload}>
              {t('Refresh')}
            </Button>
          </>
        }
      />
      <div className="card">
        <DataTable
          caption={t('Incident register')}
          query={list}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => screenPath('web-24', { id: r.id })}
          toolbar={
            <>
              <form className="filter" role="search" onSubmit={submitSearch}>
                <span className="filter-label">{t('Search records')}</span>
                <span className="gc-inline">
                  <TextInput
                    aria-label={t('Reference or description')}
                    placeholder={t('INC-2026-000123 or description')}
                    value={qDraft}
                    maxLength={100}
                    onChange={(e) => setQDraft(e.target.value)}
                  />
                  <Button type="submit" variant="secondary" size="sm" icon="search">
                    {t('Search')}
                  </Button>
                </span>
              </form>
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
                <span className="filter-label">{t('Status')}</span>
                <Select value={status} onChange={(e) => setParam('status', e.target.value)}>
                  <option value="">{t('Any status')}</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(STATUS_KEY[s])}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="filter">
                <span className="filter-label">{t('Outcome')}</span>
                <Select value={outcome} onChange={(e) => setParam('outcome', e.target.value)}>
                  <option value="">{t('Any outcome')}</option>
                  <option value="none">{t('outcome|Not recorded')}</option>
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {t(OUTCOME_KEY[o])}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="filter">
                <span className="filter-label">{t('Type')}</span>
                <Select value={channel} onChange={(e) => setParam('channel', e.target.value)}>
                  <option value="">{t('All types')}</option>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {t(CHANNEL_LABEL[c])}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="filter">
                <span className="filter-label">{t('From')}</span>
                <TextInput type="date" className="gc-filter-date" value={from} onChange={(e) => setParam('from', e.target.value)} />
              </label>
              <label className="filter">
                <span className="filter-label">{t('To')}</span>
                <TextInput type="date" className="gc-filter-date" value={to} onChange={(e) => setParam('to', e.target.value)} />
              </label>
              {filtersActive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQDraft('');
                    setParams(new URLSearchParams(), { replace: true });
                  }}
                >
                  {t('Clear filters')}
                </Button>
              ) : null}
            </>
          }
          empty={
            rangeInvalid ? (
              <EmptyState compact icon="warning" title={t('The start date is after the end date')} />
            ) : filtersActive ? (
              <EmptyState compact icon="search" title={t('No incidents match these filters')} />
            ) : (
              <EmptyState
                icon="incidents"
                title={t('No incidents recorded yet')}
                description={t('Incidents appear here when the store edge reports candidate evidence or staff report an observation.')}
              />
            )
          }
        />
        <p className="muted small">
          {t('Dates are in {tz}. Results are ordered by capture time, newest first.', { tz: filterTz })}
        </p>
      </div>
    </>
  );
}
