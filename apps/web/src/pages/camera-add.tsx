// web-12 Add camera manually. POST /v1/cameras {store_id, name, location, address, username?, password?,
// stream_profile, rtsp_path?}. The address must be a literal private IP inside the store's permitted
// camera subnets (422 ip_address_required / address_not_permitted / duplicate shown inline).
// 409 edge_required: credentials need a paired edge (they are sealed to it); the camera can be saved
// without credentials instead. The password is never echoed and is cleared after each attempt.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useMutation } from '../api/hooks';
import type { Camera } from '../api/types';
import { TextField, fieldErrorText } from '../components/forms';
import { CredentialFields, EdgeRequiredNotice } from '../components/groupb/camera-forms';
import { ReviewCard, StoreSelect, Unset, WizardSteps, useScopedStore } from '../components/groupb/ui';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, Notice } from '../components/primitives';
import { PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

type Body = Parameters<typeof endpoints.cameras.create>[0];

export default function CameraAddPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { can, stores } = useSession();
  const scoped = useScopedStore();
  const [storeId, setStoreId] = useState(scoped.store?.id ?? '');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [rtspPath, setRtspPath] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<Camera['stream_profile']>('substream');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [edgeRequired, setEdgeRequired] = useState(false);

  const create = useMutation((body: Body) => endpoints.cameras.create(body), {
    successMessage: t('Camera added — waiting for the edge readiness check'),
    onSuccess: (c) => navigate(screenPath('web-15', { id: c.id })),
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
  });

  if (!can('camera.manage')) {
    return (
      <>
        <PageHeader screenId="web-12" />
        <PermissionDenied permission="camera.manage" />
      </>
    );
  }

  const send = (withCredentials: boolean) => {
    const next: Record<string, string> = {};
    if (!storeId) next.store_id = t('field_error|required');
    if (!name.trim()) next.name = t('field_error|required');
    if (!address.trim()) next.address = t('field_error|required');
    if (rtspPath.trim() && !rtspPath.trim().startsWith('/')) next.rtsp_path = t('Start the path with “/”, for example /Streaming/Channels/102.');
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: Body = {
      store_id: storeId,
      name: name.trim(),
      location: location.trim(),
      address: address.trim(),
      stream_profile: profile,
      rtsp_path: rtspPath.trim() || undefined,
    };
    if (withCredentials && (username || password)) {
      body.username = username;
      body.password = password;
    }
    if (!withCredentials) {
      setUsername('');
      setPassword('');
    }
    setEdgeRequired(false);
    void create.run(body);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(true);
  };
  const store = stores.find((s) => s.id === storeId);

  return (
    <>
      <PageHeader screenId="web-12" subtitle={t('Add a camera by its IP address when discovery cannot reach it.')} />
      <WizardSteps current={2} />
      <div className="grid gb-form-layout">
        <Card title={t('Add camera manually')}>
          <form onSubmit={submit} noValidate autoComplete="off">
            <div className="form-grid">
              <TextField label={t('Camera name')} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
              <StoreSelect value={storeId} onChange={setStoreId} error={errors.store_id} />
              <TextField
                label={t('Device address')}
                required
                maxLength={100}
                inputMode="decimal"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setErrors((x) => ({ ...x, address: null }));
                }}
                error={errors.address}
                placeholder="192.168.10.21"
                hint={t('Private IP address on the store camera network. Host names are not accepted.')}
              />
              <TextField
                label={t('Location')}
                maxLength={120}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                error={errors.location}
                placeholder={t('e.g. Cosmetics aisle')}
              />
              <CredentialFields
                username={username}
                password={password}
                onUsername={setUsername}
                onPassword={setPassword}
                profile={profile}
                onProfile={setProfile}
                errors={errors}
              />
              <TextField
                label={t('RTSP path (optional)')}
                maxLength={200}
                value={rtspPath}
                onChange={(e) => setRtspPath(e.target.value)}
                error={errors.rtsp_path}
                placeholder="/Streaming/Channels/102"
                hint={t('Only for cameras without ONVIF. The edge looks up the stream itself when ONVIF is available.')}
              />
            </div>
            {edgeRequired ? (
              <>
                <EdgeRequiredNotice storeId={storeId} />
                <div className="action-row">
                  <Button variant="secondary" onClick={() => send(false)} pending={create.pending}>
                    {t('Save without credentials')}
                  </Button>
                </div>
              </>
            ) : null}
            <div className="action-row">
              <Button type="submit" pending={create.pending}>
                {t('Add camera')}
              </Button>
              <ButtonLink to={screenPath('web-14')}>{t('Cancel')}</ButtonLink>
            </div>
          </form>
        </Card>
        <ReviewCard
          items={[
            { label: t('Camera name'), value: name.trim() || <Unset /> },
            { label: t('Store'), value: store?.name ?? <Unset /> },
            { label: t('Device address'), value: address.trim() ? <span className="mono">{address.trim()}</span> : <Unset /> },
            { label: t('Username'), value: username || <Unset /> },
            { label: t('Password'), value: password ? t('Entered (hidden)') : <Unset /> },
            { label: t('Stream profile'), value: profile === 'substream' ? t('Substream') : t('Main stream') },
          ]}
        >
          <Notice tone="info">{t('The camera stays “Pending checks” until the store edge decodes at least 10 seconds of real video. Analysis is never started automatically.')}</Notice>
        </ReviewCard>
      </div>
    </>
  );
}
