// web-11 Discover ONVIF cameras (wizard step 1 of Discover → Authenticate → Readiness → Activate).
//   POST /v1/discovery-jobs {store_id, interface, timeout_s, cidr?} -> job (queued). The store edge runs
//   a bounded WS-Discovery probe on its local network; the page polls GET /v1/discovery-jobs/{id}
//   until completed/failed and lists the devices it actually found.
//   POST /v1/discovery-jobs/{id}/add {endpoint, name, location, username, password, stream_profile}
//   creates a pending camera; the edge then checks the stream (readiness on web-15).
// 503 edge_unavailable explains edge-local discovery; the job id is kept in the URL (?job=).
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import type { Camera, DiscoveryJob } from '../api/types';
import { SelectField, TextField, fieldErrorText } from '../components/forms';
import { gb } from '../components/groupb/api';
import { CredentialFields, EdgeRequiredNotice, onvifProfiles } from '../components/groupb/camera-forms';
import { StoreSelect, WizardSteps, useScopedStore } from '../components/groupb/ui';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, Notice, Spinner } from '../components/primitives';
import { EmptyState, ErrorState, PermissionDenied, UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

type Device = DiscoveryJob['devices'][number];

const TIMEOUTS = [3, 5, 10, 15, 30];

export default function CameraDiscoveryPage() {
  const { t, locale } = useI18n();
  const { can, stores } = useSession();
  const scoped = useScopedStore();
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job');
  const [storeId, setStoreId] = useState(scoped.store?.id ?? '');
  const [iface, setIface] = useState('');
  const [timeout, setTimeoutS] = useState('5');
  const [cidr, setCidr] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [unavailable, setUnavailable] = useState<ApiError | null>(null);

  const start = useMutation(
    (body: { store_id: string; interface: string; timeout_s: number; cidr?: string }) => endpoints.discovery.start(body),
    {
      successMessage: t('Discovery started on the store edge'),
      onSuccess: (job) => {
        setUnavailable(null);
        setParams({ job: job.id, store_id: storeId }, { replace: false });
      },
      onError: (e) => {
        if (e.status === 503) {
          setUnavailable(e);
          return true;
        }
        if (e.status === 422) {
          setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, fieldErrorText(v, locale)])));
          return true;
        }
        return false;
      },
    },
  );

  if (!can('camera.manage')) {
    return (
      <>
        <PageHeader screenId="web-11" />
        <PermissionDenied permission="camera.manage" />
      </>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!storeId) next.store_id = t('field_error|required');
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(iface.trim())) next.interface = t('Enter the IPv4 address of the edge network interface, for example 192.168.10.5.');
    if (cidr.trim() && !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr.trim())) next.cidr = t('Enter a private network range such as 192.168.10.0/24, or leave it empty.');
    setErrors(next);
    if (Object.keys(next).length) return;
    void start.run({ store_id: storeId, interface: iface.trim(), timeout_s: Number(timeout), cidr: cidr.trim() || undefined });
  };

  const store = stores.find((s) => s.id === storeId);
  return (
    <>
      <PageHeader screenId="web-11" subtitle={store ? `${store.name} · ${t('Find ONVIF cameras on the store network through the edge appliance.')}` : undefined} />
      <WizardSteps current={1} />
      <div className="grid gb-form-layout">
        <Card title={t('Scan from the store LAN')}>
          <form onSubmit={submit} noValidate>
            <div className="form-grid">
              <StoreSelect value={storeId} onChange={(id) => setStoreId(id)} error={errors.store_id} />
              <TextField
                label={t('Network interface')}
                required
                inputMode="decimal"
                value={iface}
                onChange={(e) => {
                  setIface(e.target.value);
                  setErrors((x) => ({ ...x, interface: null }));
                }}
                placeholder="192.168.10.5"
                error={errors.interface}
                hint={t('IPv4 address of the edge appliance on the camera network. Probes are sent from this interface only.')}
              />
              <SelectField
                label={t('Scan timeout')}
                value={timeout}
                onChange={(e) => setTimeoutS(e.target.value)}
                options={TIMEOUTS.map((s) => ({ value: String(s), label: t('{n} seconds', { n: s }) }))}
                error={errors.timeout_s}
              />
              <TextField
                label={t('Allowed range (optional)')}
                value={cidr}
                onChange={(e) => {
                  setCidr(e.target.value);
                  setErrors((x) => ({ ...x, cidr: null }));
                }}
                placeholder="192.168.10.0/24"
                error={errors.cidr}
                hint={t('Only replies from this private range are kept.')}
              />
            </div>
            <div className="action-row">
              <Button type="submit" pending={start.pending} icon="search">
                {t('Search')}
              </Button>
              <ButtonLink to={screenPath('web-12')}>{t('Add by address instead')}</ButtonLink>
            </div>
          </form>
          <Notice tone="warning">
            {t('The store edge appliance discovers ONVIF devices on its local network. WS-Discovery uses multicast, which usually does not cross VLANs or routers: cameras on another segment will not answer. Add those by address or CSV import.')}
          </Notice>
          {unavailable ? (
            <UnavailableNotice
              code={unavailable.code}
              action={
                can('edge.manage') ? (
                  <ButtonLink size="sm" to={screenPath('web-08', { store_id: storeId })}>
                    {t('Connect edge appliance')}
                  </ButtonLink>
                ) : undefined
              }
            >
              {t('Discovery runs on the store edge appliance, not in the cloud. Pair an appliance for this store and make sure it is online, then search again. Cameras can still be added by address.')}
            </UnavailableNotice>
          ) : null}
        </Card>
        <Card title={t('Discovered devices')}>
          {jobId ? (
            <JobResults jobId={jobId} />
          ) : (
            <EmptyState compact icon="search" title={t('No scan yet')} description={t('Choose the store and interface, then search. Only devices that actually answer are listed.')} />
          )}
        </Card>
      </div>
    </>
  );
}

function JobResults({ jobId }: { jobId: string }) {
  const { t, fmt } = useI18n();
  const [polling, setPolling] = useState(true);
  const q = useApiQuery((signal) => gb.discovery(jobId, { signal }), [jobId], { pollMs: polling ? 2_000 : undefined });
  const job = q.data;
  const done = job?.status === 'completed' || job?.status === 'failed';
  if (done && polling) setPolling(false);
  const [adding, setAdding] = useState<Device | null>(null);
  const [added, setAdded] = useState<Record<string, Camera>>({});

  if (q.error && !job) return <ErrorState compact error={q.error} onRetry={q.reload} />;
  if (!job)
    return (
      <p className="gb-inline" role="status">
        <Spinner /> {t('Loading…')}
      </p>
    );

  const waitedS = job.created_at ? Math.round((Date.now() - Date.parse(job.created_at)) / 1000) : 0;
  return (
    <>
      <p className="gb-inline" role="status" aria-live="polite">
        {!done ? <Spinner /> : null}
        <Badge tone={job.status === 'completed' ? 'ok' : job.status === 'failed' ? 'critical' : 'info'}>{t(`discovery|${job.status}`)}</Badge>
        {job.completed_at ? <span className="muted small">{fmt.relative(job.completed_at)}</span> : null}
      </p>
      {!done && job.status === 'queued' && waitedS > 60 ? (
        <Notice tone="warning">{t('The store edge has not picked up this scan yet. It runs when the appliance next checks in; make sure it is online.')}</Notice>
      ) : null}
      {job.status === 'failed' ? (
        <Notice tone="critical" title={t('Discovery failed on the store edge')}>
          {job.error ?? t('The edge did not report a reason.')}
        </Notice>
      ) : null}
      {job.status === 'completed' && job.devices.length === 0 ? (
        <EmptyState
          compact
          icon="search"
          title={t('No ONVIF devices answered')}
          description={t('Check that ONVIF discovery is enabled on the cameras and that they are on the same network segment as the selected interface. Otherwise add cameras by address.')}
        />
      ) : null}
      {job.devices.length > 0 ? (
        <ul className="rows">
          {job.devices.map((d) => {
            const profiles = onvifProfiles(d.scopes);
            const cam = added[d.endpoint];
            return (
              <li className="row" key={d.endpoint}>
                <div className="row-main">
                  <strong>{[d.vendor, d.model].filter(Boolean).join(' ') || t('ONVIF device')}</strong>
                  <div className="help">
                    {t('IP address')}: <span className="mono">{d.address}</span> · {t('ONVIF profile')}:{' '}
                    {profiles.length ? profiles.join(', ') : t('not reported')}
                  </div>
                  <div className="help mono">{d.endpoint}</div>
                </div>
                {cam ? (
                  <Link className="link-sm" to={screenPath('web-15', { id: cam.id })}>
                    {t('Check readiness')}
                  </Link>
                ) : d.already_added ? (
                  <Badge tone="neutral">{t('Already added')}</Badge>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setAdding(d)}>
                    {t('Add')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <AddDiscoveredDialog
        jobId={jobId}
        storeId={job.store_id}
        device={adding}
        onClose={() => setAdding(null)}
        onAdded={(d, c) => {
          setAdded((m) => ({ ...m, [d.endpoint]: c }));
          setAdding(null);
        }}
      />
    </>
  );
}

function AddDiscoveredDialog({
  jobId,
  storeId,
  device,
  onClose,
  onAdded,
}: {
  jobId: string;
  storeId?: string;
  device: Device | null;
  onClose: () => void;
  onAdded: (d: Device, c: Camera) => void;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<Camera['stream_profile']>('substream');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [edgeRequired, setEdgeRequired] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (device && openFor !== device.endpoint) {
    setOpenFor(device.endpoint);
    setName([device.vendor, device.model].filter(Boolean).join(' ') || '');
    setLocation('');
    setUsername('');
    setPassword('');
    setErrors({});
    setEdgeRequired(false);
  }
  if (!device && openFor !== null) setOpenFor(null);

  const add = useMutation(
    (d: Device) =>
      endpoints.discovery.add(jobId, { endpoint: d.endpoint, name: name.trim(), location: location.trim(), username, password, stream_profile: profile }),
    {
      successMessage: t('Camera added — waiting for the edge readiness check'),
      onSuccess: (c) => {
        setPassword('');
        if (device) onAdded(device, c);
      },
      onError: (e) => {
        setPassword('');
        if (e.status === 409 && e.code === 'edge_required') {
          setEdgeRequired(true);
          return true;
        }
        if (e.status === 422) {
          setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, fieldErrorText(v, locale)])));
          return true;
        }
        return false;
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!device) return;
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('field_error|required');
    setErrors(next);
    if (Object.keys(next).length) return;
    void add.run(device);
  };

  return (
    <Modal
      open={device !== null}
      onClose={onClose}
      dismissible={!add.pending}
      title={t('Add discovered camera')}
      description={device ? `${device.address} · ${device.endpoint}` : undefined}
    >
      <form onSubmit={submit} noValidate>
        <TextField label={t('Camera name')} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} data-autofocus />
        <TextField label={t('Location')} maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} error={errors.location} placeholder={t('e.g. Cosmetics aisle')} />
        <CredentialFields
          username={username}
          password={password}
          onUsername={setUsername}
          onPassword={setPassword}
          profile={profile}
          onProfile={setProfile}
          errors={errors}
        />
        {edgeRequired ? <EdgeRequiredNotice storeId={storeId} /> : null}
        {add.error && add.error.status !== 422 && !edgeRequired ? (
          <div className="field-error" role="alert">
            {t(errorMessageKey(add.error))}
          </div>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={add.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={add.pending}>
            {t('Add camera')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
