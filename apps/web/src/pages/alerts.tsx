// web-19 Alert inbox. GET /v1/incidents (cursor pages) for the selected store, unresolved only.
// Filters live in the URL so refresh/share keeps them. Acknowledgement is never inferred from
// push delivery: the Status column shows only what a responder recorded.
import { useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { usePagedQuery } from '../api/hooks';
import type { EvidenceState, IncidentChannel, IncidentPriority, IncidentStatus, IncidentSummary } from '../api/types';
import { DataTable, type Column } from '../components/DataTable';
import { ChannelLabel, EvidenceStatePill, IncidentStatusPill, PriorityPill } from '../components/domain';
import { Select } from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, FilterTabs, Notice } from '../components/primitives';
import { EmptyState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

type ChannelTab = 'all' | 'behavior' | 'watchlist' | 'checkout';
const CHANNEL_PARAM: Record<Exclude<ChannelTab, 'all'>, IncidentChannel> = {
  behavior: 'behavior_candidate',
  watchlist: 'watchlist_candidate',
  checkout: 'checkout_exception',
};
const OPEN_STATUSES: IncidentStatus[] = ['new', 'acknowledged', 'reviewing'];
const PRIORITIES: IncidentPriority[] = ['urgent', 'high', 'normal'];
const EVIDENCE: EvidenceState[] = ['pending', 'available', 'unavailable', 'expired'];

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export default function AlertsPage() {
  const { t, fmt } = useI18n();
  const { store, stores, timeZone, can } = useSession();
  const [params, setParams] = useSearchParams();
  const channel = pick<ChannelTab>(params.get('channel'), ['all', 'behavior', 'watchlist', 'checkout'], 'all');
  const status = pick<'open' | IncidentStatus>(params.get('status'), ['open', ...OPEN_STATUSES], 'open');
  const priority = pick<'any' | IncidentPriority>(params.get('priority'), ['any', ...PRIORITIES], 'any');
  const assignee = pick<'any' | 'me'>(params.get('assignee'), ['any', 'me'], 'any');
  const evidence = pick<'any' | EvidenceState>(params.get('evidence'), ['any', ...EVIDENCE], 'any');

  const setParam = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(params);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const q = usePagedQuery(
    (cursor, signal) =>
      endpoints.incidents.list(
        {
          store_id: store?.id,
          channel: channel === 'all' ? undefined : CHANNEL_PARAM[channel],
          status: status === 'open' ? OPEN_STATUSES.join(',') : status,
          priority: priority === 'any' ? undefined : priority,
          assignee: assignee === 'me' ? 'me' : undefined,
          evidence_state: evidence === 'any' ? undefined : evidence,
          cursor: cursor ?? undefined,
          limit: 50,
        },
        { signal },
      ),
    [store?.id, channel, status, priority, assignee, evidence],
    { enabled: Boolean(store) && can('incident.read') },
  );

  // Defensive: the inbox never lists resolved incidents even if a stale page contains one.
  const filterRows = (row: IncidentSummary) => row.status !== 'resolved';

  const tzFor = (row: IncidentSummary) => row.store_timezone ?? stores.find((s) => s.id === row.store_id)?.timezone ?? timeZone;

  const columns: Column<IncidentSummary>[] = [
    { key: 'ref', header: t('Incident'), primary: true, render: (r) => <span className="mono-ish">{r.ref}</span> },
    { key: 'channel', header: t('Type'), render: (r) => <ChannelLabel channel={r.channel} /> },
    { key: 'camera', header: t('Camera'), render: (r) => r.camera_name ?? <span className="muted">{t('No camera')}</span> },
    {
      key: 'captured',
      header: t('Time'),
      render: (r) => (
        <span title={fmt.dateTime(r.captured_at, tzFor(r), { withZone: true })}>
          {fmt.time(r.captured_at, tzFor(r))} <span className="muted small">· {fmt.relative(r.captured_at)}</span>
          {r.delayed ? (
            <>
              {' '}
              <Badge tone="warning" title={t('Delivered late by the store edge (offline outbox)')}>
                {t('Delayed delivery')}
              </Badge>
            </>
          ) : null}
        </span>
      ),
    },
    { key: 'status', header: t('Status'), render: (r) => <IncidentStatusPill status={r.status} /> },
    { key: 'evidence', header: t('Evidence'), render: (r) => <EvidenceStatePill state={r.evidence_state} /> },
    { key: 'priority', header: t('Priority'), render: (r) => <PriorityPill priority={r.priority} /> },
    {
      key: 'assignee',
      header: t('Assignee'),
      render: (r) => (r.assignee ? r.assignee.display_name : <span className="muted">{t('Unassigned')}</span>),
    },
  ];

  const filtersActive = channel !== 'all' || status !== 'open' || priority !== 'any' || assignee !== 'any' || evidence !== 'any';

  if (!can('incident.read')) {
    return (
      <>
        <PageHeader screenId="web-19" />
        <PermissionDenied permission="incident.read" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        screenId="web-19"
        action={
          <Button variant="secondary" icon="refresh" onClick={q.reload}>
            {t('Refresh')}
          </Button>
        }
      />
      <div className="card">
        <Notice tone="info">
          {t('An alert counts as acknowledged only when a responder presses Acknowledge. Push delivery never acknowledges an alert.')}
        </Notice>
        <DataTable
          caption={t('Alert inbox')}
          query={q}
          filterRows={filterRows}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => screenPath('web-20', { id: r.id })}
          toolbar={
            <>
              <FilterTabs<ChannelTab>
                label={t('Alert type')}
                value={channel}
                onChange={(v) => setParam('channel', v, 'all')}
                items={[
                  { value: 'all', label: t('All types') },
                  { value: 'behavior', label: t('Behavior') },
                  { value: 'watchlist', label: t('Watchlist') },
                  { value: 'checkout', label: t('Checkout') },
                ]}
              />
              <label className="filter">
                <span className="filter-label">{t('Status')}</span>
                <Select value={status} onChange={(e) => setParam('status', e.target.value, 'open')}>
                  <option value="open">{t('All unresolved')}</option>
                  <option value="new">{t('Awaiting review')}</option>
                  <option value="acknowledged">{t('status|Acknowledged')}</option>
                  <option value="reviewing">{t('status|In review')}</option>
                </Select>
              </label>
              <label className="filter">
                <span className="filter-label">{t('Priority')}</span>
                <Select value={priority} onChange={(e) => setParam('priority', e.target.value, 'any')}>
                  <option value="any">{t('Any priority')}</option>
                  <option value="urgent">{t('priority|Urgent')}</option>
                  <option value="high">{t('priority|High')}</option>
                  <option value="normal">{t('priority|Normal')}</option>
                </Select>
              </label>
              <label className="filter">
                <span className="filter-label">{t('Assignee')}</span>
                <Select value={assignee} onChange={(e) => setParam('assignee', e.target.value, 'any')}>
                  <option value="any">{t('Anyone')}</option>
                  <option value="me">{t('Assigned to me')}</option>
                </Select>
              </label>
              <label className="filter">
                <span className="filter-label">{t('Evidence')}</span>
                <Select value={evidence} onChange={(e) => setParam('evidence', e.target.value, 'any')}>
                  <option value="any">{t('Any evidence state')}</option>
                  <option value="pending">{t('evidence|Pending upload')}</option>
                  <option value="available">{t('evidence|Available')}</option>
                  <option value="unavailable">{t('evidence|Unavailable')}</option>
                  <option value="expired">{t('evidence|Expired')}</option>
                </Select>
              </label>
              {filtersActive ? (
                <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  {t('Clear filters')}
                </Button>
              ) : null}
            </>
          }
          empty={
            filtersActive ? (
              <EmptyState compact icon="search" title={t('No alerts match these filters')} />
            ) : (
              <EmptyState
                title={t('No alerts to review')}
                description={t('There are no unresolved alerts for this store right now.')}
                action={
                  <>
                    <ButtonLink to="/web/empty">{t('Monitoring status')}</ButtonLink>{' '}
                    <ButtonLink to="/web/incidents">{t('View history')}</ButtonLink>
                  </>
                }
              />
            )
          }
        />
      </div>
    </>
  );
}
