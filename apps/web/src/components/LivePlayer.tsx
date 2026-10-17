// Live view of one camera, relayed on demand by the edge appliance that serves it.
//   GET /v1/cameras/{id}/live starts (and keeps) the relay and says whether video is flowing:
//   starting -> poll every 2 s; live -> play /v1/cameras/{id}/live.m3u8 (HLS, same-origin cookie
//   session) and keep polling every 10 s so the appliance keeps sending; unavailable -> reason.
// The relay is a few seconds behind real time (1 s segments). hls.js is loaded only when needed and
// runs without a worker (the CSP allows no blob: workers); Safari plays HLS natively.
import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { LiveStatus } from '../api/types';
import { useI18n } from '../i18n';
import { Button, Spinner } from './primitives';

const STARTING_POLL_MS = 2_000;
const LIVE_POLL_MS = 10_000;

type PlayerState = 'connecting' | 'starting' | 'playing' | 'stalled' | 'unavailable' | 'error' | 'unsupported';

export function LivePlayer({ cameraId, name, large = false }: { cameraId: string; name: string; large?: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [state, setState] = useState<PlayerState>('connecting');
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playlist = status?.state === 'live' ? status.playlist : null;

  // Status / demand loop.
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await endpoints.cameras.live(cameraId, { signal: ctrl.signal });
        setStatus(s);
        setError(null);
        // Once video plays, the <video> events own the state; until then the server's answer does.
        if (s.state === 'unavailable') setState('unavailable');
        else setState((prev) => (prev === 'playing' || prev === 'stalled' ? prev : 'starting'));
        timer = setTimeout(tick, s.state === 'live' ? LIVE_POLL_MS : STARTING_POLL_MS);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e as ApiError);
        setState('error');
        timer = setTimeout(tick, STARTING_POLL_MS * 3);
      }
    };
    void tick();
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [cameraId, attempt]);

  // Player.
  useEffect(() => {
    const video = videoRef.current;
    if (!playlist || !video) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    const onPlaying = () => setState('playing');
    const onWaiting = () => setState((s) => (s === 'playing' ? 'stalled' : s));
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlist;
      void video.play().catch(() => undefined);
      destroy = () => {
        video.removeAttribute('src');
        video.load();
      };
    } else {
      void import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setState('unsupported');
          return;
        }
        const hls = new Hls({ enableWorker: false, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 6,
          manifestLoadingMaxRetry: 6, levelLoadingMaxRetry: 6, fragLoadingMaxRetry: 6 });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else {
            // The relay restarts when the appliance reconnects; go back to the status loop.
            setState('starting');
            setStatus(null);
            setAttempt((a) => a + 1);
          }
        });
        hls.loadSource(playlist);
        hls.attachMedia(video);
        void video.play().catch(() => undefined);
        destroy = () => hls.destroy();
      });
    }
    return () => {
      cancelled = true;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      destroy?.();
    };
  }, [playlist]);

  const reason = status?.reason;
  const overlay =
    state === 'playing' ? null : state === 'unavailable' ? (
      <span>
        {reason === 'edge_offline'
          ? t('live|The edge appliance serving this camera is offline.')
          : reason === 'edge_unpaired'
            ? t('live|No edge appliance serves this camera yet.')
            : t('live|The camera is not ready. Check its readiness page.')}
      </span>
    ) : state === 'error' ? (
      <span>
        {t('live|Live view could not be loaded.')} {error?.requestId ? `(${t('Request ID')}: ${error.requestId})` : ''}
      </span>
    ) : state === 'unsupported' ? (
      <span>{t('live|This browser cannot play live video. Use a current Chrome, Edge, Firefox or Safari.')}</span>
    ) : (
      <span className="gb-inline">
        <Spinner /> {state === 'stalled' ? t('live|Reconnecting…') : t('live|Starting live video…')}
      </span>
    );

  return (
    <div ref={wrapRef} className={`live-player ${large ? 'large' : ''}`} aria-label={t('live|Live video: {name}', { name })} role="region">
      <video ref={videoRef} muted autoPlay playsInline aria-hidden={state !== 'playing'} />
      {state === 'playing' ? (
        <span className="live-badge" aria-live="polite">
          <span className="live-dot" aria-hidden="true" /> {t('live|LIVE')}
        </span>
      ) : null}
      {overlay ? <div className="live-overlay" role="status">{overlay}</div> : null}
      {large && state === 'playing' ? (
        <Button
          size="sm"
          variant="secondary"
          className="live-fullscreen"
          onClick={() => void wrapRef.current?.requestFullscreen?.().catch(() => undefined)}
        >
          {t('live|Full screen')}
        </Button>
      ) : null}
    </div>
  );
}
