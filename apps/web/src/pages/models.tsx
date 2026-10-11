// web-48 Model registry.
//   GET /v1/models (health.read). POST /v1/models {name, version, channel, manifest} (model.manage):
//   the manifest must come from the actual exported model and contain every MANIFEST_REQUIRED field
//   (422 manifest_incomplete lists the missing ones; sha256 must be 64 hex characters).
//   POST /v1/models/{id}/{license|validate|rollout|rollback|retire} {expected_version, status?, note?,
//   stage?, camera_id?, reason?}. Gates enforced by the API (409): license_not_cleared,
//   validation_not_passed, invalid_transition (shadow → canary(camera) → active); version_conflict.
import { useMemo, useState, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import { DataTable, type Column } from '../components/DataTable';
import { SelectField, TextAreaField, TextField, fieldErrorText } from '../components/forms';
import { MANIFEST_REQUIRED, MODEL_CHANNELS, gb, type ModelActionName, type ModelFull } from '../components/groupb/api';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Notice, StatusPill, type Tone } from '../components/primitives';
import { ConflictBanner, EmptyState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

const LICENSE: Record<string, [Tone, string]> = {
  unverified: ['warning', 'license|Unverified'],
  cleared: ['ok', 'license|Cleared'],
  restricted: ['warning', 'license|Restricted'],
  rejected: ['critical', 'license|Rejected'],
};
const VALIDATION: Record<string, [Tone, string]> = {
  not_validated: ['neutral', 'validation|Not validated'],
  passed: ['ok', 'validation|Passed'],
  failed: ['critical', 'validation|Failed'],
};
const ROLLOUT: Record<string, [Tone, string]> = {
  registered: ['neutral', 'rollout|Registered'],
  shadow: ['info', 'rollout|Shadow'],
  canary: ['info', 'rollout|Canary'],
  active: ['ok', 'rollout|Active'],
  rolled_back: ['warning', 'rollout|Rolled back'],
  retired: ['neutral', 'rollout|Retired'],
};
const NEXT_STAGE: Record<string, 'shadow' | 'canary' | 'active' | undefined> = { registered: 'shadow', shadow: 'canary', canary: 'active' };

function Pill({ map, value }: { map: Record<string, [Tone, string]>; value: string }) {
  const { t } = useI18n();
  const [tone, key] = map[value] ?? (['neutral', value] as [Tone, string]);
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

export default function ModelsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const q = useApiQuery((signal) => gb.models({ signal }), [], { enabled: can('health.read') });
  const [action, setAction] = useState<{ model: ModelFull; kind: ModelActionName } | null>(null);
  const [registering, setRegistering] = useState(false);
  const [conflict, setConflict] = useState(false);
  const manage = can('model.manage');

  if (!can('health.read')) {
    return (
      <>
        <PageHeader screenId="web-48" />
        <PermissionDenied permission="health.read" />
      </>
    );
  }

  const columns: Column<ModelFull>[] = [
    {
      key: 'model',
      header: t('Model'),
      primary: true,
      render: (m) => (
        <span>
          <strong>{m.name}</strong>
          <span className="help">
            {t(`modelch|${m.channel}`)} · <span className="mono" title={m.sha256}>{m.sha256.slice(0, 12)}…</span>
          </span>
        </span>
      ),
    },
    { key: 'version', header: t('Version'), render: (m) => <span className="mono">{m.version}</span> },
    {
      key: 'license',
      header: t('License status'),
      render: (m) => (
        <span>
          <Pill map={LICENSE} value={m.license_status} />
          {m.license_note ? <span className="help">{m.license_note}</span> : null}
        </span>
      ),
    },
    {
      key: 'validation',
      header: t('Validation'),
      render: (m) => (
        <span>
          <Pill map={VALIDATION} value={m.validation_status} />
          {m.validation_note ? <span className="help">{m.validation_note}</span> : null}
        </span>
      ),
    },
    { key: 'rollout', header: t('Rollout'), render: (m) => <Pill map={ROLLOUT} value={m.rollout_state} /> },
    ...(manage
      ? [
          {
            key: 'actions',
            header: t('Actions'),
            render: (m: ModelFull) => {
              const closed = m.rollout_state === 'retired';
              const next = NEXT_STAGE[m.rollout_state];
              return (
                <span className="gb-inline">
                  {!closed ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setAction({ model: m, kind: 'license' })}>
                        {t('License review')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setAction({ model: m, kind: 'validate' })}>
                        {t('Record validation')}
                      </Button>
                    </>
                  ) : null}
                  {next ? (
                    <Button size="sm" onClick={() => setAction({ model: m, kind: 'rollout' })}>
                      {t('Roll out to {stage}', { stage: t(ROLLOUT[next]![1]) })}
                    </Button>
                  ) : null}
                  {['shadow', 'canary', 'active'].includes(m.rollout_state) ? (
                    <Button size="sm" variant="danger" onClick={() => setAction({ model: m, kind: 'rollback' })}>
                      {t('Rollback')}
                    </Button>
                  ) : null}
                  {!closed ? (
                    <Button size="sm" variant="ghost" onClick={() => setAction({ model: m, kind: 'retire' })}>
                      {t('Retire')}
                    </Button>
                  ) : null}
                </span>
              );
            },
          } satisfies Column<ModelFull>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        screenId="web-48"
        subtitle={t('Every model needs cleared commercial rights and a passed held-out validation before it can reach cameras.')}
        action={manage ? <Button onClick={() => setRegistering(true)}>{t('Register model')}</Button> : undefined}
      />
      {conflict ? (
        <ConflictBanner
          reloading={q.fetching}
          onReload={() => {
            setConflict(false);
            q.reload();
          }}
        />
      ) : null}
      <Notice tone="info" title={t('Rollout gates')}>
        {t('Rollout requires the license status “Cleared”. Canary and active also require validation “Passed”. Stages go in order: shadow (runs without alerts) → canary (one camera) → active. Rollback and retire are recorded with a reason and sent to every edge.')}
      </Notice>
      <div className="card">
        <DataTable
          caption={t('Model registry')}
          rows={q.data?.items ?? []}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          columns={columns}
          rowKey={(m) => m.id}
          empty={
            <EmptyState
              icon="info"
              title={t('No models registered')}
              description={t('Behavior analysis stays unavailable until a model is registered from its real export manifest, licensed, validated and rolled out.')}
              action={manage ? <Button onClick={() => setRegistering(true)}>{t('Register model')}</Button> : undefined}
            />
          }
        />
      </div>
      <RegisterDialog open={registering} onClose={() => setRegistering(false)} onDone={() => { setRegistering(false); q.reload(); }} />
      <ActionDialog
        action={action}
        onClose={() => setAction(null)}
        onDone={(m) => {
          setAction(null);
          q.setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === m.id ? m : x)) } : d));
        }}
        onConflict={() => {
          setAction(null);
          setConflict(true);
          q.reload();
        }}
      />
    </>
  );
}

const GATE_TEXT: Record<string, string> = {
  license_not_cleared: 'gate|license_not_cleared',
  validation_not_passed: 'gate|validation_not_passed',
  invalid_transition: 'gate|invalid_transition',
  already_revoked: 'gate|invalid_transition',
};

function ActionDialog({
  action,
  onClose,
  onDone,
  onConflict,
}: {
  action: { model: ModelFull; kind: ModelActionName } | null;
  onClose: () => void;
  onDone: (m: ModelFull) => void;
  onConflict: () => void;
}) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [gate, setGate] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const k = action ? `${action.model.id}:${action.kind}` : null;
  if (k !== key) {
    setKey(k);
    setStatus(action?.kind === 'license' ? action.model.license_status : action?.kind === 'validate' ? action.model.validation_status : '');
    setText('');
    setCameraId('');
    setErrors({});
    setGate(null);
  }
  const stage = action ? NEXT_STAGE[action.model.rollout_state] : undefined;
  const cams = useApiQuery((signal) => endpoints.cameras.list({}, { signal }), [], { enabled: action?.kind === 'rollout' && stage === 'canary' });

  const run = useMutation(
    (body: { expected_version: number; status?: string; note?: string; stage?: string; camera_id?: string; reason?: string }) =>
      gb.modelAction(action!.model.id, action!.kind, body),
    {
      successMessage: t('Model updated'),
      onSuccess: onDone,
      onError: (e: ApiError) => {
        if (e.status === 409 && e.code === 'version_conflict') {
          onConflict();
          return true;
        }
        if (e.status === 409 && GATE_TEXT[e.code]) {
          setGate(GATE_TEXT[e.code]!);
          return true;
        }
        if (e.status === 422) {
          setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([f, v]) => [f, fieldErrorText(v, locale)])));
          return true;
        }
        return false;
      },
    },
  );

  if (!action) return null;
  const m = action.model;
  const titles: Record<ModelActionName, string> = {
    license: t('License review'),
    validate: t('Record validation'),
    rollout: stage ? t('Roll out to {stage}', { stage: t(ROLLOUT[stage]![1]) }) : t('Rollout'),
    rollback: t('Rollback'),
    retire: t('Retire'),
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const body: { expected_version: number; status?: string; note?: string; stage?: string; camera_id?: string; reason?: string } = {
      expected_version: m.version_row,
    };
    if (action.kind === 'license' || action.kind === 'validate') {
      if (!status) errs.status = t('field_error|required');
      if (text.trim().length < 3) errs.note = t('Enter a reason of at least {n} characters.', { n: 3 });
      body.status = status;
      body.note = text.trim();
    } else if (action.kind === 'rollout') {
      body.stage = stage;
      if (stage === 'canary') {
        if (!cameraId) errs.camera_id = t('field_error|required');
        body.camera_id = cameraId;
      }
      if (text.trim()) body.note = text.trim();
    } else {
      if (text.trim().length < 3) errs.reason = t('Enter a reason of at least {n} characters.', { n: 3 });
      body.reason = text.trim();
    }
    setErrors(errs);
    setGate(null);
    if (Object.keys(errs).length) return;
    void run.run(body);
  };

  return (
    <Modal open onClose={onClose} dismissible={!run.pending} title={titles[action.kind]} description={`${m.name} · ${m.version}`}>
      <form onSubmit={submit} noValidate>
        {action.kind === 'license' ? (
          <SelectField
            label={t('License status')}
            required
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={Object.entries(LICENSE).map(([v, [, label]]) => ({ value: v, label: t(label) }))}
            error={errors.status}
          />
        ) : null}
        {action.kind === 'validate' ? (
          <SelectField
            label={t('Validation')}
            required
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={Object.entries(VALIDATION).map(([v, [, label]]) => ({ value: v, label: t(label) }))}
            error={errors.status}
          />
        ) : null}
        {action.kind === 'rollout' && stage === 'canary' ? (
          <SelectField
            label={t('Canary camera')}
            required
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
            placeholder={cams.loading ? t('Loading…') : t('Select a camera')}
            options={(cams.data?.items ?? []).map((c) => ({ value: c.id, label: [c.name, c.location].filter(Boolean).join(' · ') }))}
            error={errors.camera_id}
            hint={t('The model runs on this one camera first. Watch its reviewed outcomes before going active.')}
          />
        ) : null}
        {action.kind === 'rollout' ? (
          <p className="muted small">
            {stage === 'shadow'
              ? t('Shadow mode runs the model on the edges without raising alerts, so its output can be compared with reviewed incidents.')
              : stage === 'active'
                ? t('Active replaces the current model for this channel on every paired edge.')
                : null}
          </p>
        ) : null}
        <TextAreaField
          label={action.kind === 'license' || action.kind === 'validate' ? t('Notes') : action.kind === 'rollout' ? t('Notes (optional)') : t('Reason')}
          required={action.kind !== 'rollout'}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={errors.note ?? errors.reason}
          hint={
            action.kind === 'license'
              ? t('Record the evidence for code, weights and data licenses.')
              : action.kind === 'validate'
                ? t('Reference the held-out validation report (dataset, metrics, date).')
                : t('Recorded in the audit log with your name.')
          }
        />
        {gate ? (
          <Notice tone="warning" title={t('This step is not allowed yet')}>
            {t(gate)}
          </Notice>
        ) : null}
        {run.error && run.error.status !== 409 && run.error.status !== 422 ? (
          <div className="field-error" role="alert">
            {t(errorMessageKey(run.error))}
          </div>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={run.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" variant={action.kind === 'rollback' || action.kind === 'retire' ? 'danger' : 'primary'} pending={run.pending}>
            {titles[action.kind]}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RegisterDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [channel, setChannel] = useState('behavior');
  const [manifest, setManifest] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [missing, setMissing] = useState<string[]>([]);

  const parsed = useMemo(() => {
    if (!manifest.trim()) return null;
    try {
      const v: unknown = JSON.parse(manifest);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : 'invalid';
    } catch {
      return 'invalid' as const;
    }
  }, [manifest]);

  const register = useMutation(
    (body: { name: string; version: string; channel: string; manifest: Record<string, unknown> }) => gb.registerModel(body),
    {
      successMessage: t('Model registered'),
      onSuccess: () => {
        setName('');
        setVersion('');
        setManifest('');
        setMissing([]);
        onDone();
      },
      onError: (e) => {
        if (e.status === 422) {
          const fe = e.fieldErrors;
          setMissing(Object.keys(fe).filter((k) => k.startsWith('manifest.') && fe[k] === 'required').map((k) => k.slice(9)));
          setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, fieldErrorText(v, locale)])));
          return true;
        }
        if (e.status === 409) {
          setErrors({ version: t('This model version is already registered.') });
          return true;
        }
        return false;
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t('field_error|required');
    if (!version.trim()) errs.version = t('field_error|required');
    if (parsed === null) errs.manifest = t('Paste the manifest JSON exported with the model.');
    else if (parsed === 'invalid') errs.manifest = t('The manifest is not a valid JSON object.');
    const miss = parsed && parsed !== 'invalid' ? MANIFEST_REQUIRED.filter((k) => parsed[k] === undefined || parsed[k] === null || parsed[k] === '') : [];
    setMissing(miss);
    if (miss.length) errs.manifest = t('The manifest is missing {n} required fields.', { n: miss.length });
    setErrors(errs);
    if (Object.keys(errs).length || !parsed || parsed === 'invalid') return;
    void register.run({ name: name.trim(), version: version.trim(), channel, manifest: parsed });
  };

  return (
    <Modal open={open} onClose={onClose} dismissible={!register.pending} size="lg" title={t('Register model')} description={t('Register a model from the manifest produced by its actual export. Nothing is rolled out by registering.')}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField label={t('Model')} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <TextField label={t('Version')} required maxLength={60} value={version} onChange={(e) => setVersion(e.target.value)} error={errors.version} />
          <SelectField
            label={t('Channel')}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            options={MODEL_CHANNELS.map((c) => ({ value: c, label: t(`modelch|${c}`) }))}
            error={errors.channel}
          />
        </div>
        <TextAreaField
          label={t('Manifest (JSON)')}
          required
          rows={10}
          className="gb-manifest"
          spellCheck={false}
          value={manifest}
          onChange={(e) => setManifest(e.target.value)}
          error={errors.manifest ?? errors['manifest.sha256'] ?? null}
          hint={t('Required fields: {fields}', { fields: MANIFEST_REQUIRED.join(', ') })}
        />
        {missing.length ? (
          <Notice tone="critical" title={t('Missing manifest fields')}>
            <ul className="gb-chips">
              {missing.map((m) => (
                <li key={m}>
                  <Badge tone="critical">{m}</Badge>
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={register.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={register.pending}>
            {t('Register model')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
