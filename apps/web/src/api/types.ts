// TypeScript mirror of docs/API_V1.md. Keep in sync with packages/contracts/openapi.json
// once it is generated. All IDs are opaque strings; all timestamps are RFC 3339 UTC strings.

export type Id = string;
/** RFC 3339 UTC timestamp, e.g. "2026-10-11T01:42:18Z". Format with lib/format in the store timezone. */
export type Timestamp = string;

/** Cursor-paginated list: `?cursor=&limit=1..100` (default 50). */
export interface Paged<T> {
  items: T[];
  next_cursor: string | null;
}

/** Error body returned by every non-2xx response. */
export interface ApiErrorBody {
  code: string;
  message: string;
  request_id: string;
  retriable: boolean;
  field_errors?: Record<string, string>;
  current_version?: number;
}

// ---------------------------------------------------------------- Auth / me

export type Locale = 'ja' | 'en';
export type ThemePreference = 'light' | 'dark' | 'system';

export type Role = 'viewer' | 'responder' | 'investigator' | 'store_admin' | 'org_admin';

/** Permission action strings (GET /v1/roles). Clients hide controls; the server enforces. */
export type Permission =
  | 'dashboard.read'
  | 'incident.read'
  | 'incident.create'
  | 'incident.respond'
  | 'incident.reopen'
  | 'case.read'
  | 'case.manage'
  | 'export.create'
  | 'search.metadata'
  | 'search.photo'
  | 'profile.read'
  | 'staff.manage'
  | 'watchlist.manage'
  | 'watchlist.approve'
  | 'photo.read'
  | 'camera.read'
  | 'camera.manage'
  | 'edge.manage'
  | 'store.read'
  | 'store.manage'
  | 'policy.manage'
  | 'integration.manage'
  | 'report.read'
  | 'audit.read'
  | 'user.manage'
  | 'org.manage'
  | 'model.manage'
  | 'privacy.manage'
  | 'health.read'
  | 'support.create';

export interface AuthConfig {
  oidc_enabled: boolean;
  password_login: boolean;
  mfa_required_roles: Role[];
  support_contact: string | null;
}

export type LoginState = 'authenticated' | 'mfa_required' | 'mfa_enrollment_required';

export interface LoginResponse {
  state: LoginState;
  token?: string;
  expires_at: Timestamp;
}

export interface MfaSetup {
  secret: string;
  otpauth_uri: string;
}

export interface MfaEnableResponse {
  state: 'authenticated';
  recovery_codes: string[];
}

export interface NotificationPrefs {
  behavior: boolean;
  watchlist: boolean;
  checkout: boolean;
  rfid: boolean;
  sound: boolean;
  private_preview: true;
  quiet_hours: { start: string; end: string } | null;
  store_ids: Id[];
}

export interface StoreRef {
  id: Id;
  name: string;
  timezone: string;
  region: string;
}

export interface Me {
  user: {
    id: Id;
    email: string;
    display_name: string;
    role: Role;
    locale: Locale | null;
    theme: ThemePreference | null;
    mfa_enabled: boolean;
    notification_prefs: NotificationPrefs;
  };
  org: { id: Id; name: string; timezone: string; region: string };
  stores: StoreRef[];
  permissions: Permission[];
  session: { id: Id; expires_at: Timestamp; mfa_verified: boolean };
  unread_notifications: number;
}

export interface SessionInfo {
  id: Id;
  client: 'web' | 'ios';
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  current: boolean;
  user_agent: string;
}

// ---------------------------------------------------------------- Org / stores / users

export interface Org {
  id: Id;
  name: string;
  timezone: string;
  region: string;
  primary_admin_id: Id;
  version: number;
}

export interface OrgSettings<S = Record<string, unknown>> {
  kind: 'general' | 'privacy';
  settings: S;
  version: number;
  updated_at: Timestamp;
  updated_by: Id | null;
}

export interface GeneralSettings {
  default_locale: Locale;
  session_timeout_minutes: number;
  currency: string;
}

export interface PrivacySettings {
  raw_video_retention_hours: number;
  evidence_retention_days: number;
  profile_max_expiry_days: number;
  query_photo_ttl_minutes: number;
  legal_hold_review_days: number;
  deletion_contact: string;
}

export type EdgeState = 'unpaired' | 'online' | 'offline';

export interface Store {
  id: Id;
  name: string;
  region: string;
  address: string;
  timezone: string;
  manager_name: string;
  opening_hours: string;
  version: number;
  camera_count: number;
  cameras_ready: number;
  open_alerts: number;
  edge_state: EdgeState;
}

export interface StoreDetail extends Store {
  summary: {
    coverage: { cameras_total: number; cameras_ready: number; cameras_analyzing: number };
    open_incidents: number;
    review_queue: number;
    last_refresh: Timestamp;
  };
}

export type StorePolicyKind = 'detection_rules' | 'calibration' | 'escalation' | 'notification_routing';

export interface StorePolicy<S = Record<string, unknown>> {
  kind: StorePolicyKind;
  store_id: Id;
  settings: S;
  version: number;
  updated_at: Timestamp;
  updated_by: Id | null;
}

export interface User {
  id: Id;
  email: string;
  display_name: string;
  role: Role;
  store_ids: Id[];
  mfa_enabled: boolean;
  active: boolean;
  last_sign_in_at: Timestamp | null;
  version: number;
}

export interface Invitation {
  id: Id;
  email?: string;
  role?: Role;
  store_ids?: Id[];
  accept_url?: string;
  expires_at: Timestamp;
}

export interface RolesMatrix {
  roles: Role[];
  actions: { action: Permission; roles: Role[] }[];
}

export interface TeamMember {
  id: Id;
  display_name: string;
  role: Role;
  on_duty: boolean;
}

// ---------------------------------------------------------------- Edge / cameras

export interface Edge {
  id: Id;
  store_id: Id;
  name: string;
  fingerprint: string;
  software_version: string;
  last_seen_at: Timestamp | null;
  state: 'online' | 'offline' | 'revoked';
  health: Record<string, unknown> | null;
}

export type CameraReadiness = 'pending' | 'ready' | 'degraded' | 'offline' | 'disabled';
export type CameraAnalysisState = 'unavailable' | 'activation_requested' | 'analyzing' | 'paused' | 'degraded';
export type ChannelStateValue = 'not_requested' | 'unavailable' | 'starting' | 'running' | 'degraded';
export type DetectionChannel = 'behavior' | 'watchlist' | 'checkout';

export interface ChannelState {
  state: ChannelStateValue;
  reason?: string;
}

export interface Camera {
  id: Id;
  store_id: Id;
  edge_id: Id | null;
  name: string;
  location: string;
  address: string;
  vendor: string | null;
  model: string | null;
  stream_profile: 'substream' | 'mainstream';
  readiness: CameraReadiness;
  analysis_state: CameraAnalysisState;
  channels: Record<DetectionChannel, ChannelState | ChannelStateValue>;
  readiness_report: {
    checked_at: Timestamp;
    codec: string;
    width: number;
    height: number;
    fps: number;
    decoded_seconds: number;
    monotonic_time: boolean;
    errors: string[];
  } | null;
  last_frame_at: Timestamp | null;
  snapshot: { media_id: Id; captured_at: Timestamp } | null;
  activated_at: Timestamp | null;
  has_credentials: boolean;
  version: number;
}

export interface Zone {
  id: Id;
  type: 'shelf' | 'checkout' | 'exit_line' | 'privacy_mask';
  label: string;
  points: [number, number][];
  direction?: 'in' | 'out';
}

export interface CameraZones {
  version: number;
  zones: Zone[];
  acknowledged_version: number | null;
}

export interface CameraImportResult {
  rows: { line: number; name: string; address: string; status: 'valid' | 'invalid' | 'created'; errors: string[] }[];
  created: number;
}

export interface DiscoveryJob {
  id: Id;
  status: 'queued' | 'running' | 'completed' | 'failed';
  devices: {
    endpoint: string;
    address: string;
    xaddrs: string[];
    scopes: string[];
    vendor?: string;
    model?: string;
    already_added: boolean;
  }[];
  error?: string;
}

// ---------------------------------------------------------------- Profiles / photos

export type ProfileKind = 'staff' | 'watchlist';
export type ProfileStatus = 'draft' | 'pending_review' | 'approved' | 'suspended' | 'expired' | 'deleted';
export type ProfileAction = 'submit' | 'approve' | 'reject' | 'suspend' | 'reinstate' | 'delete';

export interface Profile {
  id: Id;
  kind: ProfileKind;
  reference: string;
  display_name: string | null;
  basis: string | null;
  source_incident_id: Id | null;
  store_ids: Id[];
  status: ProfileStatus;
  expires_at: Timestamp | null;
  review_at: Timestamp | null;
  /** When the enrolled subject was last seen (entered by the enrolling user). */
  last_seen_at?: Timestamp | null;
  role_context: string | null;
  notice_recorded: boolean | null;
  photo_count: number;
  approved_photo_count: number;
  gallery_state: 'not_in_gallery' | 'face_sdk_unavailable' | 'in_gallery';
  created_by: Id;
  approved_by: Id | null;
  version: number;
  created_at: Timestamp;
}

export interface ProfileDetail extends Profile {
  photos: Photo[];
  linked_incidents: IncidentSummary[];
  history: { at: Timestamp; action: string; actor: string | null; reason?: string | null }[];
}

export interface Photo {
  id: Id;
  profile_id: Id;
  profile_kind: ProfileKind;
  profile_reference: string;
  media_id: Id;
  thumb_media_id: Id;
  width: number;
  height: number;
  status: 'pending' | 'approved' | 'rejected' | 'deleted';
  quality: {
    image: { sharpness: number; brightness: number; width: number; height: number };
    face: { status: 'unavailable' | string; reason?: string };
  };
  provenance: string;
  created_at: Timestamp;
}

// ---------------------------------------------------------------- Incidents / cases / exports

export type IncidentChannel =
  | 'behavior_candidate'
  | 'watchlist_candidate'
  | 'checkout_exception'
  | 'rfid_exception'
  | 'manual_observation';
export type IncidentStatus = 'new' | 'acknowledged' | 'reviewing' | 'resolved';
export type IncidentOutcome = 'confirmed' | 'false_alert' | 'inconclusive';
export type IncidentPriority = 'normal' | 'high' | 'urgent';
export type EvidenceState = 'pending' | 'available' | 'unavailable' | 'expired';

export interface IncidentSummary {
  id: Id;
  ref: string;
  store_id: Id;
  store_name: string;
  /** IANA timezone of the incident's store (format captured_at with it). */
  store_timezone?: string;
  camera_id: Id | null;
  camera_name: string | null;
  channel: IncidentChannel;
  status: IncidentStatus;
  outcome: IncidentOutcome | null;
  priority: IncidentPriority;
  assignee: { id: Id; display_name: string } | null;
  evidence_state: EvidenceState;
  captured_at: Timestamp;
  ingested_at: Timestamp;
  delayed: boolean;
  version: number;
  /** Truncated description (≤300 chars) on list items. */
  description?: string | null;
}

export interface Incident extends IncidentSummary {
  description: string | null;
  /** Raw gate/model signal values. Display as candidate evidence, never as probabilities. */
  signals: Record<string, unknown>;
  gate_reason: string | null;
  model_version: string | null;
  uncertainty: string[];
  evidence: { media_id: Id; mime: string; sha256: string; kind: 'clip' | 'frame' }[];
  notes: { id: Id; author: string; body: string; created_at: Timestamp }[];
  reviews: { id: Id; actor: string; action: string; outcome: IncidentOutcome | null; reason: string | null; created_at: Timestamp }[];
  timeline: { at: Timestamp; action: string; actor: string | null; actor_kind?: string }[];
  observed_behavior: string | null;
  loss_value: number | null;
  recovered_value: number | null;
  currency: string | null;
  ack_deadline: Timestamp | null;
  acknowledged_at: Timestamp | null;
  resolved_at: Timestamp | null;
  cases: { id: Id; ref: string }[];
}

export interface IncidentListParams {
  store_id?: Id;
  /** One channel or a comma-separated list. */
  channel?: IncidentChannel | string;
  /** One status or a comma-separated list, e.g. "new,acknowledged,reviewing". */
  status?: IncidentStatus | string;
  /** "1" = unresolved only. */
  open?: '1';
  priority?: IncidentPriority;
  outcome?: IncidentOutcome;
  assignee?: 'me' | 'none' | Id;
  camera_id?: Id;
  q?: string;
  from?: Timestamp;
  to?: Timestamp;
  evidence_state?: EvidenceState;
  cursor?: string;
  limit?: number;
}

export interface Visit {
  available: boolean;
  reason?: string;
  events: unknown[];
}

export interface CaseSummary {
  id: Id;
  ref: string;
  title: string;
  owner: { id: Id; display_name: string } | null;
  status: 'open' | 'closed';
  incident_count?: number;
  updated_at?: Timestamp;
  version: number;
}

export interface CaseDetail extends CaseSummary {
  incidents: IncidentSummary[];
  notes: { id: Id; author: string; body: string; created_at: Timestamp }[];
  timeline: { at: Timestamp; action: string; actor: string | null }[];
  exports: Export[];
  access_log: { at: Timestamp; actor: string; action: string }[];
}

export type Redaction = 'none' | 'blur_bystanders' | 'faces_and_bystanders';

export interface Export {
  id: Id;
  case_id: Id;
  status: 'queued' | 'ready' | 'failed' | 'expired';
  manifest: { files: { name: string; sha256: string; size: number }[] } | null;
  expires_at: Timestamp;
  recipient: string;
  reason: string;
  redaction: Redaction;
  download_count: number;
}

// ---------------------------------------------------------------- Search / dashboard / reports / ops

export interface SearchCoverage {
  from: Timestamp;
  to: Timestamp;
  retention_cutoff: Timestamp | null;
  cameras: { id: Id; name: string; store_id: Id; activated_at: Timestamp | null; outages: { from: Timestamp; to: Timestamp }[] }[];
  gaps: { camera_id: Id | null; from: Timestamp; to: Timestamp; reason: 'before_activation' | 'outage' | 'beyond_retention' | 'no_cameras' }[];
}

export interface SearchResponse extends Paged<IncidentSummary> {
  coverage: SearchCoverage;
}

export interface Dashboard {
  open_alerts: number | null;
  reviewed_today: number | null;
  cameras: { online: number; total: number; analyzing?: number } | null;
  median_ack_seconds: number | null;
  acknowledged_today?: number;
  awaiting_review: IncidentSummary[];
  camera_health: {
    id: Id;
    name: string;
    location?: string;
    readiness: CameraReadiness;
    analysis_state: CameraAnalysisState;
    last_frame_at: Timestamp | null;
  }[];
  trend: { date: string; detections: number; reviewed: number }[];
  /** Latest verified camera snapshot (null when no camera has delivered a frame). */
  preview?: { camera_id: Id; camera_name: string; media_id: Id; captured_at: Timestamp } | null;
  /** Timezone used for "today" boundaries. */
  timezone?: string;
  last_refresh: Timestamp;
}

export interface MetricWithCi {
  value: number | null;
  n: number;
  ci95: [number, number] | null;
}

export interface ReportSummary {
  detections: { by_channel: Partial<Record<IncidentChannel, number>> };
  reviewed: number;
  confirmed: number;
  false_alert: number;
  inconclusive: number;
  reviewed_precision: MetricWithCi;
  false_alerts_per_camera_hour: { value: number | null; false_alerts: number; camera_hours: number };
  median_ack_seconds: number | null;
  confirmed_loss: number | null;
  recovered_value: number | null;
  currency: string;
  daily: Record<string, unknown>[];
}

export interface Integration {
  id: Id;
  store_id: Id;
  kind: 'pos' | 'rfid' | 'vms';
  name: string;
  config: { lane_map?: Record<string, string>; clock_offset_ms?: number };
  status: 'configured' | 'receiving' | 'stale';
  last_event_at: Timestamp | null;
  version: number;
  webhook_secret?: string;
}

export interface ModelEntry {
  id: Id;
  name: string;
  version: string;
  channel: string;
  sha256: string;
  license_status: 'unverified' | 'cleared' | 'restricted' | 'rejected';
  validation_status: 'not_validated' | 'passed' | 'failed';
  rollout_state: string;
  manifest: Record<string, unknown>;
  version_row: number;
}

export interface AuditEntry {
  id: Id;
  at: Timestamp;
  actor: { id: Id; display_name: string } | null;
  action: string;
  resource_type: string;
  resource_id: Id | null;
  store_id: Id | null;
  result: string;
  request_id: string;
  detail: Record<string, unknown> | null;
}

export type DependencyStatus = 'available' | 'unavailable' | 'unconfigured';

export interface SystemHealth {
  edges: Edge[];
  cameras: Record<string, unknown>;
  outbox: { pending: number; oldest_pending_age_s: number | null; dead_letter: number };
  worker: { last_seen_at: Timestamp | null };
  dependencies: Record<'face_sdk' | 'behavior_model' | 'apns' | 'oidc' | 'smtp', DependencyStatus>;
}

export interface AppNotification {
  id: Id;
  kind: string;
  incident_id: Id | null;
  created_at: Timestamp;
  read_at: Timestamp | null;
}

export interface SupportBundle {
  id: Id;
  download_url: string;
  expires_at: Timestamp;
}
