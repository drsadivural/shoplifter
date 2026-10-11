// web-08 Connect edge appliance.
//   POST /v1/stores/{id}/edge-pairing-codes {device_name} -> {code, expires_at} (single use, 15 min).
//   The code is shown once with a live expiry countdown and the appliance install command.
//   GET /v1/edges?store_id= lists paired appliances (fingerprint, state, last seen, software version);
//   POST /v1/edges/{id}/revoke {reason} revokes one (ConfirmDialog, reason recorded in the audit log).
import { useEffect, useState, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import { TextField, fieldErrorText } from '../components/forms';
import { gb, type EdgeFull } from '../components/groupb/api';
import { ReviewCard, StoreSelect, Unset, useScopedStore } from '../components/groupb/ui';
import { ConfirmDialog } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, Notice, StatusPill } from '../components/primitives';
import { EmptyState, ErrorState, LoadingState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

interface IssuedCode {
  code: string;
  expires_at: string;
  device_name: string;
  store_name: string;
}

export default function EdgePairPage() {
  const { t, locale } = useI18n();
  const { can, stores } = useSession();
  const scoped = useScopedStore();
  const [storeId, setStoreId] = useState(scoped.store?.id ?? '');
  const [deviceName, setDeviceName] = useState('');
  const [errors, setErrors] = useState<{ store?: string | null; device_name?: string | null }>({});
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const store = stores.find((s) => s.id === storeId);
  useEffect(() => {
    if (!storeId && scoped.store) setStoreId(scoped.store.id);
  }, [storeId, scoped.store]);

  const create = useMutation(
    (v: { storeId: string; device_name: string }) => endpoints.stores.createPairingCode(v.storeId, { device_name: v.device_name }),
    {
      successMessage: t('Pairing code created'),
      onSuccess: (r) => setIssued({ ...r, device_name: deviceName.trim(), store_name: store?.name ?? '' }),
      onError: (e: ApiError) => {
        if (e.status === 422) {
          setErrors({ device_name: fieldErrorText(e.fieldErrors.device_name, locale) });
          return true;
        }
        return false;
      },
    },
  );

  if (!can('edge.manage')) {
    return (
      <>
        <PageHeader screenId="web-08" />
        <PermissionDenied permission="edge.manage" />
      </>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!storeId) next.store = t('field_error|required');
    if (!deviceName.trim()) next.device_name = t('field_error|required');
    setErrors(next);
    if (Object.keys(next).length) return;
    setIssued(null);
    void create.run({ storeId, device_name: deviceName.trim() });
  };

  return (
    <>
      <PageHeader screenId="web-08" subtitle={t('Pair the store appliance that analyzes video locally. Codes are single use and expire after 15 minutes.')} />
      <div className="grid gb-form-layout">
        <Card title={t('Connect edge appliance')}>
          <form onSubmit={submit} noValidate>
            <div className="form-grid">
              <StoreSelect
                value={storeId}
                onChange={(id) => {
                  setStoreId(id);
                  setIssued(null);
                  setErrors((x) => ({ ...x, store: null }));
                }}
                error={errors.store}
              />
              <TextField
                label={t('Device name')}
                required
                maxLength={120}
                value={deviceName}
                onChange={(e) => {
                  setDeviceName(e.target.value);
                  setErrors((x) => ({ ...x, device_name: null }));
                }}
                error={errors.device_name}
                hint={t('A name staff will recognize, for example “Back office rack 1”.')}
              />
            </div>
            <div className="action-row">
              <Button type="submit" pending={create.pending}>
                {issued ? t('Generate a new code') : t('Generate pairing code')}
              </Button>
            </div>
          </form>
          {issued ? <PairingCode issued={issued} /> : null}
        </Card>
        <ReviewCard
          items={[
            { label: t('Pairing code'), value: issued ? <span className="mono">{issued.code}</span> : <Unset /> },
            { label: t('Store'), value: store?.name ?? <Unset /> },
            { label: t('Device name'), value: deviceName.trim() || <Unset /> },
          ]}
        >
          <Notice tone="info">
            {t('After pairing, compare the certificate fingerprint printed by the appliance with the one listed below before adding cameras.')}
          </Notice>
        </ReviewCard>
      </div>
      {storeId ? <PairedEdges storeId={storeId} timeZone={store?.timezone ?? scoped.timeZone} watching={issued !== null} /> : null}
    </>
  );
}

function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

function PairingCode({ issued }: { issued: IssuedCode }) {
  const { t, fmt } = useI18n();
  const now = useNow(1000);
  const remaining = Math.max(0, Math.round((Date.parse(issued.expires_at) - now) / 1000));
  const expired = remaining === 0;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const command = `retailguard-edge pair --api ${origin} --code ${issued.code} --name "${issued.device_name.replace(/"/g, '\\"')}"`;
  return (
    <section className="gb-stack" aria-labelledby="pairing-code-title" aria-live="polite">
      <h3 id="pairing-code-title" className="gb-section-title">
        {t('Pairing code')}
      </h3>
      {expired ? (
        <Notice tone="critical" title={t('This code has expired')}>
          {t('Generate a new code. Expired codes cannot pair an appliance.')}
        </Notice>
      ) : (
        <>
          <div>
            <span className="gb-code" data-testid="pairing-code">
              {issued.code}
            </span>
          </div>
          <p>
            <Badge tone={remaining < 120 ? 'warning' : 'info'}>{t('Expires in {time}', { time: fmt.duration(remaining) })}</Badge>{' '}
            <span className="muted small">{t('Shown only once. It is not stored in readable form and cannot be displayed again.')}</span>
          </p>
          <ol className="gb-steps-list">
            <li>{t('Install the RetailGuard edge software on the store appliance and connect it to the camera network.')}</li>
            <li>
              {t('On the appliance, run:')}
              <pre className="gb-pre">{command}</pre>
            </li>
            <li>{t('The appliance prints its certificate fingerprint. Check that it matches the new entry in the list below.')}</li>
          </ol>
        </>
      )}
    </section>
  );
}

function PairedEdges({ storeId, timeZone, watching }: { storeId: string; timeZone: string; watching: boolean }) {
  const { t, fmt } = useI18n();
  const q = useApiQuery((signal) => gb.edges(storeId, { signal }), [storeId], { pollMs: watching ? 10_000 : 30_000 });
  const [target, setTarget] = useState<EdgeFull | null>(null);
  const revoke = useMutation((reason: string) => endpoints.edges.revoke(target!.id, { reason }), {
    successMessage: t('Edge appliance revoked'),
    onSuccess: () => q.reload(),
    // 409 already_revoked: refresh the list; the toast explains what happened.
    onError: (e) => {
      if (e.status === 409) q.reload();
      return false;
    },
  });
  const items = q.data?.items ?? [];
  return (
    <Card title={t('Paired edge appliances')} className="gb-section">
      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <LoadingState variant="table" rows={2} />
      ) : items.length === 0 ? (
        <EmptyState
          compact
          icon="wifiOff"
          title={t('No edge appliance paired')}
          description={t('Generate a pairing code and run the pair command on the appliance. It appears here after it connects.')}
        />
      ) : (
        <div className="gb-table-wrap">
          <table className="gb-table">
            <caption className="visually-hidden">{t('Paired edge appliances')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Device name')}</th>
                <th scope="col">{t('Certificate fingerprint')}</th>
                <th scope="col">{t('Status')}</th>
                <th scope="col">{t('Last seen')}</th>
                <th scope="col">{t('Software version')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.name}</strong>
                  </td>
                  <td className="mono small">{e.fingerprint}</td>
                  <td>
                    <StatusPill tone={e.state === 'online' ? 'ok' : e.state === 'revoked' ? 'neutral' : 'critical'}>
                      {e.state === 'online' ? t('edge|Online') : e.state === 'revoked' ? t('edge|Revoked') : t('edge|Offline')}
                    </StatusPill>
                  </td>
                  <td>{e.last_seen_at ? fmt.dateTime(e.last_seen_at, timeZone, { withZone: true }) : t('never')}</td>
                  <td>{e.software_version || '—'}</td>
                  <td>
                    {e.state !== 'revoked' ? (
                      <Button size="sm" variant="danger" onClick={() => setTarget(e)}>
                        {t('Revoke')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={t('Revoke edge appliance')}
        description={target ? t('{name} will be disconnected immediately. Its queued commands expire and its cameras stop analysis until another appliance is paired.', { name: target.name }) : undefined}
        confirmLabel={t('Revoke')}
        confirmVariant="danger"
        pending={revoke.pending}
        error={revoke.error ? t(errorMessageKey(revoke.error)) : null}
        onConfirm={async (reason) => (await revoke.run(reason)).ok}
      />
    </Card>
  );
}
