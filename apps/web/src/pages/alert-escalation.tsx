// web-22 Escalation policy for the selected store.
//   GET/PUT /v1/stores/{id}/policies/escalation {expected_version, settings}
//   responders come from GET /v1/team?store_id (active non-viewer users of the store)
//   push privacy is fixed to "generic" by the API (no images, names or reasons in push payloads)
// With ?incident=<id> the page also escalates that incident: POST /v1/incidents/{id}/escalate.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { useApiQuery, useMutation } from '../api/hooks';
import type { StorePolicy } from '../api/types';
import { ChannelLabel, IncidentStatusPill, PriorityPill } from '../components/domain';
import { Checkbox, FormField, TextField, TextInput, Toggle } from '../components/forms';
import { EscalateIncidentForm } from '../components/groupc/EscalateIncidentForm';
import { fieldError } from '../components/groupc/labels';
import { ConflictNotice, useConflict, useStoreTimeZone } from '../components/groupc/misc';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import { gc, type EscalationSettings, type TeamMemberDuty } from './_groupc-api';
import '../styles/group-c.css';

export default function AlertEscalationPage() {
  const { t } = useI18n();
  const { store, can } = useSession();
  const [params] = useSearchParams();
  const incidentId = params.get('incident');
  const policy = useApiQuery((signal) => gc.getEscalation(store!.id, { signal }), [store?.id], { enabled: Boolean(store) });
  const team = useApiQuery((signal) => gc.team(store!.id, { signal }), [store?.id], { enabled: Boolean(store) });
  const { conflict, setConflict, onConflict } = useConflict(policy.reload);

  return (
    <>
      <PageHeader screenId="web-22" />
      {incidentId ? <IncidentEscalation incidentId={incidentId} /> : null}
      {!store ? (
        <EmptyState icon="settings" title={t('No stores assigned')} description={t('Ask an administrator to assign you to a store.')} />
      ) : (
        <>
          {conflict ? (
            <ConflictNotice
              conflict={conflict}
              currentVersion={policy.data?.version}
              reloading={policy.fetching}
              onReload={() => {
                policy.reload();
                setConflict(null);
              }}
            />
          ) : null}
          <RouteStateBoundary query={policy} permission="policy.manage">
            {(p) =>
              team.loading ? (
                <LoadingState />
              ) : team.error || !team.data ? (
                <ErrorState error={team.error} onRetry={team.reload} title={t('The team for this store could not be loaded')} />
              ) : (
                <PolicyForm
                  key={`${p.store_id}:${p.version}`}
                  storeName={store.name}
                  policy={p}
                  team={team.data.items}
                  onSaved={(np) => {
                    policy.setData(np);
                    team.reload();
                  }}
                  onConflict={onConflict}
                  canEdit={can('policy.manage')}
                />
              )
            }
          </RouteStateBoundary>
        </>
      )}
    </>
  );
}

function PolicyForm({
  storeName,
  policy,
  team,
  onSaved,
  onConflict,
  canEdit,
}: {
  storeName: string;
  policy: StorePolicy<EscalationSettings>;
  team: TeamMemberDuty[];
  onSaved: (p: StorePolicy<EscalationSettings>) => void;
  onConflict: (e: ApiError) => boolean;
  canEdit: boolean;
}) {
  const { t, fmt } = useI18n();
  const { timeZone } = useSession();
  const initial = policy.settings;
  const [primary, setPrimary] = useState<string[]>(initial.primary_responder_ids);
  const [backup, setBackup] = useState<string[]>(initial.backup_responder_ids);
  const [deadline, setDeadline] = useState(String(initial.ack_deadline_minutes));
  const [quietOn, setQuietOn] = useState(initial.quiet_hours !== null);
  const [quietStart, setQuietStart] = useState(initial.quiet_hours?.start ?? '22:00');
  const [quietEnd, setQuietEnd] = useState(initial.quiet_hours?.end ?? '07:00');
  const [submitted, setSubmitted] = useState(false);
  const reset = () => {
    setPrimary(initial.primary_responder_ids);
    setBackup(initial.backup_responder_ids);
    setDeadline(String(initial.ack_deadline_minutes));
    setQuietOn(initial.quiet_hours !== null);
    setQuietStart(initial.quiet_hours?.start ?? '22:00');
    setQuietEnd(initial.quiet_hours?.end ?? '07:00');
    setSubmitted(false);
  };
  const byId = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);
  // Saved responders that are no longer eligible (deactivated, removed from the store, now viewers).
  const missing = [...new Set([...initial.primary_responder_ids, ...initial.backup_responder_ids])].filter((id) => !byId.has(id));

  const deadlineNum = Number(deadline);
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const errors = {
    deadline: !(Number.isInteger(deadlineNum) && deadlineNum >= 1 && deadlineNum <= 240) ? t('Enter a whole number from {min} to {max}.', { min: 1, max: 240 }) : null,
    overlap: primary.some((id) => backup.includes(id)) ? t('A person cannot be both a primary and a backup responder.') : null,
    quiet: quietOn && (!hhmm.test(quietStart) || !hhmm.test(quietEnd) || quietStart === quietEnd) ? t('Enter different start and end times (HH:MM).') : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const settings: EscalationSettings = {
    primary_responder_ids: primary.filter((id) => byId.has(id)),
    backup_responder_ids: backup.filter((id) => byId.has(id)),
    ack_deadline_minutes: deadlineNum,
    quiet_hours: quietOn ? { start: quietStart, end: quietEnd } : null,
    push_privacy: 'generic',
  };
  const save = useMutation(() => gc.putEscalation(policy.store_id, policy.version, settings), {
    successMessage: t('Escalation policy saved'),
    onSuccess: onSaved,
    onError: (e) => onConflict(e) || e.status === 422,
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (valid) await save.run(undefined);
  };
  const fe = save.fieldErrors;
  const toggle = (list: string[], setList: (v: string[]) => void, id: string, on: boolean) =>
    setList(on ? [...list, id] : list.filter((x) => x !== id));

  const responderList = (label: string, hint: string, list: string[], setList: (v: string[]) => void, name: string) => (
    <fieldset className="gc-radio-group">
      <legend>{label}</legend>
      <p className="help">{hint}</p>
      {team.length === 0 ? (
        <p className="muted small">{t('No eligible responders are assigned to this store. Invite users or assign them to the store first.')}</p>
      ) : (
        team.map((m) => (
          <Checkbox
            key={`${name}-${m.id}`}
            label={`${m.display_name} · ${t(`role|${m.role}`)}`}
            checked={list.includes(m.id)}
            onChange={(e) => toggle(list, setList, m.id, e.target.checked)}
          />
        ))
      )}
    </fieldset>
  );

  return (
    <div className="grid detail-grid">
      <Card title={t('Escalation policy')}>
        <form onSubmit={submit} noValidate className="gc-form">
          {responderList(
            t('Primary responders'),
            t('Notified when an alert is escalated, together with backup responders.'),
            primary,
            setPrimary,
            'primary',
          )}
          <TextField
            label={t('Acknowledgement deadline')}
            type="number"
            inputMode="numeric"
            min={1}
            max={240}
            required
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            hint={t('Minutes. An alert nobody acknowledges within this time is escalated automatically and its priority is raised.')}
            error={(submitted ? errors.deadline : null) ?? fieldError(t, fe.ack_deadline_minutes ?? fe['settings.ack_deadline_minutes'])}
          />
          {responderList(
            t('Backup responders'),
            t('If neither list has anyone, escalations go to the store’s administrators.'),
            backup,
            setBackup,
            'backup',
          )}
          {(submitted && errors.overlap) || fe.responder_ids ? (
            <div className="field-error gc-group-error" role="alert">
              {(submitted ? errors.overlap : null) ?? fieldError(t, fe.responder_ids)}
            </div>
          ) : null}
          <Toggle
            label={t('Quiet hours')}
            checked={quietOn}
            onChange={setQuietOn}
            hint={t('Recorded with the policy in the store timezone. Note: alert delivery does not pause for quiet hours yet — escalations are still sent.')}
          />
          {quietOn ? (
            <div className="form-grid">
              <FormField label={t('Start')} error={submitted ? errors.quiet : null}>
                {(p) => <TextInput {...p} type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />}
              </FormField>
              <FormField label={t('End')}>{(p) => <TextInput {...p} type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />}</FormField>
            </div>
          ) : null}
          <div className="toggle-row">
            <div>
              <span className="toggle-label">{t('Push privacy')}</span>
              <div className="help">
                {t('Always generic. Push notifications say only that an alert needs review — never images, names, reasons or store details. This cannot be changed.')}
              </div>
            </div>
            <strong>{t('Generic text only')}</strong>
          </div>
          {canEdit ? (
            <div className="gc-form-actions">
              <Button type="submit" pending={save.pending}>
                {t('Save')}
              </Button>
              <Button variant="secondary" onClick={reset} disabled={save.pending}>
                {t('Cancel')}
              </Button>
            </div>
          ) : null}
        </form>
      </Card>
      <Card title={t('Configuration scope')}>
        <KeyValueList
          items={[
            { label: t('Store'), value: storeName },
            { label: t('Timezone'), value: timeZone },
            { label: t('Current version'), value: policy.version === 0 ? t('Default (never saved)') : policy.version },
            {
              label: t('Last updated'),
              value: policy.updated_at ? fmt.dateTime(policy.updated_at, timeZone, { withZone: true }) : t('Never'),
            },
          ]}
        />
        {policy.version === 0 ? (
          <Notice tone="info">{t('This store uses the default policy: a 5-minute acknowledgement deadline and no named responders. Save to set it explicitly.')}</Notice>
        ) : null}
        {missing.length > 0 ? (
          <Notice tone="warning">
            {t('{n} saved responders are no longer eligible for this store (deactivated, reassigned or viewer role). Saving removes them.', { n: missing.length })}
          </Notice>
        ) : null}
        <h3 className="gc-subhead">{t('Who is on duty')}</h3>
        {team.length === 0 ? (
          <p className="muted small">{t('No eligible responders.')}</p>
        ) : (
          <ul className="gc-list">
            {team.map((m) => (
              <li key={m.id}>
                <span className="gc-list-title">{m.display_name}</span>
                <span className="muted small">
                  {t(`role|${m.role}`)} · {m.duty === 'primary' ? t('Primary responders') : m.duty === 'backup' ? t('Backup responders') : t('Not on the escalation list')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">{t('Changes are recorded in the audit log.')}</p>
      </Card>
    </div>
  );
}

function IncidentEscalation({ incidentId }: { incidentId: string }) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const q = useApiQuery((signal) => gc.incident(incidentId, { signal }), [incidentId]);
  const { conflict, setConflict, onConflict } = useConflict(q.reload);
  const tzFor = useStoreTimeZone();
  const [done, setDone] = useState(false);
  useEffect(() => setDone(false), [incidentId]);
  return (
    <div className="gc-incident-escalation">
      {conflict ? (
        <ConflictNotice
          conflict={conflict}
          currentVersion={q.data?.version}
          reloading={q.fetching}
          onReload={() => {
            q.reload();
            setConflict(null);
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="incident.read" loading={<LoadingState variant="inline" />}>
        {(incident) => (
          <Card title={t('Escalate incident {ref}', { ref: incident.ref })}>
            <KeyValueList
              items={[
                { label: t('Type'), value: <ChannelLabel channel={incident.channel} /> },
                { label: t('Store'), value: incident.store_name },
                { label: t('Captured'), value: fmt.dateTime(incident.captured_at, tzFor(incident.store_id, incident.store_timezone), { withZone: true }) },
                { label: t('Status'), value: <IncidentStatusPill status={incident.status} /> },
                { label: t('Priority'), value: <PriorityPill priority={incident.priority} /> },
              ]}
            />
            {done ? <Notice tone="info">{t('Escalated. Primary and backup responders are being notified.')}</Notice> : null}
            {incident.status === 'resolved' ? (
              <p className="muted">{t('Resolved incidents must be reopened before they can be escalated.')}</p>
            ) : can('incident.respond') ? (
              <EscalateIncidentForm
                incident={incident}
                onUpdated={(i) => {
                  q.setData(i);
                  setDone(true);
                }}
                onConflict={onConflict}
              />
            ) : (
              <p className="muted">{t('Your role cannot escalate incidents.')}</p>
            )}
            <p className="small">
              <Link to={screenPath('web-24', { id: incident.id })}>{t('Open incident workspace')}</Link>
            </p>
          </Card>
        )}
      </RouteStateBoundary>
    </div>
  );
}
