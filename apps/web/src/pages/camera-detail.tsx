// web-15 Camera readiness (`?id=`). GET /v1/cameras/{id} (+ commands, outages, edge), polled every 10 s.
//   Run readiness check -> POST /v1/cameras/{id}/provision (503 edge_unavailable explained)
//   Start analysis      -> POST /v1/cameras/{id}/activate {expected_version, channels}
//                          409 camera_not_ready: only after the edge verified ≥10 s of decoded frames.
//   Pause analysis      -> POST /v1/cameras/{id}/pause {expected_version}
// Analysis is "analyzing" only after the edge reports running channels — never because of this button.
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import type { DetectionChannel } from '../api/types';
import { AnalysisStatePill, ReadinessPill } from '../components/domain';
import { Checkbox } from '../components/forms';
import { gb, type CameraDetail } from '../components/groupb/api';
import {
  COMMAND_KIND_LABEL,
  ChannelStatePill,
  CommandStatusPill,
  DETECTION_CHANNELS,
  DETECTION_CHANNEL_LABEL,
  FreshnessPill,
  WizardSteps,
  channelStateOf,
} from '../components/groupb/ui';
import { AuthenticatedImage } from '../components/media';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, KeyValueList, Notice, StatusPill } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState, UnavailableNotice } from '../components/states';
import { hasTranslation, useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

export default function CameraDetailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  const { stores } = useSession();
  const q = useApiQuery((signal) => gb.camera(id!, { signal }), [id], { enabled: Boolean(id), pollMs: 10_000 });
  const [conflict, setConflict] = useState(false);
  const cam = q.data;
  const storeName = cam ? stores.find((s) => s.id === cam.store_id)?.name : undefined;

  if (!id) {
    return (
      <>
        <PageHeader screenId="web-15" />
        <EmptyState
          icon="cameras"
          title={t('No camera selected')}
          description={t('Open a camera from the camera inventory.')}
          action={<ButtonLink to={screenPath('web-14')}>{t('Camera inventory')}</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        screenId="web-15"
        subtitle={cam ? [cam.name, cam.location, storeName].filter(Boolean).join(' · ') : undefined}
      />
      <WizardSteps current={cam?.readiness === 'ready' ? 4 : 3} />
      {conflict ? (
        <ConflictBanner
          currentVersion={cam?.version}
          reloading={q.fetching}
          onReload={() => {
            setConflict(false);
            q.reload();
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="camera.read">
        {(data) => (
          <CameraReady
            cam={data}
            reload={q.reload}
            onConflict={() => {
              setConflict(true);
              q.reload();
            }}
          />
        )}
      </RouteStateBoundary>
    </>
  );
}

function CameraReady({ cam, reload, onConflict }: { cam: CameraDetail; reload: () => void; onConflict: () => void }) {
  const { t, fmt } = useI18n();
  const { can, stores } = useSession();
  const tz = stores.find((s) => s.id === cam.store_id)?.timezone ?? 'UTC';
  const manage = can('camera.manage');
  const [activateOpen, setActivateOpen] = useState(false);
  const [edgeDown, setEdgeDown] = useState<ApiError | null>(null);
  const report = cam.readiness_report;
  const running = cam.analysis_state === 'analyzing' || cam.analysis_state === 'activation_requested' || cam.analysis_state === 'degraded';

  const handle503 = (e: ApiError) => {
    if (e.status === 503) {
      setEdgeDown(e);
      return true;
    }
    if (e.status === 409 && e.code === 'version_conflict') {
      onConflict();
      return true;
    }
    return false;
  };

  const provision = useMutation(() => gb.provision(cam.id), {
    successMessage: t('Readiness check sent to the store edge'),
    onSuccess: () => {
      setEdgeDown(null);
      reload();
    },
    onError: handle503,
  });
  const pause = useMutation(() => gb.pause(cam.id, { expected_version: cam.version }), {
    successMessage: t('Pause requested — the edge stops analysis when it receives the command'),
    onSuccess: () => {
      setEdgeDown(null);
      reload();
    },
    onError: handle503,
  });

  const label = cam.location ? `${cam.location} · ${cam.name}` : cam.name;
  const chip = (k: string, v: ReactNode) => (
    <li className="gb-chip" key={k}>
      {k} · <b>{v}</b>
    </li>
  );

  return (
    <>
      {edgeDown ? (
        <UnavailableNotice code={edgeDown.code}>
          {t('The store edge appliance is offline or not paired, so this command cannot be delivered. Nothing was changed.')}
        </UnavailableNotice>
      ) : null}
      <Card title={t('Live preview')} titleAddon={<FreshnessPill at={cam.last_frame_at} />}>
        {cam.snapshot ? (
          <div className="feed">
            <AuthenticatedImage mediaId={cam.snapshot.media_id} alt={t('Latest verified frame from {camera}', { camera: label })} />
            <span className="feed-label">{label}</span>
            <span className="feed-time">{fmt.dateTime(cam.snapshot.captured_at, tz, { withZone: true })}</span>
          </div>
        ) : (
          <div className="feed feed-empty" role="status">
            <div>
              <p className="feed-empty-title">{t('No verified frame yet')}</p>
              <p className="muted small">{t('A snapshot appears after the store edge connects to the camera and verifies decoded video.')}</p>
            </div>
          </div>
        )}
        <p className="muted small">{t('Snapshots are uploaded by the store edge with privacy masks applied. The stream address and credentials never leave the store.')}</p>
      </Card>

      <Card title={t('Readiness report')} titleAddon={<ReadinessPill readiness={cam.readiness} />} className="gb-section">
        {report ? (
          <>
            <ul className="gb-chips">
              {chip(t('Resolution'), report.width && report.height ? `${report.width} × ${report.height}` : t('not reported'))}
              {chip(t('Frame rate'), report.fps ? `${fmt.number(report.fps)} fps` : t('not reported'))}
              {chip(t('Codec'), report.codec || t('not reported'))}
              {chip(t('Decoded sample'), typeof report.decoded_seconds === 'number' ? fmt.duration(report.decoded_seconds) : t('not reported'))}
              {chip(t('Monotonic timestamps'), report.monotonic_time === true ? t('Yes') : report.monotonic_time === false ? t('No') : t('not reported'))}
              {chip(t('Pose visibility'), t('Not measured yet'))}
            </ul>
            <KeyValueList
              items={[
                { label: t('Checked at'), value: report.checked_at ? fmt.dateTime(report.checked_at, tz, { withZone: true }) : '—' },
                ...(report.profile_token ? [{ label: t('ONVIF profile'), value: <span className="mono">{report.profile_token}</span> }] : []),
                { label: t('Stream profile'), value: cam.stream_profile === 'substream' ? t('Substream') : t('Main stream') },
                { label: t('Device'), value: [cam.vendor, cam.model].filter(Boolean).join(' ') || t('not reported') },
              ]}
            />
            {report.errors?.length ? (
              <Notice tone="critical" title={t('Problems reported by the edge')}>
                <ul className="plain-list mono small">
                  {report.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
          </>
        ) : (
          <EmptyState
            compact
            icon="video"
            title={t('No readiness report yet')}
            description={t('The store edge has not checked this stream yet. Run a readiness check once an edge appliance is online.')}
          />
        )}
        <p className="muted small">
          {t('Pose visibility (hands and torso in view) is not measured automatically yet. Check the preview before starting behavior analysis.')}
        </p>
        <KeyValueList
          items={[
            { label: t('Device address'), value: <span className="mono">{cam.address}</span> },
            { label: t('Credentials'), value: cam.has_credentials ? t('Stored on the edge (encrypted)') : t('None stored') },
            {
              label: t('Edge appliance'),
              value: cam.edge ? (
                <span className="gb-inline">
                  {cam.edge.name}
                  <StatusPill tone={cam.edge.state === 'online' ? 'ok' : cam.edge.state === 'revoked' ? 'neutral' : 'critical'}>
                    {cam.edge.state === 'online' ? t('edge|Online') : cam.edge.state === 'revoked' ? t('edge|Revoked') : t('edge|Offline')}
                  </StatusPill>
                </span>
              ) : (
                t('Not assigned')
              ),
            },
            { label: t('Version'), value: cam.version },
          ]}
        />
        {manage ? (
          <div className="action-row">
            <Button variant="secondary" icon="refresh" onClick={() => void provision.run(undefined)} pending={provision.pending}>
              {t('Run readiness check')}
            </Button>
            <ButtonLink to={screenPath('web-16', { id: cam.id })}>{t('Edit detection zones')}</ButtonLink>
          </div>
        ) : null}
      </Card>

      <Card title={t('Analysis')} titleAddon={<AnalysisStatePill state={cam.analysis_state} />} className="gb-section">
        <ul className="rows">
          {DETECTION_CHANNELS.map((ch) => {
            const s = channelStateOf(cam.channels?.[ch]);
            return (
              <li className="row" key={ch}>
                <div className="row-main">
                  <strong>{t(DETECTION_CHANNEL_LABEL[ch])}</strong>
                  {s.reason ? <div className="help">{reasonText(t, s.reason)}</div> : null}
                </div>
                <ChannelStatePill value={s} />
              </li>
            );
          })}
        </ul>
        {cam.activated_at ? (
          <p className="muted small">
            {t('Analysis first started')}: {fmt.dateTime(cam.activated_at, tz, { withZone: true })}
          </p>
        ) : null}
        {manage ? (
          <div className="action-row">
            {cam.readiness === 'ready' && !running ? (
              <Button onClick={() => setActivateOpen(true)}>{t('Start analysis')}</Button>
            ) : null}
            {running ? (
              <Button variant="secondary" onClick={() => void pause.run(undefined)} pending={pause.pending}>
                {t('Pause analysis')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {cam.readiness !== 'ready' ? (
          <Notice tone="info">{t('Analysis can start only after the store edge has verified decoded frames from this camera (readiness “Ready”).')}</Notice>
        ) : null}
      </Card>

      <div className="grid gb-section">
        <Card title={t('Command history')}>
          {cam.commands.length === 0 ? (
            <p className="muted">{t('No commands sent to the edge for this camera yet.')}</p>
          ) : (
            <div className="gb-table-wrap">
              <table className="gb-table">
                <caption className="visually-hidden">{t('Command history')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Command')}</th>
                    <th scope="col">{t('Status')}</th>
                    <th scope="col">{t('Sent')}</th>
                    <th scope="col">{t('Completed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cam.commands.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {t(COMMAND_KIND_LABEL[c.kind] ?? c.kind)}
                        {c.error ? <div className="help mono">{c.error}</div> : null}
                      </td>
                      <td>
                        <CommandStatusPill status={c.status} />
                      </td>
                      <td>{fmt.dateTime(c.created_at, tz)}</td>
                      <td>{c.completed_at ? fmt.dateTime(c.completed_at, tz) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={t('Outages')}>
          {cam.outages.length === 0 ? (
            <p className="muted">{t('No outages recorded since the camera became ready.')}</p>
          ) : (
            <ul className="rows">
              {cam.outages.map((o, i) => (
                <li className="row" key={`${o.started_at}-${i}`}>
                  <div className="row-main">
                    <strong>{fmt.dateTime(o.started_at, tz, { withZone: true })}</strong>
                    <div className="help">
                      {o.ended_at ? `${t('Recovered')}: ${fmt.dateTime(o.ended_at, tz, { withZone: true })}` : t('Ongoing')}
                    </div>
                  </div>
                  <Badge tone={o.ended_at ? 'neutral' : 'critical'}>{o.reason === 'offline' ? t('readiness|Offline') : o.reason === 'degraded' ? t('readiness|Degraded') : (o.reason ?? '—')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="muted small">
        <Link to={screenPath('web-14')}>{t('Back to camera inventory')}</Link>
      </p>
      <ActivateDialog
        open={activateOpen}
        cam={cam}
        onClose={() => setActivateOpen(false)}
        onDone={() => {
          setActivateOpen(false);
          reload();
        }}
        onConflict={() => {
          setActivateOpen(false);
          onConflict();
        }}
      />
    </>
  );
}

function reasonText(t: (k: string) => string, reason: string): string {
  const key = `chreason|${reason}`;
  return hasTranslation('en', key) ? t(key) : reason;
}

function ActivateDialog({
  open,
  cam,
  onClose,
  onDone,
  onConflict,
}: {
  open: boolean;
  cam: CameraDetail;
  onClose: () => void;
  onDone: () => void;
  onConflict: () => void;
}) {
  const { t } = useI18n();
  const [channels, setChannels] = useState<DetectionChannel[]>(['behavior']);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const activate = useMutation(() => gb.activate(cam.id, { expected_version: cam.version, channels }), {
    successMessage: t('Start requested — analysis begins when the store edge confirms the channels are running'),
    onSuccess: onDone,
    onError: (e) => {
      if (e.status === 409 && e.code === 'camera_not_ready') {
        setNotReady(true);
        return true;
      }
      if (e.status === 409) {
        onConflict();
        return true;
      }
      if (e.status === 503) {
        setInlineError(t('The store edge appliance is offline or not paired. Analysis cannot start until it is online.'));
        return true;
      }
      return false;
    },
  });
  const toggle = (ch: DetectionChannel, on: boolean) => setChannels((c) => (on ? [...new Set([...c, ch])] : c.filter((x) => x !== ch)));
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!activate.pending}
      title={t('Start analysis')}
      description={t('Choose the detection channels for {camera}. Each channel starts only if its model or SDK is installed and licensed on the edge; otherwise it stays unavailable.', { camera: cam.name })}
    >
      <fieldset className="gb-fieldset">
        <legend className="gb-label">{t('Detection channels')}</legend>
        {DETECTION_CHANNELS.map((ch) => (
          <Checkbox
            key={ch}
            label={t(DETECTION_CHANNEL_LABEL[ch])}
            hint={t(`chhint|${ch}`)}
            checked={channels.includes(ch)}
            onChange={(e) => toggle(ch, e.target.checked)}
          />
        ))}
      </fieldset>
      {channels.length === 0 ? <div className="field-error">{t('Select at least one channel.')}</div> : null}
      {notReady ? (
        <Notice tone="warning" title={t('Camera is not ready')}>
          {t('Analysis can start only after the store edge has verified decoded frames from this camera. Run a readiness check and wait for “Ready”.')}
        </Notice>
      ) : null}
      {inlineError ? (
        <div className="field-error" role="alert">
          {inlineError}
        </div>
      ) : null}
      {activate.error && !notReady && !inlineError && activate.error.status !== 409 ? (
        <div className="field-error" role="alert">
          {t(errorMessageKey(activate.error))}
        </div>
      ) : null}
      <div className="modal-foot">
        <Button variant="secondary" onClick={onClose} disabled={activate.pending}>
          {t('Cancel')}
        </Button>
        <Button
          onClick={() => {
            if (channels.length === 0) return;
            setInlineError(null);
            setNotReady(false);
            void activate.run(undefined);
          }}
          pending={activate.pending}
        >
          {t('Start analysis')}
        </Button>
      </div>
    </Modal>
  );
}
