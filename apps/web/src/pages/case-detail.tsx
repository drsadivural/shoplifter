// web-26 Case investigation (?id=). GET /v1/cases/{id} (each view is recorded in the access log).
//   link incident:   POST   /v1/cases/{id}/incidents {incident_id}   (find by reference via GET /v1/incidents?q=)
//   unlink incident: DELETE /v1/cases/{id}/incidents/{incident_id}
//   notes:           POST   /v1/cases/{id}/notes
//   close / reopen:  POST   /v1/cases/{id}/close|reopen {expected_version, reason}
// Evidence manifest = the case's exports with per-file SHA-256 and the bundle hash.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, useMutation } from '../api/hooks';
import { useApiQuery } from '../api/hooks';
import type { ApiError } from '../api/client';
import type { IncidentSummary } from '../api/types';
import { ChannelLabel, IncidentStatusPill, OutcomePill } from '../components/domain';
import { TextInput } from '../components/forms';
import { ActivityTimeline, NotesPanel } from '../components/groupc/Activity';
import { ExportsManifest } from '../components/groupc/ExportsManifest';
import { CaseStatusPill, ConflictNotice, useConflict, useStoreName, useStoreTimeZone } from '../components/groupc/misc';
import { ConfirmDialog } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, KeyValueList, StatusPill } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState, ErrorState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import { gc, type CaseDetailFull } from './_groupc-api';
import '../styles/group-c.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CaseDetailPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const [params] = useSearchParams();
  const id = params.get('id');
  const q = useApiQuery((signal) => gc.getCase(id!, { signal }), [id], { enabled: Boolean(id) });
  const { conflict, setConflict, onConflict } = useConflict(q.reload);

  if (!id) {
    return (
      <>
        <PageHeader screenId="web-26" />
        <EmptyState
          icon="cases"
          title={t('No case selected')}
          description={t('Open a case from case management.')}
          action={<ButtonLink to={screenPath('web-25')}>{t('Open case management')}</ButtonLink>}
        />
      </>
    );
  }
  const c = q.data;
  return (
    <>
      <PageHeader
        screenId="web-26"
        subtitle={c ? `${c.ref} · ${c.title}` : undefined}
        action={
          c && can('export.create') ? (
            <ButtonLink to={screenPath('web-42', { case: c.id })} icon="upload">
              {t('Generate export')}
            </ButtonLink>
          ) : undefined
        }
      />
      {conflict ? (
        <ConflictNotice
          conflict={conflict}
          currentVersion={c?.version}
          reloading={q.fetching}
          onReload={() => {
            q.reload();
            setConflict(null);
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="case.read">
        {(data) => <CaseReady data={data} onUpdated={(d) => q.setData(d)} onConflict={onConflict} />}
      </RouteStateBoundary>
    </>
  );
}

function CaseReady({
  data,
  onUpdated,
  onConflict,
}: {
  data: CaseDetailFull;
  onUpdated: (d: CaseDetailFull) => void;
  onConflict: (e: ApiError) => boolean;
}) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const tz = useStoreTimeZone()(data.store_id);
  const storeName = useStoreName();
  const manage = can('case.manage');
  const open = data.status === 'open';
  const [dialog, setDialog] = useState<null | 'close' | 'reopen'>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<IncidentSummary | null>(null);

  const status = useMutation(
    (a: { action: 'close' | 'reopen'; reason: string }) => gc.caseStatus(data.id, a.action, data.version, a.reason),
    {
      successMessage: (r) => (r.status === 'closed' ? t('Case closed') : t('Case reopened')),
      onSuccess: onUpdated,
      onError: (e) => (onConflict(e) ? (setDialog(null), true) : false),
    },
  );
  const unlink = useMutation((incidentId: string) => gc.unlinkIncident(data.id, incidentId), {
    successMessage: t('Incident unlinked'),
    onSuccess: onUpdated,
    onError: (e) => (onConflict(e) ? (setUnlinkTarget(null), true) : false),
  });
  const note = useMutation((body: string) => gc.caseNote(data.id, body), { successMessage: t('Note added'), onSuccess: onUpdated });

  return (
    <div className="grid detail-grid">
      <div className="gc-stack">
        <Card title={t('Linked incidents')} titleAddon={<StatusPill tone="neutral">{fmt.number(data.incidents.length)}</StatusPill>}>
          {data.incidents.length === 0 ? (
            <p className="muted">{t('No incidents are linked to this case yet.')}</p>
          ) : (
            <ul className="gc-list">
              {data.incidents.map((i) => (
                <li key={i.id}>
                  <div className="gc-list-main">
                    <Link className="gc-list-title" to={screenPath('web-24', { id: i.id })}>
                      {i.ref}
                    </Link>
                    <span className="muted small">
                      {fmt.dateTime(i.captured_at, i.store_timezone ?? tz, { withZone: true, seconds: false })} · {i.store_name} ·{' '}
                      <ChannelLabel channel={i.channel} />
                    </span>
                    <span className="gc-inline">
                      <IncidentStatusPill status={i.status} />
                      <OutcomePill outcome={i.outcome} />
                    </span>
                  </div>
                  {manage && open ? (
                    <Button variant="ghost" size="sm" onClick={() => setUnlinkTarget(i)}>
                      {t('Unlink')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {manage && open ? (
            <LinkIncident caseData={data} onLinked={onUpdated} onConflict={onConflict} />
          ) : manage ? (
            <p className="muted small">{t('Reopen the case to change linked incidents.')}</p>
          ) : null}
        </Card>
        <Card title={t('Timeline')}>
          <ActivityTimeline entries={data.timeline} timeZone={tz} />
        </Card>
        <Card title={t('Notes')}>
          <NotesPanel
            notes={data.notes}
            timeZone={tz}
            canAdd={manage}
            pending={note.pending}
            onAdd={async (body) => (await note.run(body)).ok}
          />
        </Card>
      </div>
      <div className="gc-stack">
        <Card title={t('Case')}>
          <KeyValueList
            items={[
              { label: t('Case'), value: data.ref },
              { label: t('Title'), value: <span className="gc-wrap">{data.title}</span> },
              { label: t('Status'), value: <CaseStatusPill status={data.status} /> },
              { label: t('Store'), value: storeName(data.store_id) },
              { label: t('Owner'), value: data.owner?.display_name || t('Unassigned') },
              { label: t('Created'), value: fmt.dateTime(data.created_at, tz, { withZone: true }) },
              { label: t('Last updated'), value: data.updated_at ? fmt.dateTime(data.updated_at, tz, { withZone: true }) : '—' },
              ...(data.close_reason ? [{ label: t('Close reason'), value: <span className="gc-wrap">{data.close_reason}</span> }] : []),
            ]}
          />
          {manage ? (
            <div className="action-row">
              {open ? (
                <Button variant="danger" onClick={() => setDialog('close')}>
                  {t('Close case')}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setDialog('reopen')}>
                  {t('Reopen case')}
                </Button>
              )}
            </div>
          ) : null}
          <p className="muted small">{t('Version {n}', { n: data.version })}</p>
        </Card>
        <Card title={t('Evidence manifest')}>
          <ExportsManifest exports={data.exports} timeZone={tz} />
          {can('export.create') ? (
            <ButtonLink to={screenPath('web-42', { case: data.id })} size="sm">
              {t('Generate export')}
            </ButtonLink>
          ) : null}
        </Card>
        <Card title={t('Access log')}>
          {data.access_log.length === 0 ? (
            <p className="muted small">{t('No access recorded.')}</p>
          ) : (
            <ActivityTimeline entries={data.access_log} timeZone={tz} />
          )}
          <p className="muted small">{t('Every view of this case and every export download is recorded. Showing the latest 100 entries.')}</p>
        </Card>
      </div>

      <ConfirmDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'close' ? t('Close case') : t('Reopen case')}
        description={
          dialog === 'close'
            ? t('Closing locks the linked incidents. Notes and evidence exports remain available.')
            : t('Reopening allows linked incidents to be changed again.')
        }
        confirmLabel={dialog === 'close' ? t('Close case') : t('Reopen case')}
        confirmVariant={dialog === 'close' ? 'danger' : 'primary'}
        pending={status.pending}
        error={status.error && status.error.status !== 409 ? t(errorMessageKey(status.error)) : null}
        onConfirm={async (reason) => (await status.run({ action: dialog === 'close' ? 'close' : 'reopen', reason })).ok}
      />
      <ConfirmDialog
        open={unlinkTarget !== null}
        onClose={() => setUnlinkTarget(null)}
        title={t('Unlink incident')}
        description={unlinkTarget ? t('Remove {ref} from this case? The incident and its evidence are not changed. The change is recorded in the case timeline.', { ref: unlinkTarget.ref }) : undefined}
        confirmLabel={t('Unlink')}
        confirmVariant="danger"
        requireReason={false}
        pending={unlink.pending}
        error={unlink.error && unlink.error.status !== 409 ? t(errorMessageKey(unlink.error)) : null}
        onConfirm={async () => (unlinkTarget ? (await unlink.run(unlinkTarget.id)).ok : true)}
      />
    </div>
  );
}

function LinkIncident({
  caseData,
  onLinked,
  onConflict,
}: {
  caseData: CaseDetailFull;
  onLinked: (d: CaseDetailFull) => void;
  onConflict: (e: ApiError) => boolean;
}) {
  const { t, fmt } = useI18n();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const linkedIds = new Set(caseData.incidents.map((i) => i.id));
  const isId = submitted !== null && UUID.test(submitted);
  const results = useApiQuery(
    (signal) => endpoints.incidents.list({ q: submitted!, store_id: caseData.store_id ?? undefined, limit: 10 }, { signal }),
    [submitted, caseData.store_id],
    { enabled: submitted !== null && !isId },
  );
  const link = useMutation((incidentId: string) => gc.linkIncident(caseData.id, incidentId), {
    successMessage: t('Incident linked'),
    onSuccess: (d) => {
      onLinked(d);
      setQuery('');
      setSubmitted(null);
      setTouched(false);
    },
    onError: (e) => onConflict(e) || e.status === 422 || e.status === 404,
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const v = query.trim();
    if (!v) return;
    link.reset();
    if (UUID.test(v)) {
      setSubmitted(v);
      await link.run(v);
    } else {
      setSubmitted(v);
    }
  };
  const linkError =
    link.error && link.error.status !== 409
      ? link.error.fieldErrors.incident_id === 'different_store'
        ? t('Only incidents from the case’s store can be linked.')
        : link.error.status === 404
          ? t('Incident not found or outside your stores.')
          : t(errorMessageKey(link.error))
      : null;
  return (
    <div className="gc-section">
      <h3 className="gc-subhead">{t('Link an incident')}</h3>
      <form className="gc-inline" onSubmit={submit} role="search" noValidate>
        <TextInput
          aria-label={t('Incident reference or ID')}
          placeholder={t('INC-2026-000123 or incident ID')}
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm" icon="search" pending={link.pending}>
          {t('Find')}
        </Button>
      </form>
      {touched && !query.trim() && submitted === null ? <div className="field-error">{t('Enter an incident reference or ID.')}</div> : null}
      {linkError ? (
        <div className="field-error" role="alert">
          {linkError}
        </div>
      ) : null}
      {submitted !== null && !isId ? (
        results.loading ? (
          <p className="muted small">{t('Loading…')}</p>
        ) : results.error ? (
          <ErrorState error={results.error} onRetry={results.reload} compact />
        ) : results.data && results.data.items.length === 0 ? (
          <p className="muted small">{t('No incidents match “{q}”.', { q: submitted })}</p>
        ) : (
          <ul className="gc-list">
            {results.data?.items.map((i) => (
              <li key={i.id}>
                <div className="gc-list-main">
                  <span className="gc-list-title">{i.ref}</span>
                  <span className="muted small">
                    {fmt.dateTime(i.captured_at, i.store_timezone ?? 'UTC', { withZone: true, seconds: false })} · {i.store_name}
                  </span>
                </div>
                {linkedIds.has(i.id) ? (
                  <span className="muted small">{t('Already linked')}</span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => void link.run(i.id)} pending={link.pending}>
                    {t('Link')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
