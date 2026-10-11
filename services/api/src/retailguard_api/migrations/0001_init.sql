-- RetailGuard production schema v1. Derived from contracts/schema.sql and extended for
-- the implemented API. Applied by the migration identity (table owner, BYPASSRLS).
-- The API connects as retailguard_app (NOBYPASSRLS) and sets app.org_id per transaction.

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  timezone text NOT NULL,
  region text NOT NULL,
  primary_admin_id uuid,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stores (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  region text NOT NULL DEFAULT '',
  address text NOT NULL,
  timezone text NOT NULL,
  manager_name text NOT NULL DEFAULT '',
  opening_hours text NOT NULL DEFAULT '',
  config_version bigint NOT NULL DEFAULT 1,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  oidc_subject text,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('viewer','responder','investigator','store_admin','org_admin')),
  active boolean NOT NULL DEFAULT true,
  password_hash text,
  mfa_secret_enc text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  locale text CHECK (locale IN ('ja','en')),
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sign_in_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, oidc_subject)
);
-- Email is the global sign-in identifier for password login.
CREATE UNIQUE INDEX app_users_email ON app_users (lower(email));
ALTER TABLE organizations ADD CONSTRAINT org_primary_admin_fk FOREIGN KEY (primary_admin_id) REFERENCES app_users(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE memberships (
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (org_id, store_id, user_id),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id),
  FOREIGN KEY (org_id, user_id) REFERENCES app_users(org_id, id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  client text NOT NULL CHECK (client IN ('web','ios')),
  state text NOT NULL CHECK (state IN ('mfa_required','mfa_enrollment_required','authenticated')),
  mfa_verified boolean NOT NULL DEFAULT false,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (org_id, user_id) REFERENCES app_users(org_id, id)
);
CREATE INDEX sessions_user ON sessions (org_id, user_id) WHERE revoked_at IS NULL;

CREATE TABLE trusted_devices (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, user_id) REFERENCES app_users(org_id, id)
);

CREATE TABLE login_throttle (
  key text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer','responder','investigator','store_admin','org_admin')),
  store_ids uuid[] NOT NULL DEFAULT '{}',
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

CREATE TABLE password_resets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, user_id) REFERENCES app_users(org_id, id)
);

CREATE TABLE edges (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  name text NOT NULL,
  sign_public_key text NOT NULL,
  box_public_key text NOT NULL,
  certificate_fingerprint text UNIQUE NOT NULL,
  software_version text NOT NULL DEFAULT '',
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  models jsonb NOT NULL DEFAULT '[]'::jsonb,
  clock_offset_ms integer,
  revoked_at timestamptz,
  revoke_reason text,
  config_version bigint NOT NULL DEFAULT 1,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, store_id, id),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id)
);

CREATE TABLE edge_pairing_codes (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  code_hash text NOT NULL UNIQUE,
  device_name text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id)
);

CREATE TABLE edge_nonces (
  edge_id uuid NOT NULL,
  nonce text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (edge_id, nonce)
);

CREATE TABLE cameras (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  edge_id uuid,
  name text NOT NULL,
  location text NOT NULL DEFAULT '',
  address text NOT NULL,
  rtsp_path text,
  endpoint_uuid text,
  vendor text,
  model text,
  credential_sealed text,
  stream_profile text NOT NULL DEFAULT 'substream' CHECK (stream_profile IN ('substream','mainstream')),
  readiness text NOT NULL DEFAULT 'pending' CHECK (readiness IN ('pending','ready','degraded','offline','disabled')),
  analysis_state text NOT NULL DEFAULT 'unavailable' CHECK (analysis_state IN ('unavailable','activation_requested','analyzing','paused','degraded')),
  channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_report jsonb,
  zones jsonb NOT NULL DEFAULT '[]'::jsonb,
  zones_version bigint NOT NULL DEFAULT 0,
  zones_acked_version bigint NOT NULL DEFAULT 0,
  last_frame_at timestamptz,
  snapshot_media_id uuid,
  snapshot_at timestamptz,
  activated_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, store_id, id),
  UNIQUE (org_id, store_id, address),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id),
  FOREIGN KEY (org_id, store_id, edge_id) REFERENCES edges(org_id, store_id, id)
);

CREATE TABLE camera_outages (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  camera_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason text NOT NULL,
  FOREIGN KEY (org_id, camera_id) REFERENCES cameras(org_id, id)
);
CREATE INDEX camera_outages_cam ON camera_outages (org_id, camera_id, started_at);

-- Accumulated analyzed camera time (denominator for false alerts per camera-hour).
CREATE TABLE camera_analysis_time (
  org_id uuid NOT NULL,
  camera_id uuid NOT NULL,
  day date NOT NULL,
  seconds integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, camera_id, day),
  FOREIGN KEY (org_id, camera_id) REFERENCES cameras(org_id, id)
);

CREATE TABLE edge_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  edge_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('discover','provision_camera','activate_camera','pause_camera','update_zones','model_rollout','gallery_update')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','succeeded','failed','expired')),
  result jsonb,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, store_id, edge_id) REFERENCES edges(org_id, store_id, id)
);
CREATE INDEX edge_commands_pending ON edge_commands (edge_id, created_at) WHERE status IN ('queued','sent');

CREATE TABLE discovery_jobs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  edge_id uuid NOT NULL,
  command_id uuid NOT NULL,
  interface text NOT NULL,
  timeout_s integer NOT NULL,
  cidr text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  devices jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (org_id, store_id, edge_id) REFERENCES edges(org_id, store_id, id)
);

CREATE TABLE media (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  store_id uuid,
  purpose text NOT NULL CHECK (purpose IN ('profile_photo','profile_thumb','evidence','snapshot','query_photo','export','diagnostics')),
  storage_key text UNIQUE NOT NULL,
  wrapped_key text NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  expires_at timestamptz,
  hold_reason text,
  hold_review_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id)
);
CREATE INDEX media_expiry ON media (expires_at) WHERE deleted_at IS NULL AND hold_reason IS NULL;

CREATE TABLE incidents (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  camera_id uuid,
  seq bigint NOT NULL,
  event_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('behavior_candidate','watchlist_candidate','checkout_exception','rfid_exception','manual_observation')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','reviewing','resolved')),
  outcome text CHECK (outcome IN ('confirmed','false_alert','inconclusive')),
  outcome_reason text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  assignee uuid,
  description text NOT NULL DEFAULT '',
  observed_behavior text,
  loss_value numeric(14,2) CHECK (loss_value IS NULL OR loss_value >= 0),
  recovered_value numeric(14,2) CHECK (recovered_value IS NULL OR recovered_value >= 0),
  currency text NOT NULL DEFAULT 'JPY',
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate_reason text,
  uncertainty jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_version text NOT NULL DEFAULT 'human',
  preprocessing_version text,
  evidence_state text NOT NULL CHECK (evidence_state IN ('pending','available','unavailable','expired')),
  evidence_sha256 text,
  profile_id uuid,
  association_decision text CHECK (association_decision IN ('accepted','rejected')),
  escalated_at timestamptz,
  ack_deadline timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_by uuid,
  captured_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  delayed boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (org_id, id),
  UNIQUE (org_id, event_id),
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id),
  FOREIGN KEY (org_id, store_id, camera_id) REFERENCES cameras(org_id, store_id, id),
  FOREIGN KEY (org_id, assignee) REFERENCES app_users(org_id, id),
  CHECK (status <> 'resolved' OR outcome IS NOT NULL),
  CHECK (outcome IS NULL OR (outcome_reason IS NOT NULL AND length(outcome_reason) > 0))
);
CREATE INDEX incidents_store_time ON incidents (org_id, store_id, captured_at DESC, id);
CREATE INDEX incidents_open ON incidents (org_id, store_id, status) WHERE status <> 'resolved';

CREATE TABLE incident_counters (
  org_id uuid PRIMARY KEY REFERENCES organizations(id),
  next_seq bigint NOT NULL DEFAULT 1
);

CREATE TABLE incident_evidence (
  org_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  media_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('clip','frame')),
  PRIMARY KEY (org_id, incident_id, media_id),
  FOREIGN KEY (org_id, incident_id) REFERENCES incidents(org_id, id),
  FOREIGN KEY (org_id, media_id) REFERENCES media(org_id, id)
);

CREATE TABLE incident_notes (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, incident_id) REFERENCES incidents(org_id, id),
  FOREIGN KEY (org_id, author_id) REFERENCES app_users(org_id, id)
);

CREATE TABLE reviews (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  reason text NOT NULL CHECK (length(reason) > 0),
  outcome text CHECK (outcome IN ('confirmed','false_alert','inconclusive')),
  from_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, incident_id) REFERENCES incidents(org_id, id),
  FOREIGN KEY (org_id, actor_id) REFERENCES app_users(org_id, id)
);

CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('staff','watchlist')),
  reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 80),
  display_name text NOT NULL DEFAULT '',
  basis text NOT NULL DEFAULT '',
  role_context text,
  notice_recorded boolean NOT NULL DEFAULT false,
  source_incident_id uuid,
  status text NOT NULL CHECK (status IN ('draft','pending_review','approved','suspended','expired','deleted')),
  created_by uuid NOT NULL,
  approved_by uuid,
  review_reason text,
  expires_at timestamptz NOT NULL,
  review_at timestamptz,
  gallery_state text NOT NULL DEFAULT 'not_in_gallery' CHECK (gallery_state IN ('not_in_gallery','face_sdk_unavailable','in_gallery')),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, kind, reference),
  FOREIGN KEY (org_id, approved_by) REFERENCES app_users(org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES app_users(org_id, id),
  FOREIGN KEY (org_id, source_incident_id) REFERENCES incidents(org_id, id)
);
CREATE INDEX profiles_active ON profiles (org_id, kind, status, expires_at);
ALTER TABLE incidents ADD CONSTRAINT incidents_profile_fk FOREIGN KEY (org_id, profile_id) REFERENCES profiles(org_id, id);

CREATE TABLE profile_scopes (
  org_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  store_id uuid NOT NULL,
  PRIMARY KEY (org_id, profile_id, store_id),
  FOREIGN KEY (org_id, profile_id) REFERENCES profiles(org_id, id),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id)
);

CREATE TABLE profile_photos (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  media_id uuid,
  thumb_media_id uuid,
  sha256 text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  quality jsonb NOT NULL,
  provenance text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','deleted')),
  reviewed_by uuid,
  review_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, profile_id) REFERENCES profiles(org_id, id),
  FOREIGN KEY (org_id, media_id) REFERENCES media(org_id, id),
  FOREIGN KEY (org_id, thumb_media_id) REFERENCES media(org_id, id)
);

CREATE TABLE face_templates (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  photo_id uuid NOT NULL,
  encrypted_key text NOT NULL,
  sdk_version text NOT NULL,
  template_format text NOT NULL,
  gallery_revision bigint NOT NULL,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, profile_id) REFERENCES profiles(org_id, id),
  FOREIGN KEY (org_id, photo_id) REFERENCES profile_photos(org_id, id)
);

CREATE TABLE cases (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  store_id uuid,
  seq bigint NOT NULL,
  owner_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('open','closed')),
  close_reason text,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, owner_id) REFERENCES app_users(org_id, id),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id)
);

CREATE TABLE case_incidents (
  org_id uuid NOT NULL,
  case_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, case_id, incident_id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, incident_id) REFERENCES incidents(org_id, id)
);

CREATE TABLE case_notes (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  case_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id)
);

CREATE TABLE exports (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  case_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  redaction text NOT NULL CHECK (redaction IN ('none','blur_bystanders','faces_and_bystanders')),
  reason text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','ready','failed','expired')),
  manifest jsonb,
  media_id uuid,
  error text,
  expires_at timestamptz NOT NULL,
  download_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, idempotency_key),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id)
);

CREATE TABLE store_policies (
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('detection_rules','calibration','escalation','notification_routing')),
  settings jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, store_id, kind),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id)
);

CREATE TABLE org_settings (
  org_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('general','privacy')),
  settings jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind)
);

CREATE TABLE integrations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pos','rfid','vms')),
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_enc text NOT NULL,
  last_event_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id)
);

CREATE TABLE integration_nonces (
  integration_id uuid NOT NULL REFERENCES integrations(id),
  nonce text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, nonce)
);

CREATE TABLE pos_events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('scan','void','refund','suspend','payment','heartbeat')),
  lane text,
  transaction_id text,
  barcode text,
  item_count integer,
  amount numeric(14,2),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, store_id) REFERENCES stores(org_id, id)
);
CREATE INDEX pos_events_time ON pos_events (org_id, store_id, occurred_at);

CREATE TABLE models (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  model_version text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('behavior','watchlist','checkout','person','pose','tracker')),
  manifest jsonb NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  license_status text NOT NULL DEFAULT 'unverified' CHECK (license_status IN ('unverified','cleared','restricted','rejected')),
  license_note text,
  validation_status text NOT NULL DEFAULT 'not_validated' CHECK (validation_status IN ('not_validated','passed','failed')),
  validation_note text,
  rollout_state text NOT NULL DEFAULT 'registered' CHECK (rollout_state IN ('registered','shadow','canary','active','rolled_back','retired')),
  canary_camera_id uuid,
  version bigint NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name, model_version)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  incident_id uuid,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY (org_id, user_id) REFERENCES app_users(org_id, id)
);
CREATE INDEX notifications_unread ON notifications (org_id, user_id) WHERE read_at IS NULL;

CREATE TABLE push_devices (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_id uuid,
  token_hash text NOT NULL,
  token_ciphertext text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  bundle_id text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, token_hash),
  FOREIGN KEY (org_id, user_id) REFERENCES app_users(org_id, id)
);

CREATE TABLE support_requests (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  store_id uuid,
  category text NOT NULL,
  description text NOT NULL,
  media_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  seq bigserial,
  store_id uuid,
  actor_id uuid,
  actor_kind text NOT NULL DEFAULT 'user' CHECK (actor_kind IN ('user','edge','system','integration')),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  result text NOT NULL DEFAULT 'success' CHECK (result IN ('success','denied','failed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text NOT NULL,
  prev_hash text,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_time ON audit (org_id, created_at DESC, seq DESC);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_key text NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, topic)
);
CREATE INDEX outbox_pending ON outbox (available_at) WHERE delivered_at IS NULL AND dead_at IS NULL;

CREATE TABLE worker_heartbeat (
  name text PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Row level security: tenant isolation as defense in depth. API authorization still
-- enforces role + store scope on every request.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.org_id', true), '')::uuid);

DO $$ DECLARE n text; BEGIN
FOREACH n IN ARRAY ARRAY['stores','app_users','memberships','sessions','trusted_devices','invitations',
  'password_resets','edges','edge_pairing_codes','cameras','camera_outages','camera_analysis_time',
  'edge_commands','discovery_jobs','media','incidents','incident_counters','incident_evidence',
  'incident_notes','reviews','profiles','profile_scopes','profile_photos','face_templates','cases',
  'case_incidents','case_notes','exports','store_policies','org_settings','integrations','pos_events',
  'models','notifications','push_devices','support_requests','audit','outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', n);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid) WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid)', n);
END LOOP;
END $$;

-- Pre-authentication lookups. These run as the table owner (BYPASSRLS) and return only
-- what is needed to establish the tenant context; callers then SET LOCAL app.org_id.
CREATE FUNCTION rg_user_for_login(p_email text)
RETURNS TABLE (id uuid, org_id uuid, password_hash text, active boolean, role text, mfa_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, org_id, password_hash, active, role, mfa_enabled FROM app_users WHERE lower(email) = lower(p_email)
$$;

CREATE FUNCTION rg_session_lookup(p_token_hash text)
RETURNS TABLE (id uuid, org_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, org_id, user_id FROM sessions
  WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
$$;

CREATE FUNCTION rg_edge_lookup(p_edge_id uuid)
RETURNS TABLE (id uuid, org_id uuid, store_id uuid, sign_public_key text, revoked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, org_id, store_id, sign_public_key, revoked_at IS NOT NULL FROM edges WHERE id = p_edge_id
$$;

CREATE FUNCTION rg_pairing_lookup(p_code_hash text)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, org_id FROM edge_pairing_codes WHERE code_hash = p_code_hash AND used_at IS NULL AND expires_at > now()
$$;

CREATE FUNCTION rg_invitation_lookup(p_token_hash text)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, org_id FROM invitations
  WHERE token_hash = p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
$$;

CREATE FUNCTION rg_reset_lookup(p_token_hash text)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, org_id FROM password_resets WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
$$;

CREATE FUNCTION rg_integration_lookup(p_id uuid)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, org_id FROM integrations WHERE id = p_id
$$;

CREATE FUNCTION rg_oidc_user(p_subject text, p_email text)
RETURNS TABLE (id uuid, org_id uuid, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, org_id, active FROM app_users
  WHERE oidc_subject = p_subject OR (oidc_subject IS NULL AND lower(email) = lower(p_email))
  ORDER BY (oidc_subject = p_subject) DESC NULLS LAST LIMIT 1
$$;

REVOKE ALL ON FUNCTION rg_user_for_login(text), rg_session_lookup(text), rg_edge_lookup(uuid),
  rg_pairing_lookup(text), rg_invitation_lookup(text), rg_reset_lookup(text), rg_integration_lookup(uuid),
  rg_oidc_user(text, text) FROM PUBLIC;
