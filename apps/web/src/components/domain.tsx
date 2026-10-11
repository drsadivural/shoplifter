// Domain-specific status pills and labels. Always text + glyph + color; never color alone.
import type {
  CameraAnalysisState,
  CameraReadiness,
  EdgeState,
  EvidenceState,
  IncidentChannel,
  IncidentOutcome,
  IncidentPriority,
  IncidentStatus,
} from '../api/types';
import { useI18n } from '../i18n';
import { StatusPill, type Tone } from './primitives';

export const CHANNEL_LABEL: Record<IncidentChannel, string> = {
  behavior_candidate: 'Behavior',
  watchlist_candidate: 'Watchlist',
  checkout_exception: 'Checkout',
  rfid_exception: 'channel|RFID exception',
  manual_observation: 'channel|Manual observation',
};

export function ChannelLabel({ channel }: { channel: IncidentChannel }) {
  const { t } = useI18n();
  return <>{t(CHANNEL_LABEL[channel])}</>;
}

const STATUS: Record<IncidentStatus, [Tone, string]> = {
  new: ['warning', 'Awaiting review'],
  acknowledged: ['info', 'status|Acknowledged'],
  reviewing: ['info', 'status|In review'],
  resolved: ['ok', 'status|Resolved'],
};

export function IncidentStatusPill({ status }: { status: IncidentStatus }) {
  const { t } = useI18n();
  const [tone, key] = STATUS[status];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

const OUTCOME: Record<IncidentOutcome, [Tone, string]> = {
  confirmed: ['critical', 'Confirmed incident'],
  false_alert: ['neutral', 'False alert'],
  inconclusive: ['warning', 'Inconclusive'],
};

export function OutcomePill({ outcome }: { outcome: IncidentOutcome | null }) {
  const { t } = useI18n();
  if (!outcome) return <StatusPill tone="neutral">{t('outcome|Not recorded')}</StatusPill>;
  const [tone, key] = OUTCOME[outcome];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

const EVIDENCE: Record<EvidenceState, [Tone, string]> = {
  pending: ['warning', 'evidence|Pending upload'],
  available: ['ok', 'evidence|Available'],
  unavailable: ['neutral', 'evidence|Unavailable'],
  expired: ['neutral', 'evidence|Expired'],
};

export function EvidenceStatePill({ state }: { state: EvidenceState }) {
  const { t } = useI18n();
  const [tone, key] = EVIDENCE[state];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

const PRIORITY: Record<IncidentPriority, [Tone, string]> = {
  normal: ['neutral', 'priority|Normal'],
  high: ['warning', 'priority|High'],
  urgent: ['critical', 'priority|Urgent'],
};

export function PriorityPill({ priority }: { priority: IncidentPriority }) {
  const { t } = useI18n();
  const [tone, key] = PRIORITY[priority];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

const READINESS: Record<CameraReadiness, [Tone, string]> = {
  pending: ['warning', 'readiness|Pending checks'],
  ready: ['ok', 'Ready'],
  degraded: ['warning', 'readiness|Degraded'],
  offline: ['critical', 'readiness|Offline'],
  disabled: ['neutral', 'readiness|Disabled'],
};

export function ReadinessPill({ readiness }: { readiness: CameraReadiness }) {
  const { t } = useI18n();
  const [tone, key] = READINESS[readiness];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

const ANALYSIS: Record<CameraAnalysisState, [Tone, string]> = {
  unavailable: ['neutral', 'analysis|Not analyzing'],
  activation_requested: ['info', 'analysis|Activation requested'],
  analyzing: ['ok', 'analysis|Analyzing'],
  paused: ['neutral', 'analysis|Paused'],
  degraded: ['warning', 'analysis|Degraded'],
};

export function AnalysisStatePill({ state }: { state: CameraAnalysisState }) {
  const { t } = useI18n();
  const [tone, key] = ANALYSIS[state];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

const EDGE: Record<EdgeState, [Tone, string]> = {
  online: ['ok', 'edge|Online'],
  offline: ['critical', 'edge|Offline'],
  unpaired: ['warning', 'edge|Not paired'],
};

export function EdgeStatePill({ state }: { state: EdgeState }) {
  const { t } = useI18n();
  const [tone, key] = EDGE[state];
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}
