// Evidence player + explicit evidence states + list of evidence objects with their hashes.
// Media goes through AuthenticatedVideo/AuthenticatedImage only (cookie-authorized /v1/media).
import type { EvidenceState } from '../../api/types';
import { useI18n } from '../../i18n';
import { EvidenceStatePill } from '../domain';
import { AuthenticatedImage, AuthenticatedVideo } from '../media';
import { shortHash } from './labels';
import '../../styles/group-c.css';

export interface EvidenceLike {
  media_id: string;
  mime: string;
  sha256: string;
  kind: 'clip' | 'frame';
  expired?: boolean;
}

const STATE_TEXT: Record<EvidenceState, { title: string; body: string }> = {
  pending: {
    title: 'Evidence is still uploading',
    body: 'The store edge has reported this alert but the clip has not arrived yet. It appears here automatically after upload; refresh to check.',
  },
  unavailable: {
    title: 'No evidence clip for this alert',
    body: 'The store edge could not capture or upload a clip for this alert. Review the camera timeline and other records before deciding.',
  },
  expired: {
    title: 'Evidence has expired',
    body: 'The clip passed the evidence retention period and was deleted. The alert record and audit history remain.',
  },
  available: {
    title: 'Evidence record is empty',
    body: 'The alert is marked as having evidence, but no media is attached. Contact support with the incident reference.',
  },
};

export function EvidencePlayer({
  state,
  evidence,
  cameraName,
  capturedLabel,
}: {
  state: EvidenceState;
  evidence: EvidenceLike[];
  cameraName: string | null;
  /** Already formatted capture time in the store timezone. */
  capturedLabel: string;
}) {
  const { t } = useI18n();
  const live = evidence.filter((e) => !e.expired);
  const clip = live.find((e) => e.kind === 'clip');
  const frame = live.find((e) => e.kind === 'frame');
  const camera = cameraName ?? t('No camera');
  if (state === 'available' && (clip || frame)) {
    return (
      <div className="feed feed-video">
        {clip ? (
          <AuthenticatedVideo mediaId={clip.media_id} label={t('Evidence clip')} />
        ) : (
          <AuthenticatedImage mediaId={frame!.media_id} alt={`${t('Evidence frame')} · ${camera} · ${capturedLabel}`} />
        )}
        <span className="feed-label">{camera}</span>
        <span className="feed-time">{capturedLabel}</span>
      </div>
    );
  }
  const text = STATE_TEXT[state] ?? STATE_TEXT.unavailable;
  return (
    <div className="feed feed-empty" role="status">
      <div>
        <EvidenceStatePill state={state} />
        <p className="feed-empty-title">{t(text.title)}</p>
        <p className="muted small">{t(text.body)}</p>
      </div>
    </div>
  );
}

/** Evidence objects with kind, type and SHA-256 (integrity reference for exports). */
export function EvidenceList({ evidence }: { evidence: EvidenceLike[] }) {
  const { t } = useI18n();
  if (evidence.length === 0) return <p className="muted small">{t('No evidence files are attached to this incident.')}</p>;
  return (
    <ul className="gc-evidence-list">
      {evidence.map((e) => (
        <li key={e.media_id}>
          <span className="gc-evidence-kind">{e.kind === 'clip' ? t('Evidence clip') : t('Evidence frame')}</span>
          <span className="muted small">{e.mime}</span>
          <span className="mono small" title={e.sha256}>
            SHA-256 {shortHash(e.sha256)}
          </span>
          {e.expired ? <span className="muted small">{t('evidence|Expired')}</span> : null}
        </li>
      ))}
    </ul>
  );
}
