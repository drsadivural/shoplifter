// Label lookups shared by the group C screens. Every key here has Japanese in i18n/app-c.ts
// (dynamic keys are also listed in the catalog test of the pages that use them).
import type { IncidentChannel, IncidentOutcome, IncidentPriority, IncidentStatus, Redaction } from '../../api/types';

type T = (key: string, vars?: Record<string, string | number>) => string;

export function humanize(key: string): string {
  const s = key.replace(/[_.]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Audit action (incident / case / export timeline) -> label, falling back to a readable form. */
export function actionLabel(t: T, action: string): string {
  const key = `timeline|${action}`;
  const s = t(key);
  return s === action ? humanize(action) : s;
}

/** reviews[].action -> label. */
export function reviewActionLabel(t: T, action: string): string {
  const key = `review|${action}`;
  const s = t(key);
  return s === action ? humanize(action) : s;
}

export const CHANNELS: IncidentChannel[] = [
  'behavior_candidate',
  'watchlist_candidate',
  'checkout_exception',
  'rfid_exception',
  'manual_observation',
];
export const STATUSES: IncidentStatus[] = ['new', 'acknowledged', 'reviewing', 'resolved'];
export const OUTCOMES: IncidentOutcome[] = ['confirmed', 'false_alert', 'inconclusive'];
export const PRIORITIES: IncidentPriority[] = ['normal', 'high', 'urgent'];
export const REDACTIONS: Redaction[] = ['none', 'blur_bystanders', 'faces_and_bystanders'];

export const STATUS_KEY: Record<IncidentStatus, string> = {
  new: 'Awaiting review',
  acknowledged: 'status|Acknowledged',
  reviewing: 'status|In review',
  resolved: 'status|Resolved',
};

export const OUTCOME_KEY: Record<IncidentOutcome, string> = {
  confirmed: 'Confirmed incident',
  false_alert: 'False alert',
  inconclusive: 'Inconclusive',
};

export const PRIORITY_KEY: Record<IncidentPriority, string> = {
  normal: 'priority|Normal',
  high: 'priority|High',
  urgent: 'priority|Urgent',
};

export const REDACTION_KEY: Record<Redaction, string> = {
  none: 'redaction|None',
  blur_bystanders: 'redaction|Blur bystanders',
  faces_and_bystanders: 'redaction|Faces and bystanders',
};

export const EVIDENCE_KEY: Record<string, string> = {
  available: 'evidence|Available',
  pending: 'evidence|Pending upload',
  unavailable: 'evidence|Unavailable',
  expired: 'evidence|Expired',
};

export const GAP_REASON_KEY: Record<string, string> = {
  before_activation: 'gap|Before camera activation',
  outage: 'gap|Camera outage',
  beyond_retention: 'gap|Beyond evidence retention',
  no_cameras: 'gap|No cameras in scope',
};

export const POS_KIND_KEY: Record<string, string> = {
  scan: 'pos|Scan',
  void: 'pos|Void',
  refund: 'pos|Refund',
  suspend: 'pos|Suspend',
  payment: 'pos|Payment',
  heartbeat: 'pos|Heartbeat',
};

export const INTEGRATION_KIND_KEY: Record<string, string> = {
  pos: 'POS connector',
  rfid: 'RFID reader',
  vms: 'VMS connector',
};

export const EXPORT_STATUS: Record<string, ['ok' | 'info' | 'warning' | 'critical' | 'neutral', string]> = {
  queued: ['info', 'export|Preparing'],
  ready: ['ok', 'export|Ready to download'],
  failed: ['critical', 'export|Failed'],
  expired: ['neutral', 'export|Expired'],
};

export const INTEGRATION_STATUS: Record<string, ['ok' | 'info' | 'warning' | 'critical' | 'neutral', string]> = {
  configured: ['warning', 'integration|No events yet'],
  receiving: ['ok', 'integration|Receiving'],
  stale: ['critical', 'integration|Stale'],
};

/** Server field_errors codes -> message key (field_error|<code> lives in app.ts / app-c.ts). */
export function fieldError(t: T, code: string | undefined): string | null {
  if (!code) return null;
  const key = `field_error|${code}`;
  const s = t(key);
  return s === code ? t('This value is not valid ({code}).', { code }) : s;
}

/** Short hash for display: first 12 hex chars (full value in title/copy). */
export function shortHash(sha: string | null | undefined): string {
  return sha ? `${sha.slice(0, 12)}…` : '—';
}
