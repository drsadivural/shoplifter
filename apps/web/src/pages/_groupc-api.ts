// Group C local API helpers. Typed wrappers for /v1 endpoints (and response fields) that the
// shared src/api layer does not cover yet. Shapes verified against services/api/src/retailguard_api
// (routers/incidents.py, ops.py, privacy.py, org.py). Uses the shared fetch client (CSRF,
// timeouts, 401 redirects) — never fetch() directly.
import { http, type RequestOptions } from '../api/client';
import { endpoints } from '../api/endpoints';
import type {
  CaseDetail,
  CaseSummary,
  Export,
  Id,
  Incident,
  IncidentChannel,
  IncidentOutcome,
  IncidentPriority,
  IncidentSummary,
  Integration,
  MetricWithCi,
  Paged,
  Redaction,
  TeamMember,
  Timestamp,
} from '../api/types';

type Opts = Pick<RequestOptions, 'signal' | 'timeoutMs'>;
const enc = encodeURIComponent;

// ------------------------------------------------------------------ incidents

export interface EvidenceItem {
  media_id: Id;
  mime: string;
  sha256: string;
  kind: 'clip' | 'frame';
  created_at?: Timestamp;
  expires_at?: Timestamp | null;
  /** True when the media object was deleted by retention. */
  expired?: boolean;
}

/** GET /v1/incidents/{id} — detail() in routers/incidents.py returns more than api/types Incident. */
export interface IncidentDetail extends Incident {
  evidence: EvidenceItem[];
  outcome_reason: string | null;
  preprocessing_version?: string | null;
  escalated_at: Timestamp | null;
  association_decision: 'accepted' | 'rejected' | null;
  profile_id: Id | null;
  legal_hold: { reason: string; review_at: Timestamp | null } | null;
}

export interface NearbyEvent {
  id: Id;
  channel: IncidentChannel;
  captured_at: Timestamp;
  camera_name: string | null;
  location: string | null;
}

/** GET /v1/incidents/{id}/visit — re-identification is not installed, so available is always false. */
export interface VisitResponse {
  available: boolean;
  reason: string | null;
  incident_id: Id;
  nearby_events: NearbyEvent[];
  note?: string;
}

export interface PosEvent {
  kind: 'scan' | 'void' | 'refund' | 'suspend' | 'payment' | string;
  lane: string | null;
  transaction_id: string | null;
  barcode: string | null;
  item_count: number | null;
  amount: number | null;
  occurred_at: Timestamp;
  received_at: Timestamp;
}

/** GET /v1/incidents/{id}/pos-events (±5 min window around the incident). */
export interface PosEventsResponse {
  available: boolean;
  reason: 'pos_unconfigured' | 'pos_telemetry_missing' | null;
  events: PosEvent[];
  integrations: { id: Id; name: string; clock_offset_ms: number | null; lane_map: Record<string, Id> }[];
}

export interface LegalHoldResult {
  incident_id: Id;
  legal_hold_reason: string | null;
  legal_hold_review_at?: Timestamp;
}

// ------------------------------------------------------------------ cases / exports

export interface ExportRecord extends Export {
  manifest: { files: { name: string; sha256: string; size: number }[]; bundle_sha256?: string } | null;
  created_at: Timestamp;
  created_by: Id;
  error: string | null;
  media_id: Id | null;
}

export interface CaseRecord extends CaseSummary {
  store_id: Id | null;
  created_at: Timestamp;
  close_reason: string | null;
}

export interface CaseDetailFull extends Omit<CaseDetail, 'timeline' | 'exports'> {
  store_id: Id | null;
  created_at: Timestamp;
  close_reason: string | null;
  timeline: { at: Timestamp; action: string; actor: string | null; detail: Record<string, unknown> | null }[];
  exports: ExportRecord[];
}

// ------------------------------------------------------------------ ops

export interface PosStatus {
  configured: boolean;
  last_event_at: Timestamp | null;
  fresh: boolean;
}

export interface CheckoutException extends IncidentSummary {
  signals: Record<string, unknown>;
}

/** GET /v1/checkout/exceptions — key is pos_status (per store), not pos_availability. */
export interface CheckoutExceptions extends Paged<CheckoutException> {
  pos_status: Record<Id, PosStatus>;
}

export interface ReportSummaryFull {
  from: Timestamp;
  to: Timestamp;
  detections: { by_channel: Partial<Record<IncidentChannel, number>>; total: number };
  reviewed: number;
  confirmed: number;
  false_alert: number;
  inconclusive: number;
  reviewed_precision: MetricWithCi & { definition: string };
  false_alerts_per_camera_hour: { value: number | null; false_alerts: number; camera_hours: number; definition: string };
  median_ack_seconds: number | null;
  ack_n: number;
  confirmed_loss: number;
  recovered_value: number;
  loss_n: number;
  currency: string;
  /** Grouped by UTC calendar day (server side). Days without incidents are omitted. */
  daily: { date: string; detections: number; confirmed: number; false_alert: number; inconclusive: number }[];
}

export interface TeamMemberDuty extends TeamMember {
  duty: 'primary' | 'backup' | null;
}

export interface EscalationSettings {
  primary_responder_ids: Id[];
  backup_responder_ids: Id[];
  ack_deadline_minutes: number;
  quiet_hours: { start: string; end: string } | null;
  push_privacy: 'generic';
}

export type IntegrationKind = Integration['kind'];

export interface IntegrationConfig {
  lane_map: Record<string, Id>;
  clock_offset_ms: number | null;
  vendor: string | null;
}

export interface IntegrationRecord extends Omit<Integration, 'config'> {
  config: IntegrationConfig;
  webhook_url: string;
  created_at: Timestamp;
}

export interface IntegrationTestResult {
  ok: boolean;
  last_event_at: Timestamp | null;
  events_last_10_min: number;
  message: string;
}

export interface SearchParams {
  from?: string;
  to?: string;
  store_id?: Id;
  camera_id?: Id;
  channel?: string;
  outcome?: string;
  assignee?: string;
  evidence_state?: string;
}

// ------------------------------------------------------------------ calls

export const gc = {
  incident: (id: Id, o?: Opts) => http.get<IncidentDetail>(`/v1/incidents/${enc(id)}`, undefined, o),
  claim: (id: Id, version: number) => endpoints.incidents.claim(id, { expected_version: version }) as Promise<IncidentDetail>,
  requestReview: (id: Id, version: number, reason: string) =>
    endpoints.incidents.requestReview(id, { expected_version: version, reason }) as Promise<IncidentDetail>,
  outcome: (
    id: Id,
    body: {
      expected_version: number;
      outcome: IncidentOutcome;
      reason: string;
      observed_behavior?: string;
      loss_value?: number;
      recovered_value?: number;
    },
  ) => endpoints.incidents.outcome(id, body) as Promise<IncidentDetail>,
  escalate: (id: Id, body: { expected_version: number; reason: string; priority: IncidentPriority }) =>
    endpoints.incidents.escalate(id, body) as Promise<IncidentDetail>,
  reopen: (id: Id, version: number, reason: string) =>
    endpoints.incidents.reopen(id, { expected_version: version, reason }) as Promise<IncidentDetail>,
  addNote: (id: Id, body: string) => endpoints.incidents.addNote(id, { body }) as Promise<IncidentDetail>,
  /** POST /v1/incidents/{id}/association (watchlist candidates only; no expected_version in the API). */
  association: (id: Id, body: { decision: 'accepted' | 'rejected'; reason: string }) =>
    http.post<IncidentDetail>(`/v1/incidents/${enc(id)}/association`, body),
  visit: (id: Id, o?: Opts) => http.get<VisitResponse>(`/v1/incidents/${enc(id)}/visit`, undefined, o),
  posEvents: (id: Id, o?: Opts) => http.get<PosEventsResponse>(`/v1/incidents/${enc(id)}/pos-events`, undefined, o),
  placeHold: (id: Id, body: { reason: string; review_days?: number }) =>
    http.post<LegalHoldResult>(`/v1/incidents/${enc(id)}/legal-hold`, body),
  releaseHold: (id: Id, body: { reason: string }) =>
    http.post<LegalHoldResult>(`/v1/incidents/${enc(id)}/legal-hold/release`, body),

  cases: (p: { status?: 'open' | 'closed' } = {}, o?: Opts) => http.get<Paged<CaseRecord>>('/v1/cases', p, o),
  getCase: (id: Id, o?: Opts) => http.get<CaseDetailFull>(`/v1/cases/${enc(id)}`, undefined, o),
  createCase: (body: { title: string; store_id?: Id; incident_ids?: Id[] }) => http.post<CaseDetailFull>('/v1/cases', body),
  linkIncident: (id: Id, incidentId: Id) => http.post<CaseDetailFull>(`/v1/cases/${enc(id)}/incidents`, { incident_id: incidentId }),
  unlinkIncident: (id: Id, incidentId: Id) => http.del<CaseDetailFull>(`/v1/cases/${enc(id)}/incidents/${enc(incidentId)}`),
  caseNote: (id: Id, body: string) => http.post<CaseDetailFull>(`/v1/cases/${enc(id)}/notes`, { body }),
  caseStatus: (id: Id, action: 'close' | 'reopen', version: number, reason: string) =>
    http.post<CaseDetailFull>(`/v1/cases/${enc(id)}/${action}`, { expected_version: version, reason }),

  exports: (o?: Opts) => http.get<Paged<ExportRecord>>('/v1/exports', undefined, o),
  getExport: (id: Id, o?: Opts) => http.get<ExportRecord>(`/v1/exports/${enc(id)}`, undefined, o),
  createExport: (
    idempotencyKey: string,
    body: { case_id: Id; redaction: Redaction; reason: string; recipient: string; expires_in_days: number },
  ) => endpoints.exports.create(idempotencyKey, body) as Promise<ExportRecord>,

  search: (p: SearchParams & { cursor?: string | null; limit?: number }, o?: Opts) => endpoints.search.query(p, o),
  /** POST /v1/search/photo (multipart). Uses fetch (postForm) so failures are typed ApiErrors. */
  photoSearch: (file: File) => {
    const form = new FormData();
    form.set('file', file);
    return http.postForm<unknown>('/v1/search/photo', form);
  },

  checkout: (storeId: Id | undefined, o?: Opts) =>
    http.get<CheckoutExceptions>('/v1/checkout/exceptions', { store_id: storeId }, o),
  reports: (p: { store_id?: Id; from?: string; to?: string }, o?: Opts) =>
    http.get<ReportSummaryFull>('/v1/reports/summary', p, o),

  team: (storeId: Id, o?: Opts) => http.get<{ items: TeamMemberDuty[] }>('/v1/team', { store_id: storeId }, o),
  getEscalation: (storeId: Id, o?: Opts) => endpoints.stores.getPolicy<EscalationSettings>(storeId, 'escalation', o),
  putEscalation: (storeId: Id, version: number, settings: EscalationSettings) =>
    endpoints.stores.putPolicy<EscalationSettings>(storeId, 'escalation', { expected_version: version, settings }),

  integrations: (o?: Opts) => http.get<Paged<IntegrationRecord>>('/v1/integrations', undefined, o),
  createIntegration: (body: { store_id: Id; kind: IntegrationKind; name: string; config: Partial<IntegrationConfig> }) =>
    http.post<IntegrationRecord & { webhook_secret: string }>('/v1/integrations', body),
  updateIntegration: (id: Id, body: { expected_version: number; name?: string; config?: Partial<IntegrationConfig> }) =>
    http.patch<IntegrationRecord>(`/v1/integrations/${enc(id)}`, body),
  rotateSecret: (id: Id) => http.post<{ webhook_secret: string }>(`/v1/integrations/${enc(id)}/rotate-secret`, {}),
  testIntegration: (id: Id) => http.post<IntegrationTestResult>(`/v1/integrations/${enc(id)}/test`, {}),
};
