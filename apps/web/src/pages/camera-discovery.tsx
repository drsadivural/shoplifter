// web-11 Discover cameras (wizard step 1 of Discover → Authenticate → Readiness → Activate).
//   POST /v1/discovery-jobs {store_id, timeout_s} -> job (queued). The store edge sends a bounded
//   WS-Discovery probe from every private interface it has and lists the USB cameras attached to it;
//   the page polls GET /v1/discovery-jobs/{id} until completed/failed and lists what actually answered.
//   POST /v1/discovery-jobs/{id}/add {endpoint, name, location, username, password, stream_profile}
//   creates a pending camera (USB: no credentials); the edge then checks the stream (readiness on web-15).
//   Manual: POST /v1/cameras/rtsp {store_id, name, location, url, username?, password?} when ONVIF
//   discovery does not find a camera.
// 503 edge_unavailable explains edge-local discovery; the job id is kept in the URL (?job=).
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import type { Camera, DiscoveryJob } from '../api/types';
import { TextField, fieldErrorText } from '../components/forms';
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

/** Discovery probe window on the edge (seconds). */
const SCAN_TIMEOUT_S = 5;

const isUsb = (d: Device) => d.kind === 'usb';

export default function CameraDiscoveryPage() {
  const { t, locale } = useI18n();
  const { can, stores } = useSession();
  const scoped = useScopedStore().store;
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job');
  // Defaults to the store chosen in the header (or the only store); can be changed here.
  const [storeId, setStoreId] = useState(scoped?.id ?? '');
  const store = stores.find((s) => s.id === storeId);
  // ONVIF credentials are kept in memory only and used for each camera added from the results;
  // they are sealed to the store edge's key by the API and never stored readable in the cloud.
  const [onvifUser, setOnvifUser] = useState('');
  const [onvifPass, setOnvifPass] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [unavailable, setUnavailable] = useState<ApiError | null>(null);

  const start = useMutation(
    (body: { store_id: string; timeout_s: number }) => endpoints.discovery.start({ ...body, include_usb: true }),
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

  if (stores.length === 0) {
    return (
      <>
        <PageHeader screenId="web-11" />
        <WizardSteps current={1} />
        <EmptyState
          icon="cameras"
          title={t('Add a store first')}
          description={t('Cameras belong to a store, and the search runs on that store’s edge appliance. Create the store, pair its edge appliance, then come back to add cameras.')}
          action={can('store.manage') ? <ButtonLink variant="primary" to={screenPath('web-07')}>{t('Add store')}</ButtonLink> : undefined}
        />
      </>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!storeId) next.store_id = t('Select a store.');
    if (onvifPass && !onvifUser.trim()) next.onvif_username = t('Enter the ONVIF username for this password.');
    setErrors(next);
    if (Object.keys(next).length) return;
    void start.run({ store_id: storeId, timeout_s: SCAN_TIMEOUT_S });
  };

  return (
    <>
      <PageHeader screenId="web-11" subtitle={store ? `${store.name} · ${t('Find cameras on the store network and USB cameras connected to the edge appliance.')}` : undefined} />
      <WizardSteps current={1} />
      <div className="grid gb-form-layout">
        <div className="gb-stack">
          <Card title={t('Scan the store network')}>
            <form onSubmit={submit} noValidate>
              <div className="form-grid">
                <StoreSelect
                  value={storeId}
                  onChange={(id) => {
                    setStoreId(id);
                    setErrors((x) => ({ ...x, store_id: null }));
                  }}
                  error={errors.store_id}
                  hint={t('The edge appliance of this store searches its own network.')}
                />
                <TextField
                  label={t('ONVIF username')}
                  autoComplete="off"
                  maxLength={120}
                  value={onvifUser}
                  onChange={(e) => {
                    setOnvifUser(e.target.value);
                    setErrors((x) => ({ ...x, onvif_username: null }));
                  }}
                  error={errors.onvif_username}
                  hint={t('Read-only camera account. Used for the cameras you add from the results.')}
                />
                <TextField
                  label={t('ONVIF password')}
                  type="password"
                  autoComplete="new-password"
                  maxLength={256}
                  value={onvifPass}
                  onChange={(e) => setOnvifPass(e.target.value)}
                  hint={t('Encrypted to the store edge appliance. It is never shown again or stored readable in the cloud.')}
                />
              </div>
              <p className="muted small">
                {t('The edge appliance searches from all of its network connections and also lists USB cameras plugged into it.')}
              </p>
              <div className="action-row">
                <Button type="submit" pending={start.pending} icon="search">
                  {t('Search')}
                </Button>
              </div>
            </form>
            <Notice tone="warning">
              {t('WS-Discovery uses multicast, which usually does not cross VLANs or routers: cameras on another network segment will not answer. Add those with their RTSP URL below.')}
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
          <RtspCard storeId={storeId} />
        </div>
        <Card title={t('Discovered devices')}>
          {jobId ? (
            <JobResults jobId={jobId} onvifUsername={onvifUser} onvifPassword={onvifPass} />
          ) : (
            <EmptyState compact icon="search" title={t('No scan yet')} description={t('Search to list the network cameras that answer and the USB cameras connected to the edge appliance.')} />
          )}
        </Card>
      </div>
    </>
  );
}

const RTSP_URL = /^rtsps?:\/\/\S+$/i;

/** Manual add by RTSP URL, for cameras that ONVIF discovery cannot find. */
function RtspCard({ storeId }: { storeId: string }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [edgeRequired, setEdgeRequired] = useState(false);
  const [added, setAdded] = useState<Camera | null>(null);
  const urlMessages: Record<string, string> = {
    rtsp_url_required: t('Enter a URL that starts with rtsp:// or rtsps://, for example rtsp://192.168.1.20:554/stream1.'),
    ip_address_required: t('Use the camera’s IP address in the URL, not a host name.'),
    address_not_permitted: t('This address is outside the camera networks allowed for the store.'),
    invalid_rtsp_path: t('The path after the address contains characters that are not allowed.'),
    duplicate: t('A camera with this RTSP URL already exists in the store.'),
  };
  const add = useMutation(
    () =>
      endpoints.cameras.createRtsp({
        store_id: storeId,
        name: name.trim(),
        location: location.trim(),
        url: url.trim(),
        ...(username.trim() ? { username: username.trim() } : {}),
        ...(password ? { password } : {}),
      }),
    {
      successMessage: t('Camera added — waiting for the edge readiness check'),
      onSuccess: (c) => {
        setAdded(c);
        setName('');
        setLocation('');
        setUrl('');
        setPassword('');
        setErrors({});
        setEdgeRequired(false);
      },
      onError: (e) => {
        if (e.status === 409 && e.code === 'edge_required') {
          setEdgeRequired(true);
          return true;
        }
        if (e.status === 422) {
          setErrors(
            Object.fromEntries(
              Object.entries(e.fieldErrors).map(([k, v]) => [k, (k === 'url' ? urlMessages[v] : undefined) ?? fieldErrorText(v, locale)]),
            ),
          );
          return true;
        }
        return false;
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!storeId) next.url = t('Select a store.');
    if (!name.trim()) next.name = t('field_error|required');
    if (!RTSP_URL.test(url.trim())) next.url = urlMessages.rtsp_url_required!;
    if (password && !username.trim() && !/^rtsps?:\/\/[^/@]+@/i.test(url.trim())) next.username = t('Enter the username for this password.');
    setErrors(next);
    setAdded(null);
    if (Object.keys(next).length) return;
    void add.run(undefined);
  };

  return (
    <Card title={t('Add by RTSP URL (manual)')}>
      <p className="muted small">{t('Use this when the search does not find a camera. The edge appliance connects to the stream directly; ONVIF is not needed.')}</p>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField label={t('Camera name')} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <TextField label={t('Location')} maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('e.g. Cosmetics aisle')} />
          <TextField
            label={t('RTSP URL')}
            required
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            maxLength={600}
            className="mono"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setErrors((x) => ({ ...x, url: null }));
            }}
            placeholder="rtsp://192.168.1.20:554/stream1"
            error={errors.url}
            hint={t('Copy it from the camera or recorder manual. A user:password@ part is encrypted to the edge appliance and is not stored with the URL.')}
          />
          <TextField
            label={t('Username')}
            autoComplete="off"
            maxLength={120}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={errors.username}
            hint={t('Optional. Used when the URL has no user name.')}
          />
          <TextField
            label={t('Password')}
            type="password"
            autoComplete="new-password"
            maxLength={256}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t('Optional. Used when the URL has no password.')}
          />
        </div>
        {edgeRequired ? <EdgeRequiredNotice storeId={storeId} /> : null}
        {add.error && add.error.status !== 422 && !edgeRequired ? (
          <div className="field-error" role="alert">
            {t(errorMessageKey(add.error))}
          </div>
        ) : null}
        <div className="action-row">
          <Button type="submit" pending={add.pending}>
            {t('Add camera')}
          </Button>
        </div>
        {added ? (
          <Notice tone="info" title={t('{name} was added', { name: added.name })}>
            <Link to={screenPath('web-15', { id: added.id })}>{t('Check readiness')}</Link>
          </Notice>
        ) : null}
      </form>
    </Card>
  );
}

function JobResults({ jobId, onvifUsername, onvifPassword }: { jobId: string; onvifUsername: string; onvifPassword: string }) {
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
          title={t('No cameras found')}
          description={t('No network camera answered and no USB camera is connected to the edge appliance. Check that ONVIF discovery is enabled on the cameras and that they are on the same network as the appliance, or add the camera with its RTSP URL.')}
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
                  <strong>
                    {isUsb(d) ? d.model || t('USB camera') : [d.vendor, d.model].filter(Boolean).join(' ') || t('ONVIF device')}{' '}
                    <Badge tone={isUsb(d) ? 'info' : 'neutral'}>{isUsb(d) ? t('USB') : 'ONVIF'}</Badge>
                  </strong>
                  {isUsb(d) ? (
                    <div className="help">
                      {t('Connected to the edge appliance')}: <span className="mono">{d.address}</span>
                    </div>
                  ) : (
                    <>
                      <div className="help">
                        {t('IP address')}: <span className="mono">{d.address}</span> · {t('ONVIF profile')}:{' '}
                        {profiles.length ? profiles.join(', ') : t('not reported')}
                      </div>
                      <div className="help mono">{d.endpoint}</div>
                    </>
                  )}
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
        defaultUsername={onvifUsername}
        defaultPassword={onvifPassword}
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
  defaultUsername,
  defaultPassword,
  device,
  onClose,
  onAdded,
}: {
  jobId: string;
  storeId?: string;
  defaultUsername: string;
  defaultPassword: string;
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
    setName(isUsb(device) ? device.model || '' : [device.vendor, device.model].filter(Boolean).join(' ') || '');
    setLocation('');
    setUsername(defaultUsername);
    setPassword(defaultPassword);
    setErrors({});
    setEdgeRequired(false);
  }
  if (!device && openFor !== null) setOpenFor(null);

  const add = useMutation(
    (d: Device) =>
      endpoints.discovery.add(jobId, {
        endpoint: d.endpoint,
        name: name.trim(),
        location: location.trim(),
        // A USB camera is read locally by the appliance: no network account.
        username: isUsb(d) ? '' : username,
        password: isUsb(d) ? '' : password,
        stream_profile: profile,
      }),
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
      title={device && isUsb(device) ? t('Add USB camera') : t('Add discovered camera')}
      description={device ? (isUsb(device) ? device.address : `${device.address} · ${device.endpoint}`) : undefined}
    >
      <form onSubmit={submit} noValidate>
        <TextField label={t('Camera name')} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} data-autofocus />
        <TextField label={t('Location')} maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} error={errors.location} placeholder={t('e.g. Cosmetics aisle')} />
        {device && isUsb(device) ? (
          <p className="muted small">{t('The edge appliance reads this camera directly over USB. No user name or password is needed.')}</p>
        ) : (
          <CredentialFields
            username={username}
            password={password}
            onUsername={setUsername}
            onPassword={setPassword}
            profile={profile}
            onProfile={setProfile}
            errors={errors}
          />
        )}
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
