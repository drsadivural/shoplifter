// web-40 POS, RFID & VMS integrations.
//   GET   /v1/integrations                      list (status: configured / receiving / stale)
//   POST  /v1/integrations                      create -> webhook_secret shown ONCE
//   PATCH /v1/integrations/{id}                 name / config with expected_version
//   POST  /v1/integrations/{id}/rotate-secret   new secret shown ONCE
//   POST  /v1/integrations/{id}/test            reports whether signed events arrived recently
// No vendor-specific connector is bundled; systems send signed events to the webhook
// (HMAC-SHA256 over "{timestamp}.{nonce}.{body}" with X-RG-Timestamp / X-RG-Nonce / X-RG-Signature).
import { useEffect, useState, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, toApiError, useApiQuery, useMutation } from '../api/hooks';
import type { Id } from '../api/types';
import { DataTable, type Column } from '../components/DataTable';
import { FormField, Select, SelectField, TextField, TextInput } from '../components/forms';
import { fieldError, INTEGRATION_KIND_KEY, INTEGRATION_STATUS } from '../components/groupc/labels';
import { ConflictNotice, CopyButton, useConflict, useStoreName, useStoreTimeZone } from '../components/groupc/misc';
import { ConfirmDialog, Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, Notice, StatusPill } from '../components/primitives';
import { EmptyState, ErrorState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';
import { gc, type IntegrationKind, type IntegrationRecord, type IntegrationTestResult } from './_groupc-api';
import '../styles/group-c.css';

const KINDS: IntegrationKind[] = ['pos', 'rfid', 'vms'];

export default function IntegrationsPage() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const q = useApiQuery((signal) => gc.integrations({ signal }), [], { enabled: can('integration.manage') });
  const { conflict, setConflict, onConflict } = useConflict(q.reload);
  const storeName = useStoreName();
  const tzFor = useStoreTimeZone();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<IntegrationRecord | null>(null);
  const [rotating, setRotating] = useState<IntegrationRecord | null>(null);
  const [secret, setSecret] = useState<{ name: string; secret: string; url: string } | null>(null);
  const [tests, setTests] = useState<Record<Id, IntegrationTestResult | ApiError>>({});

  const [testingId, setTestingId] = useState<Id | null>(null);
  const test = useMutation(
    (i: IntegrationRecord) => {
      setTestingId(i.id);
      return gc.testIntegration(i.id).then(
        (r) => ({ id: i.id, r }),
        (e: unknown) => {
          setTests((m) => ({ ...m, [i.id]: toApiError(e) }));
          throw e;
        },
      );
    },
    {
      onSuccess: ({ id, r }) => setTests((m) => ({ ...m, [id]: r })),
      onError: () => true,
    },
  );
  const rotate = useMutation((i: IntegrationRecord) => gc.rotateSecret(i.id).then((r) => ({ i, r })), {
    successMessage: t('Signing secret rotated'),
    onSuccess: ({ i, r }) => {
      setRotating(null);
      setSecret({ name: i.name, secret: r.webhook_secret, url: i.webhook_url });
      q.reload();
    },
  });

  if (!can('integration.manage')) {
    return (
      <>
        <PageHeader screenId="web-40" />
        <PermissionDenied permission="integration.manage" />
      </>
    );
  }

  const columns: Column<IntegrationRecord>[] = [
    {
      key: 'name',
      header: t('Name'),
      primary: true,
      render: (i) => (
        <span>
          <strong>{i.name}</strong>
          {i.config.vendor ? <span className="muted small"> · {i.config.vendor}</span> : null}
        </span>
      ),
    },
    { key: 'kind', header: t('Type'), render: (i) => t(INTEGRATION_KIND_KEY[i.kind] ?? i.kind) },
    { key: 'store', header: t('Store'), render: (i) => storeName(i.store_id) },
    {
      key: 'status',
      header: t('Status'),
      render: (i) => {
        const [tone, key] = INTEGRATION_STATUS[i.status] ?? INTEGRATION_STATUS.configured!;
        return <StatusPill tone={tone}>{t(key)}</StatusPill>;
      },
    },
    {
      key: 'heartbeat',
      header: t('Last heartbeat'),
      render: (i) => (i.last_event_at ? fmt.dateTime(i.last_event_at, tzFor(i.store_id), { withZone: true }) : <span className="muted">{t('none received')}</span>),
    },
    {
      key: 'config',
      header: t('Lanes · clock offset'),
      render: (i) => (
        <span className="small">
          {t('{n} lanes', { n: Object.keys(i.config.lane_map ?? {}).length })} ·{' '}
          {i.config.clock_offset_ms === null || i.config.clock_offset_ms === undefined ? t('Not configured') : `${i.config.clock_offset_ms} ms`}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('Actions'),
      render: (i) => {
        const r = tests[i.id];
        return (
          <div className="gc-stack gc-row-actions">
            <span className="gc-inline">
              <Button size="sm" variant="secondary" onClick={() => void test.run(i)} pending={test.pending && testingId === i.id}>
                {t('Test connection')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                {t('Edit')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRotating(i)}>
                {t('Rotate secret')}
              </Button>
            </span>
            {r ? (
              'ok' in r ? (
                <span className="small" role="status">
                  <StatusPill tone={r.ok ? 'ok' : 'warning'}>{r.ok ? t('Receiving signed events') : t('No recent signed events')}</StatusPill>{' '}
                  {t('{n} events in the last 10 minutes', { n: r.events_last_10_min })}
                </span>
              ) : (
                <span className="field-error small">{t(errorMessageKey(r))}</span>
              )
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        screenId="web-40"
        action={
          <Button icon="upload" onClick={() => setCreating(true)}>
            {t('Add integration')}
          </Button>
        }
      />
      {conflict ? (
        <ConflictNotice
          conflict={conflict}
          reloading={q.loading}
          onReload={() => {
            q.reload();
            setConflict(null);
          }}
        />
      ) : null}
      <Notice tone="info" title={t('No vendor-specific connector is bundled')}>
        {t('POS, RFID and VMS systems connect by sending signed events to the integration’s webhook. Configure your vendor’s middleware or a small relay to sign requests as described below.')}
      </Notice>
      <div className="grid detail-grid gc-section">
        <div className="card">
          <DataTable
            caption={t('Integrations')}
            rows={q.data?.items ?? []}
            loading={q.loading}
            error={q.error}
            onRetry={q.reload}
            columns={columns}
            rowKey={(i) => i.id}
            mode="cards"
            empty={
              <EmptyState
                icon="settings"
                title={t('No integrations yet')}
                description={t('Add a POS connector to reconcile checkout exceptions with scans and payments. Without one, checkout comparisons stay unavailable.')}
                action={<Button onClick={() => setCreating(true)}>{t('Add integration')}</Button>}
              />
            }
          />
        </div>
        <WebhookInstructions sampleUrl={q.data?.items[0]?.webhook_url} />
      </div>
      <IntegrationForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(i, s) => {
          setCreating(false);
          if (s) setSecret({ name: i.name, secret: s, url: i.webhook_url });
          q.reload();
        }}
        onConflict={onConflict}
      />
      <IntegrationForm
        open={editing !== null}
        existing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          q.reload();
        }}
        onConflict={(e) => (onConflict(e) ? (setEditing(null), true) : false)}
      />
      <ConfirmDialog
        open={rotating !== null}
        onClose={() => setRotating(null)}
        title={t('Rotate signing secret')}
        description={t('The current secret stops working immediately. Update the connector with the new secret right away, or its events will be rejected.')}
        confirmLabel={t('Rotate secret')}
        confirmVariant="danger"
        requireReason={false}
        pending={rotate.pending}
        error={rotate.error ? t(errorMessageKey(rotate.error)) : null}
        onConfirm={async () => (rotating ? (await rotate.run(rotating)).ok : true)}
      />
      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title={t('Signing secret for {name}', { name: secret?.name ?? '' })}
        description={t('This secret is shown only once. Store it in the connector’s secure configuration now; it cannot be displayed again. Rotate it if it is lost.')}
        footer={<Button onClick={() => setSecret(null)}>{t('I have stored the secret')}</Button>}
      >
        {secret ? (
          <>
            <p className="small">
              <strong>{t('Signing secret')}</strong>
            </p>
            <div className="gc-secret" data-testid="webhook-secret">
              {secret.secret}
            </div>
            <CopyButton text={secret.secret} label={t('Copy secret')} />
            <p className="small">
              <strong>{t('Webhook URL')}</strong>
            </p>
            <div className="gc-secret">{secret.url}</div>
            <CopyButton text={secret.url} label={t('Copy URL')} />
          </>
        ) : null}
      </Modal>
    </>
  );
}

function WebhookInstructions({ sampleUrl }: { sampleUrl?: string }) {
  const { t } = useI18n();
  const example = `POST ${sampleUrl ?? '/v1/integrations/{id}/webhook'}
X-RG-Timestamp: 1791700938
X-RG-Nonce: 5f2c9a7e1b3d4c6a8e0f
X-RG-Signature: hex(HMAC-SHA256(secret, "{timestamp}.{nonce}.{body}"))
Content-Type: application/json

{"events":[{"kind":"scan","occurred_at":"2026-10-11T01:42:18.120Z",
  "lane":"L1","transaction_id":"T-0001","barcode":"4901234567890",
  "item_count":1,"amount":398}]}`;
  return (
    <Card title={t('Signed webhook')}>
      <ol className="gc-steps small">
        <li>{t('Send events as JSON to the integration’s webhook URL: {"events": [...]}, 1–500 events and at most 1 MB per request.')}</li>
        <li>{t('Event kinds: scan, void, refund, suspend, payment and heartbeat. occurred_at must be an RFC 3339 timestamp.')}</li>
        <li>{t('X-RG-Timestamp: Unix time in seconds. Requests more than 5 minutes from server time are rejected.')}</li>
        <li>{t('X-RG-Nonce: a random value of 16–128 characters, used once. Replayed nonces are rejected.')}</li>
        <li>{t('X-RG-Signature: lowercase hex HMAC-SHA256 of "{timestamp}.{nonce}.{body}" using the signing secret, where body is the exact request bytes.')}</li>
        <li>{t('Send a heartbeat event at least every few minutes so the console can show whether telemetry is live.')}</li>
      </ol>
      <pre className="gc-code">{example}</pre>
      <p className="muted small">{t('Lane IDs in events must match the lane map so scans can be aligned with the right checkout camera.')}</p>
    </Card>
  );
}

interface LaneRow {
  lane: string;
  camera: string;
}

function IntegrationForm({
  open,
  existing,
  onClose,
  onSaved,
  onConflict,
}: {
  open: boolean;
  existing?: IntegrationRecord | null;
  onClose: () => void;
  onSaved: (i: IntegrationRecord, secret?: string) => void;
  onConflict: (e: ApiError) => boolean;
}) {
  const { t } = useI18n();
  const { stores, store } = useSession();
  const [storeId, setStoreId] = useState('');
  const [kind, setKind] = useState<IntegrationKind>('pos');
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('');
  const [offset, setOffset] = useState('');
  const [lanes, setLanes] = useState<LaneRow[]>([]);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    if (existing) {
      setStoreId(existing.store_id);
      setKind(existing.kind);
      setName(existing.name);
      setVendor(existing.config.vendor ?? '');
      setOffset(existing.config.clock_offset_ms === null || existing.config.clock_offset_ms === undefined ? '' : String(existing.config.clock_offset_ms));
      setLanes(Object.entries(existing.config.lane_map ?? {}).map(([lane, camera]) => ({ lane, camera })));
    } else {
      setStoreId(store?.id ?? '');
      setKind('pos');
      setName('');
      setVendor('');
      setOffset('');
      setLanes([]);
    }
  }, [open, existing, store?.id]);
  const cameras = useApiQuery((signal) => endpoints.cameras.list({ store_id: storeId, limit: 100 }, { signal }), [storeId], {
    enabled: open && Boolean(storeId),
  });

  const offsetNum = Number(offset);
  const laneKeys = lanes.map((l) => l.lane.trim());
  const errors = {
    store: !storeId ? t('Select a store.') : null,
    name: !name.trim() ? t('Enter a name.') : null,
    offset: offset !== '' && !(Number.isInteger(offsetNum) && Math.abs(offsetNum) <= 600_000) ? t('Enter whole milliseconds between -600000 and 600000.') : null,
    lanes: lanes.some((l) => !l.lane.trim() || !l.camera)
      ? t('Every lane needs an ID and a camera.')
      : new Set(laneKeys).size !== laneKeys.length
        ? t('Lane IDs must be unique.')
        : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const config = {
    lane_map: Object.fromEntries(lanes.map((l) => [l.lane.trim(), l.camera])),
    clock_offset_ms: offset === '' ? null : offsetNum,
    vendor: vendor.trim() || null,
  };
  const save = useMutation(
    async (): Promise<{ i: IntegrationRecord; secret?: string }> => {
      if (existing) {
        const i = await gc.updateIntegration(existing.id, { expected_version: existing.version, name: name.trim(), config });
        return { i };
      }
      const created = await gc.createIntegration({ store_id: storeId, kind, name: name.trim(), config });
      return { i: created, secret: created.webhook_secret };
    },
    {
      successMessage: existing ? t('Integration saved') : t('Integration created'),
      onSuccess: ({ i, secret }) => onSaved(i, secret),
      onError: (e) => onConflict(e) || e.status === 422,
    },
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (valid) await save.run(undefined);
  };
  const fe = save.fieldErrors;
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? t('Edit integration') : t('Add integration')}
      size="lg"
      dismissible={!save.pending}
    >
      <form onSubmit={submit} noValidate className="gc-form">
        <div className="form-grid">
          {existing ? (
            <TextField label={t('Store')} value={stores.find((s) => s.id === storeId)?.name ?? storeId} readOnly />
          ) : (
            <SelectField
              label={t('Store')}
              required
              value={storeId}
              onChange={(e) => {
                setStoreId(e.target.value);
                setLanes([]);
              }}
              placeholder={t('Select a store')}
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
              error={show('store') ?? fieldError(t, fe.store_id)}
            />
          )}
          {existing ? (
            <TextField label={t('Type')} value={t(INTEGRATION_KIND_KEY[kind] ?? kind)} readOnly />
          ) : (
            <SelectField
              label={t('Type')}
              required
              value={kind}
              onChange={(e) => setKind(e.target.value as IntegrationKind)}
              options={KINDS.map((k) => ({ value: k, label: t(INTEGRATION_KIND_KEY[k]!) }))}
              error={fieldError(t, fe.kind)}
            />
          )}
          <TextField label={t('Name')} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} error={show('name') ?? fieldError(t, fe.name)} />
          <TextField
            label={t('Vendor (optional)')}
            maxLength={80}
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            hint={t('For your reference only; no vendor-specific logic is applied.')}
          />
          <TextField
            label={t('Clock offset (ms)')}
            type="number"
            inputMode="numeric"
            step={1}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            hint={t('Measured difference between the connector clock and store time. Leave blank if not measured.')}
            error={show('offset') ?? fieldError(t, fe['config.clock_offset_ms'])}
          />
        </div>
        <fieldset className="gc-radio-group">
          <legend>{t('Lane → camera map')}</legend>
          <p className="help">{t('Map each lane ID used in events to the camera that watches that lane.')}</p>
          {!storeId ? (
            <p className="muted small">{t('Select a store first.')}</p>
          ) : cameras.error ? (
            <ErrorState error={cameras.error} onRetry={cameras.reload} compact title={t('Cameras could not be loaded')} />
          ) : (
            <>
              {lanes.map((l, idx) => (
                <div className="gc-lane-row" key={idx}>
                  <FormField label={t('Lane ID')}>
                    {(p) => (
                      <TextInput
                        {...p}
                        maxLength={40}
                        value={l.lane}
                        onChange={(e) => setLanes((ls) => ls.map((x, j) => (j === idx ? { ...x, lane: e.target.value } : x)))}
                      />
                    )}
                  </FormField>
                  <FormField label={t('Camera')}>
                    {(p) => (
                      <Select {...p} value={l.camera} onChange={(e) => setLanes((ls) => ls.map((x, j) => (j === idx ? { ...x, camera: e.target.value } : x)))}>
                        <option value="">{t('Select a camera')}</option>
                        {(cameras.data?.items ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.location ? ` · ${c.location}` : ''}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <Button variant="ghost" size="sm" onClick={() => setLanes((ls) => ls.filter((_, j) => j !== idx))} aria-label={t('Remove lane {lane}', { lane: l.lane || String(idx + 1) })}>
                    {t('Remove')}
                  </Button>
                </div>
              ))}
              {cameras.data && cameras.data.items.length === 0 ? (
                <p className="muted small">{t('This store has no cameras yet. Add cameras before mapping lanes.')}</p>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setLanes((ls) => [...ls, { lane: '', camera: '' }])}>
                  {t('Add lane')}
                </Button>
              )}
            </>
          )}
          {show('lanes') || fe['config.lane_map'] ? <div className="field-error">{show('lanes') ?? fieldError(t, fe['config.lane_map'])}</div> : null}
        </fieldset>
        {save.error && save.error.status !== 422 && save.error.status !== 409 ? (
          <div className="field-error" role="alert">
            {t(errorMessageKey(save.error))}
          </div>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={save.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={save.pending}>
            {existing ? t('Save') : t('Create integration')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
