// Group B (stores, edge, cameras, detection, operations) typed helpers for API responses that
// the shared src/api layer does not describe yet. Verified against services/api routers:
//   cameras.py (GET /v1/cameras/{id} adds commands/outages/edge; activate/pause/provision return command ids),
//   edge.py (Edge has models/clock_offset_ms/created_at; GET /v1/edges?store_id=),
//   ops.py (models: retire action, notes; reports/summary definitions; health/system camera counts),
//   policies.py (detection_rules / calibration settings shapes).
// Uses the shared `http` client so CSRF, timeouts and auth redirects behave like every other call.
import { http, type RequestOptions } from '../../api/client';
import type {
  Camera,
  DetectionChannel,
  DiscoveryJob,
  Edge,
  Id,
  ModelEntry,
  ReportSummary,
  StorePolicy,
  SystemHealth,
  Timestamp,
} from '../../api/types';

type Opts = Pick<RequestOptions, 'signal' | 'timeoutMs'>;
const enc = encodeURIComponent;

export interface EdgeCommand {
  id: Id;
  kind: 'discover' | 'provision_camera' | 'activate_camera' | 'pause_camera' | 'update_zones' | 'model_rollout' | 'gallery_update' | string;
  status: 'queued' | 'sent' | 'succeeded' | 'failed' | 'expired' | string;
  error: string | null;
  created_at: Timestamp;
  completed_at: Timestamp | null;
}

export interface CameraOutage {
  started_at: Timestamp;
  ended_at: Timestamp | null;
  reason: string | null;
}

export type CameraReadinessReport = NonNullable<Camera['readiness_report']> & {
  profile_token?: string | null;
  conformance?: unknown;
};

/** GET /v1/cameras/{id}: the camera plus recent commands, outages and the edge it is bound to. */
export interface CameraDetail extends Omit<Camera, 'readiness_report'> {
  readiness_report: CameraReadinessReport | null;
  rtsp_path?: string | null;
  endpoint_uuid?: string | null;
  zones_version?: number;
  zones_acked_version?: number;
  created_at?: Timestamp;
  commands: EdgeCommand[];
  outages: CameraOutage[];
  edge: { id: Id; name: string; state: 'online' | 'offline' | 'revoked' } | null;
}

export interface EdgeFull extends Edge {
  models?: { name?: string; version?: string; [k: string]: unknown }[] | null;
  clock_offset_ms?: number | null;
  created_at?: Timestamp;
}

export interface EdgeHealth {
  disk_free_bytes?: number;
  disk_total_bytes?: number;
  gpu_utilization?: number;
  decode_latency_ms_p95?: number;
  queue_age_s?: number;
  spool_pending?: number;
}

export interface SystemHealthFull extends Omit<SystemHealth, 'edges' | 'cameras' | 'worker'> {
  edges: EdgeFull[];
  cameras: { total: number; ready: number; impaired: number; pending: number; analyzing: number };
  worker: { last_seen_at: Timestamp | null; state?: 'online' | 'offline' };
  pending_evidence?: number;
  checked_at?: Timestamp;
}

export type RolloutState = 'registered' | 'shadow' | 'canary' | 'active' | 'rolled_back' | 'retired';

export interface ModelFull extends Omit<ModelEntry, 'rollout_state'> {
  rollout_state: RolloutState | string;
  license_note?: string | null;
  validation_note?: string | null;
  canary_camera_id?: Id | null;
  created_at?: Timestamp;
}

export type ModelActionName = 'license' | 'validate' | 'rollout' | 'rollback' | 'retire';

export interface ReportSummaryFull extends ReportSummary {
  from?: Timestamp;
  to?: Timestamp;
  reviewed_precision: ReportSummary['reviewed_precision'] & { definition?: string };
  false_alerts_per_camera_hour: ReportSummary['false_alerts_per_camera_hour'] & { definition?: string };
}

export interface GestureRule {
  enabled: boolean;
  min_evidence_seconds: number;
}

export interface EvidenceGate {
  anomaly_threshold: number;
  interaction_threshold: number;
  concealment_threshold: number;
  visibility_min: number;
  duration_s: number;
  max_gap_s: number;
  cooldown_s: number;
}

export interface DetectionRules {
  clothing_concealment: GestureRule;
  backpack_gesture: GestureRule;
  personal_bag_gesture: GestureRule;
  shelf_interaction: GestureRule;
  minimum_evidence: EvidenceGate;
  /** Server-maintained: true only after a calibration is published from reviewed data. */
  calibrated: boolean;
}

export interface CalibrationSettings {
  published: boolean;
  threshold: number | null;
  reason: string;
  /** Server-maintained count of reviewed behavior incidents at publish time. */
  based_on_reviewed_incidents: number;
}

export interface DiscoveryJobFull extends DiscoveryJob {
  store_id?: Id;
  interface?: string;
  timeout_s?: number;
  cidr?: string | null;
  created_at?: Timestamp;
  completed_at?: Timestamp | null;
}

export const gb = {
  camera: (id: Id, o?: Opts) => http.get<CameraDetail>(`/v1/cameras/${enc(id)}`, undefined, o),
  provision: (id: Id, o?: Opts) => http.post<{ command_id: Id; status?: string }>(`/v1/cameras/${enc(id)}/provision`, {}, o),
  /** 202 {command_id, camera}: analysis starts only after the edge reports running channels. */
  activate: (id: Id, body: { expected_version: number; channels: DetectionChannel[] }, o?: Opts) =>
    http.post<{ command_id: Id; camera: Camera }>(`/v1/cameras/${enc(id)}/activate`, body, o),
  /** 202 {command_id}: the camera version is bumped; reload to see it. */
  pause: (id: Id, body: { expected_version: number }, o?: Opts) =>
    http.post<{ command_id: Id }>(`/v1/cameras/${enc(id)}/pause`, body, o),
  edges: (storeId?: Id, o?: Opts) =>
    http.get<{ items: EdgeFull[]; next_cursor: string | null }>('/v1/edges', storeId ? { store_id: storeId } : undefined, o),
  health: (o?: Opts) => http.get<SystemHealthFull>('/v1/health/system', undefined, o),
  models: (o?: Opts) => http.get<{ items: ModelFull[]; next_cursor: string | null }>('/v1/models', undefined, o),
  registerModel: (body: { name: string; version: string; channel: string; manifest: Record<string, unknown> }, o?: Opts) =>
    http.post<ModelFull>('/v1/models', body, o),
  modelAction: (
    id: Id,
    action: ModelActionName,
    body: { expected_version: number; status?: string; note?: string; stage?: string; camera_id?: Id; reason?: string },
    o?: Opts,
  ) => http.post<ModelFull>(`/v1/models/${enc(id)}/${action}`, body, o),
  report: (p: { store_id?: Id; from?: string; to?: string }, o?: Opts) =>
    http.get<ReportSummaryFull>('/v1/reports/summary', p, o),
  policy: <S>(storeId: Id, kind: 'detection_rules' | 'calibration', o?: Opts) =>
    http.get<StorePolicy<S>>(`/v1/stores/${enc(storeId)}/policies/${kind}`, undefined, o),
  putPolicy: <S>(storeId: Id, kind: 'detection_rules' | 'calibration', body: { expected_version: number; settings: S }, o?: Opts) =>
    http.put<StorePolicy<S>>(`/v1/stores/${enc(storeId)}/policies/${kind}`, body, o),
  discovery: (id: Id, o?: Opts) => http.get<DiscoveryJobFull>(`/v1/discovery-jobs/${enc(id)}`, undefined, o),
};

/** Fields the API requires in a model manifest (MANIFEST_REQUIRED in services/api routers/ops.py). */
export const MANIFEST_REQUIRED = [
  'algorithm',
  'source_commit',
  'code_license',
  'weights_license',
  'data_license',
  'sha256',
  'preprocessing_version',
  'input_shape',
  'output_shape',
  'keypoint_order',
  'sampling_rate_fps',
  'window',
  'stride',
  'normalization',
  'precision',
  'runtime',
  'validation_report',
] as const;

export const MODEL_CHANNELS = ['behavior', 'watchlist', 'checkout', 'person', 'pose', 'tracker'] as const;

/** Minutes since an ISO timestamp (null when absent). */
export function ageSeconds(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 1000));
}

/** Common IANA zones offered in timezone selectors (any valid IANA name is accepted by the API). */
export const TIMEZONES = [
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];
