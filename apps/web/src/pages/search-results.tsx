// web-36 Search results. GET /v1/search with the query params built by web-35 (cursor pages,
// stable captured_at+id order). The first page carries `coverage`: cameras, outages, retention
// cutoff and gaps (before_activation / outage / beyond_retention / no_cameras). An empty result
// never means "nothing happened" — coverage may be missing. Matching here is metadata only, so the
// candidate-similarity column says so instead of showing a score.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePagedQuery } from '../api/hooks';
import type { SearchCoverage } from '../api/types';
import { DataTable, type Column } from '../components/DataTable';
import { CHANNEL_LABEL, ChannelLabel, EvidenceStatePill, IncidentStatusPill, OutcomePill } from '../components/domain';
import { EVIDENCE_KEY, GAP_REASON_KEY, OUTCOME_KEY } from '../components/groupc/labels';
import { useStoreName, useStoreTimeZone } from '../components/groupc/misc';
import { PageHeader } from '../components/PageHeader';
import { Badge, ButtonLink, Card, Notice } from '../components/primitives';
import { EmptyState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import type { IncidentSummary, IncidentChannel, IncidentOutcome } from '../api/types';
import { gc, type SearchParams } from './_groupc-api';
import '../styles/group-c.css';

const KEYS: (keyof SearchParams)[] = ['from', 'to', 'store_id', 'camera_id', 'channel', 'outcome', 'assignee', 'evidence_state'];

export default function SearchResultsPage() {
  const { t, fmt } = useI18n();
  const { can, me, timeZone } = useSession();
  const [params] = useSearchParams();
  const tzFor = useStoreTimeZone();
  const storeName = useStoreName();
  const search: SearchParams = {};
  for (const k of KEYS) {
    const v = params.get(k);
    if (v) search[k] = v.slice(0, 200);
  }
  const tz = search.store_id ? tzFor(search.store_id) : me?.org.timezone ?? timeZone;
  const [coverage, setCoverage] = useState<SearchCoverage | null>(null);
  const list = usePagedQuery(
    async (cursor, signal) => {
      const page = await gc.search({ ...search, cursor, limit: 50 }, { signal });
      if (!cursor) setCoverage(page.coverage);
      return page;
    },
    [JSON.stringify(search)],
    { enabled: can('search.metadata') },
  );

  if (!can('search.metadata')) {
    return (
      <>
        <PageHeader screenId="web-36" />
        <PermissionDenied permission="search.metadata" />
      </>
    );
  }

  const cameraName = (id: string | null) => (id ? coverage?.cameras.find((c) => c.id === id)?.name ?? id : null);
  const chips: string[] = [];
  chips.push(search.store_id ? storeName(search.store_id) : t('All my stores'));
  if (search.camera_id) chips.push(`${t('Camera')}: ${cameraName(search.camera_id) ?? '…'}`);
  if (search.channel) chips.push(t(CHANNEL_LABEL[search.channel as IncidentChannel] ?? search.channel));
  if (search.outcome) chips.push(search.outcome === 'none' ? t('outcome|Not recorded') : t(OUTCOME_KEY[search.outcome as IncidentOutcome] ?? search.outcome));
  if (search.assignee) chips.push(search.assignee === 'me' ? t('Assigned to me') : search.assignee === 'none' ? t('Unassigned') : search.assignee);
  if (search.evidence_state) chips.push(`${t('Evidence')}: ${t(EVIDENCE_KEY[search.evidence_state] ?? search.evidence_state)}`);

  const columns: Column<IncidentSummary>[] = [
    {
      key: 'time',
      header: t('Timeline'),
      primary: true,
      render: (r) => (
        <span>
          {fmt.dateTime(r.captured_at, tzFor(r.store_id, r.store_timezone), { withZone: true })}
          <span className="muted small"> · {r.ref}</span>
        </span>
      ),
    },
    { key: 'type', header: t('Type'), render: (r) => <ChannelLabel channel={r.channel} /> },
    {
      key: 'similarity',
      header: t('Candidate similarity'),
      render: () => <span className="muted">{t('Not applicable — metadata match')}</span>,
    },
    { key: 'store', header: t('Store'), render: (r) => r.store_name },
    { key: 'camera', header: t('Camera'), render: (r) => r.camera_name ?? <span className="muted">{t('No camera')}</span> },
    { key: 'status', header: t('Status'), render: (r) => <IncidentStatusPill status={r.status} /> },
    { key: 'outcome', header: t('Outcome'), render: (r) => <OutcomePill outcome={r.outcome} /> },
    { key: 'evidence', header: t('Evidence availability'), render: (r) => <EvidenceStatePill state={r.evidence_state} /> },
  ];

  const gaps = coverage?.gaps ?? [];
  return (
    <>
      <PageHeader
        screenId="web-36"
        action={
          <ButtonLink to={`${screenPath('web-35')}?${params.toString()}`} icon="search">
            {t('Change search')}
          </ButtonLink>
        }
      />
      <div className="grid detail-grid gc-results-grid">
        <div className="card">
          <ul className="gc-chips" aria-label={t('Active filters')}>
            <li className="gc-chip">
              {search.from ? fmt.dateTime(search.from, tz, { withZone: true, seconds: false }) : t('Start of retention')} –{' '}
              {search.to ? fmt.dateTime(search.to, tz, { withZone: true, seconds: false }) : t('Now')}
            </li>
            {chips.map((c) => (
              <li className="gc-chip" key={c}>
                {c}
              </li>
            ))}
          </ul>
          <DataTable
            caption={t('Search results')}
            query={list}
            columns={columns}
            rowKey={(r) => r.id}
            rowHref={(r) => screenPath('web-24', { id: r.id })}
            empty={
              <EmptyState
                icon="search"
                title={t('No retained records match this search')}
                description={
                  gaps.length > 0
                    ? t('Coverage is missing for part of this period (see Coverage). Records may exist that the system could not capture or no longer keeps.')
                    : t('Coverage may still be incomplete: only events the cameras captured and the store edge reported are searchable.')
                }
              />
            }
          />
          <p className="muted small">{t('Matching is by record metadata only. Photo-based matching is not available in this deployment.')}</p>
        </div>
        <Card title={t('Coverage')}>
          {list.loading && !coverage ? (
            <p className="muted small">{t('Loading…')}</p>
          ) : coverage ? (
            <CoveragePanel coverage={coverage} timeZone={tz} cameraName={cameraName} />
          ) : (
            <p className="muted small">{t('Coverage is reported with the results.')}</p>
          )}
        </Card>
      </div>
    </>
  );
}

function CoveragePanel({
  coverage,
  timeZone,
  cameraName,
}: {
  coverage: SearchCoverage;
  timeZone: string;
  cameraName: (id: string | null) => string | null;
}) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const d = (iso: string | null) => (iso ? fmt.dateTime(iso, timeZone, { withZone: true, seconds: false }) : t('Now'));
  const searchable = coverage.cameras.filter((c) => c.activated_at !== null).length;
  return (
    <>
      <p className="small">
        {t('Searched period')}: {d(coverage.from)} – {d(coverage.to)}
      </p>
      {coverage.retention_cutoff ? (
        <p className="small">
          {t('Evidence is retained from {date}.', { date: d(coverage.retention_cutoff) })}
        </p>
      ) : null}
      <p className="small">
        {t('{n} of {total} cameras in scope have been activated for analysis.', { n: searchable, total: coverage.cameras.length })}
      </p>
      {coverage.gaps.length === 0 ? (
        <Notice tone="info">{t('No coverage gaps were reported for this period. Records still exist only for events that were detected or reported.')}</Notice>
      ) : (
        <>
          <h3 className="gc-subhead">
            {t('Coverage gaps')} <Badge tone="warning">{coverage.gaps.length}</Badge>
          </h3>
          <ul className="plain-list">
            {coverage.gaps.map((g, i) => (
              <li key={`${g.camera_id}-${g.reason}-${i}`} className="gc-gap">
                <strong>{t(GAP_REASON_KEY[g.reason] ?? g.reason)}</strong>
                {' · '}
                {g.camera_id ? cameraName(g.camera_id) : t('All cameras')}
                <br />
                <span className="small">
                  {d(g.from)} – {d(g.to)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {can('health.read') && coverage.cameras.some((c) => c.outages.length > 0) ? (
        <p className="small">
          <Link to={screenPath('web-47')}>{t('Open system health')}</Link>
        </p>
      ) : null}
    </>
  );
}
