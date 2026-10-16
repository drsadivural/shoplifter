# RetailGuard API v1 — implemented contract

This is the contract implemented by `services/api` (FastAPI). The machine-readable
version is generated at `packages/contracts/openapi.json` (`make contracts`).
Web (`apps/web`), iOS (`apps/ios`) and edge (`services/edge`) clients use this
document and the generated OpenAPI. `docs/API.md` (package requirements) remains
the requirement source; this file states what the code actually does.

## Conventions

- Base path `/v1`. JSON request/response bodies (UTF-8). Timestamps RFC 3339 UTC
  (`2026-10-11T01:42:18Z`). Clients convert to the **store timezone** for display.
- IDs are opaque UUID strings. Never construct them client-side.
- Every mutation returns the updated entity (with `version`) and writes an audit
  record. Every response carries header `X-Request-ID`.
- **Optimistic concurrency**: mutable entities have integer `version`. State
  transitions and edits take `expected_version`; a stale value returns `409` with
  `current_version` in the error body. Clients must refetch, show the current
  state, and never blindly retry with the new version.
- **Lists**: `{"items": [...], "next_cursor": "opaque" | null}`; pass
  `?cursor=...&limit=1..100` (default 50). Ordering is stable.
- **Errors**: HTTP status + body
  `{"code": "snake_case", "message": "safe text", "request_id": "...", "retriable": false,
    "field_errors": {"field": "code"}?, "current_version": 3?}`.
  Status meaning: 400 malformed, 401 no/expired session (`code` =
  `authentication_required` | `session_expired` | `mfa_required` |
  `mfa_enrollment_required`), 403 forbidden (`code` = `forbidden`), 404 not found or
  not in scope, 409 version/idempotency conflict, 413 too large, 415 unsupported
  media, 422 validation (`field_errors`), 429 rate limited, 503 dependency
  unavailable (`code` e.g. `face_sdk_unavailable`, `model_unavailable`,
  `edge_unavailable`, `push_unconfigured`).

## Authentication

### Browser (BFF cookie session)
- Session cookie `rg_session` (HttpOnly, Secure, SameSite=Strict) set by the API.
- CSRF: cookie `rg_csrf` (readable by JS). Every non-GET request **must** send
  header `X-CSRF-Token: <rg_csrf value>`. Missing/mismatched → 403 `csrf_failed`.
- Always use `credentials: "include"`/same-origin fetch. The web app is served from
  the same origin as `/v1` (Caddy routes `/v1/*` to the API).

### iOS (bearer)
- `POST /v1/auth/login` with `"client": "ios"` returns `token`. Send
  `Authorization: Bearer <token>`. Store in Keychain
  (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`). No CSRF header needed for bearer.

### Endpoints
| Method | Path | Body → Response |
|---|---|---|
| GET | `/v1/auth/config` | → `{oidc_enabled: bool, password_login: true, mfa_required_roles: ["org_admin","investigator"], support_contact: str|null}` (public) |
| POST | `/v1/auth/login` | `{email, password, client?: "web"|"ios"}` → `{state: "authenticated"|"mfa_required"|"mfa_enrollment_required", token?: str (ios only), expires_at}`. Wrong email or password → 401 `invalid_credentials` (identical for unknown email). 429 `rate_limited` after repeated failures. |
| POST | `/v1/auth/mfa/verify` | `{code?: "123456", recovery_code?: str, trust_device?: bool}` → `{state: "authenticated"}`; 401 `invalid_code` |
| GET | `/v1/auth/mfa/setup` | → `{secret, otpauth_uri}` (only while enrolling) |
| POST | `/v1/auth/mfa/enable` | `{code}` → `{state: "authenticated", recovery_codes: [10 strings]}` (shown once) |
| POST | `/v1/auth/logout` | → `{ok: true}` |
| GET | `/v1/auth/oidc/start` | 302 to IdP (Authorization Code + PKCE) when configured; else 503 `oidc_unconfigured` |
| GET | `/v1/auth/oidc/callback` | IdP redirect target; sets session, 302 to `/web/dashboard` |
| POST | `/v1/auth/password-reset/request` | `{email}` → 202 `{ok: true}` always (never reveals account existence) |
| POST | `/v1/auth/password-reset/complete` | `{token, new_password}` → `{ok: true}`; 422 `weak_password` / `invalid_or_expired_token` |
| POST | `/v1/auth/invitations/accept` | `{token, display_name, password}` → `{ok: true}` |
| GET | `/v1/me` | → `Me` (below) |
| PATCH | `/v1/me/preferences` | `{locale?: "ja"|"en", theme?: "light"|"dark"|"system", notification_prefs?: NotificationPrefs}` → `Me` |
| GET | `/v1/me/sessions` | → `{items: [{id, client, created_at, last_seen_at, expires_at, current: bool, user_agent}]}` |
| DELETE | `/v1/me/sessions/{id}` | revoke one of own sessions |
| POST | `/v1/me/password` | `{current_password, new_password}` → `{ok, other_sessions_revoked}`. Wrong current password → 422 `field_errors.current_password=incorrect` (rate-limited, 429 after 5 failures); weak → 422 `weak_password`; same as current → 422 `same_as_current`; SSO-only account → 409 `password_not_set`. Signs out every other session; the current one stays. |
| POST | `/v1/me/mfa/disable` | `{password, code}` or `{password, recovery_code}` → `{ok}`. Turns off the caller's own authenticator app. 409 `mfa_required_by_policy` when the organization requires it for the caller's role; 409 `mfa_not_enabled`; wrong password/code → 422 `field_errors.{password,code}` (rate-limited, 429). Clears the secret, recovery codes and remembered browsers; open sessions become not MFA-verified (evidence export needs a verified session). Turning it on uses `GET /v1/auth/mfa/setup` + `POST /v1/auth/mfa/enable` from a signed-in session. |

`Me = {user: {id, email, display_name, role, locale, theme, mfa_enabled, mfa_required, notification_prefs}, org: {id, name, timezone, region}, stores: [{id, name, timezone, region}], permissions: [action strings], session: {id, expires_at, mfa_verified}, unread_notifications: int}`

Roles: `viewer`, `responder`, `investigator`, `store_admin`, `org_admin`.
Permission action strings (from `GET /v1/roles`):
`dashboard.read, incident.read, incident.create, incident.respond, incident.reopen, case.read, case.manage, export.create, search.metadata, search.photo, profile.read, staff.manage, watchlist.manage, watchlist.approve, photo.read, camera.read, camera.manage, edge.manage, store.read, store.manage, policy.manage, integration.manage, report.read, audit.read, user.manage, org.manage, model.manage, privacy.manage, health.read, support.create`.
Clients hide controls the user lacks; the server enforces regardless.

`NotificationPrefs = {behavior: bool, watchlist: bool, checkout: bool, rfid: bool, sound: bool, private_preview: true, quiet_hours: {start: "22:00", end: "07:00"}|null, store_ids: [ids]}`

## Organization, stores, users

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/v1/org` | `{id, name, timezone, region, primary_admin_id, version}`; PATCH `{expected_version, name?, timezone?, region?, primary_admin_id?}` (org.manage) |
| GET/PUT | `/v1/org/settings/{kind}` | kind `general` `{default_locale, session_timeout_minutes, currency, require_mfa_for_privileged_roles}` (default `true`: org_admin, store_admin and investigator must use an authenticator app; `false` makes it each person's choice) or `privacy` `{raw_video_retention_hours, evidence_retention_days, profile_max_expiry_days, query_photo_ttl_minutes, legal_hold_review_days, deletion_contact}` → `{kind, settings, version, updated_at, updated_by}`; PUT `{expected_version, settings}` |
| GET | `/v1/stores` | items `Store = {id, name, region, address, timezone, manager_name, opening_hours, version, camera_count, cameras_ready, open_alerts, edge_state: "unpaired"|"online"|"offline"}` |
| POST | `/v1/stores` | `{name, region, address, timezone, manager_name, opening_hours}` → Store |
| GET/PATCH | `/v1/stores/{id}` | GET adds `summary: {coverage: {cameras_total, cameras_ready, cameras_analyzing}, open_incidents, review_queue, last_refresh}` |
| GET/PUT | `/v1/stores/{id}/policies/{kind}` | kinds: `detection_rules`, `calibration`, `escalation`, `notification_routing` → `{kind, store_id, settings, version, updated_at, updated_by}` |
| GET | `/v1/users` | items `{id, email, display_name, role, store_ids, mfa_enabled, active, last_sign_in_at, version}` (user.manage) |
| PATCH | `/v1/users/{id}` | `{expected_version, role?, store_ids?, active?}`; cannot demote/deactivate self or remove last org_admin (409 `last_admin`/403 `self_lockout`) |
| POST | `/v1/users/invitations` | `{email, role, store_ids, expires_in_days (1-14)}` → `{id, accept_url, expires_at}` — URL shown once; deliver via approved channel |
| GET | `/v1/users/invitations` | pending invitations |
| DELETE | `/v1/users/invitations/{id}` | revoke |
| POST | `/v1/users/{id}/password-reset-link` | → `{reset_url, expires_at}` (shown once) |
| POST | `/v1/users/{id}/sessions/revoke` | revoke all sessions |
| GET | `/v1/roles` | `{roles: [..], actions: [{action, roles: [..]}]}` |
| GET | `/v1/team?store_id=` | responders/admins with store access `{id, display_name, role, on_duty: bool}` |

## Edge appliances and cameras

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/stores/{id}/edge-pairing-codes` | `{device_name}` → `{code, expires_at}` (single use, 15 min) |
| GET | `/v1/edges` | `{id, store_id, name, fingerprint, software_version, last_seen_at, state: "online"|"offline"|"revoked", health}` |
| POST | `/v1/edges/{id}/revoke` | `{reason}` |
| GET | `/v1/cameras?store_id=` | items `Camera` |
| POST | `/v1/cameras` | manual add `{store_id, name, location, address, username?, password?, stream_profile: "substream"|"mainstream", rtsp_path?}` → Camera (readiness `pending`). Password is sealed to the store edge's public key immediately and never returned/logged. 422 `address_not_permitted` if outside allowed subnets. |
| POST | `/v1/cameras/rtsp` | manual add by URL when ONVIF discovery finds nothing: `{store_id, name, location, url: "rtsp[s]://[user:pass@]IP[:port]/path[?query]", username?, password?}` → Camera (`source_type: "rtsp"`, `rtsp_scheme`, `rtsp_port` default 554/322, `rtsp_path` incl. query). The host must be a literal private IP inside the allowed subnets. A `user:pass@` part (or `username`/`password`) is sealed to the edge and never stored with the URL; 409 `edge_required` without a paired appliance. 422 `field_errors.url`: `rtsp_url_required`, `ip_address_required`, `address_not_permitted`, `invalid_rtsp_path`, `duplicate` (same address+port+path; other NVR channels are separate cameras). The edge reads the stream directly (no ONVIF). |
| POST | `/v1/cameras/import` | `{store_id, csv, username?, password?, dry_run: bool}` CSV columns `name,location,address[,stream_profile]` → `{rows: [{line, name, address, status: "valid"|"invalid"|"created", errors: [codes]}], created: int}`; never silently skips |
| GET/PATCH | `/v1/cameras/{id}` | PATCH `{expected_version, name?, location?}` |
| POST | `/v1/cameras/{id}/provision` | asks edge to authenticate/probe/decode sample → command id |
| POST | `/v1/cameras/{id}/activate` | `{expected_version, channels: ["behavior","watchlist","checkout"]}`; 409 `camera_not_ready` unless readiness `ready` |
| POST | `/v1/cameras/{id}/pause` | `{expected_version}` |
| GET/PUT | `/v1/cameras/{id}/zones` | `{version, zones: [{id, type: "shelf"|"checkout"|"exit_line"|"privacy_mask", label, points: [[x,y],...] (0..1), direction?: "in"|"out"}], acknowledged_version}`; PUT `{expected_version, zones}` |
| POST | `/v1/discovery-jobs` | `{store_id, interface?, timeout_s (1-30), cidr?, include_usb? (default true)}` → job; without `interface` the edge probes from every private IPv4 interface; with `include_usb` it also lists USB (V4L2) cameras attached to it. 503 `edge_unavailable` if no online edge |
| GET | `/v1/discovery-jobs/{id}` | `{id, status: "queued"|"running"|"completed"|"failed", devices: [{kind: "onvif"|"usb", endpoint, address, xaddrs, scopes, vendor?, model?, already_added}], error?}`. USB entries: `endpoint` = `usb:<device path>`, `address` = device path (`/dev/v4l/by-id/...` or `/dev/videoN`), `model` = device name |
| POST | `/v1/discovery-jobs/{id}/add` | `{endpoint, name, location, username, password, stream_profile}` → Camera (`source_type` `onvif`, or `usb` for a USB entry: credentials ignored) |

`Camera = {id, store_id, edge_id, name, location, address, vendor, model, stream_profile, readiness: "pending"|"ready"|"degraded"|"offline"|"disabled", analysis_state: "unavailable"|"activation_requested"|"analyzing"|"paused"|"degraded", channels: {behavior: state, watchlist: state, checkout: state}, readiness_report: {checked_at, codec, width, height, fps, decoded_seconds, monotonic_time, errors: []}|null, last_frame_at, snapshot: {media_id, captured_at}|null, activated_at, has_credentials: bool, version}`.
Channel state: `not_requested | unavailable | starting | running | degraded` with optional `reason` (e.g. `model_not_installed`, `face_sdk_unavailable`, `pos_unconfigured`).

### Edge-authenticated API (`services/edge` only)
Pairing: `POST /v1/edge/pair` `{code, device_name, sign_public_key (base64 Ed25519), box_public_key (base64 X25519), software_version}` → `{edge_id, org_id, store_id, store_timezone, allowed_subnets: [cidr], api_version: 1}`.

All other edge calls are signed. Headers:
`X-Edge-Id`, `X-Edge-Timestamp` (unix seconds), `X-Edge-Nonce` (random ≥16 chars),
`X-Edge-Signature` = base64 Ed25519 signature over
`"{METHOD}\n{PATH}\n{timestamp}\n{nonce}\n{sha256_hex(body)}"` (PATH includes the query string). Window ±300 s; nonces single use; revoked edge → 401.

| Method | Path | Body |
|---|---|---|
| POST | `/v1/edge/heartbeat` | `{software_version, clock_offset_ms?, health: {disk_free_bytes?, disk_total_bytes?, gpu_utilization?, decode_latency_ms_p95?, queue_age_s?, spool_pending?}, cameras: [{camera_id, readiness, analysis_state, channels: {...}, last_frame_at?, fps?, width?, height?, codec?, error?}], models: [{name, version, sha256}]}` → `{ok, config_version}` |
| GET | `/v1/edge/commands` | → `{items: [{id, kind, payload, created_at}]}` kinds `discover`, `provision_camera`, `activate_camera`, `pause_camera`, `update_zones`, `model_rollout`, `gallery_update` |
| POST | `/v1/edge/commands/{id}/ack` | `{status: "succeeded"|"failed", result: {...}, error?: str}` |
| POST | `/v1/edge/events` | `contracts/event.schema.json`; header `Idempotency-Key: <event_id>`. Same event_id twice → 200 with same incident (no duplicate). |
| PUT | `/v1/edge/events/{event_id}/evidence` | raw `video/mp4` or `image/jpeg` body; header `X-Content-SHA256` must match |
| PUT | `/v1/edge/cameras/{camera_id}/snapshot` | raw `image/jpeg` (privacy masks already applied) |

Command payloads: `discover {job_id, interface, timeout_s, cidr}` → result `{devices: [...]}`;
`provision_camera {camera_id, address, rtsp_path?, stream_profile, credential_sealed?: base64 SealedBox}` → result `{readiness, report}`;
`activate_camera {camera_id, channels, zones, policy}` → result `{channels: {...}}`;
`pause_camera {camera_id}`; `update_zones {camera_id, zones_version, zones}` → result `{zones_version}`.

## Profiles (staff / watchlist) and photos

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/profiles?kind=staff|watchlist&status=&q=&store_id=` | items `Profile` |
| POST | `/v1/profiles` | watchlist: `{kind:"watchlist", reference, display_name? (氏名), last_seen_at? (RFC 3339, not in the future), basis?, source_incident_id?, store_ids, expires_at}`; staff: `{kind:"staff", reference (employee ID), display_name, store_ids, role_context, notice_recorded: true, expires_at}` → Profile `status: "draft"` |
| GET/PATCH | `/v1/profiles/{id}` | GET adds `photos`, `linked_incidents`, `history`; PATCH `{expected_version, ...}` — material changes on approved profile move it back to `pending_review` |
| POST | `/v1/profiles/{id}/photos` | multipart: `file` (JPEG/PNG ≤ 8 MB, ≥ 200×200 px, ≤ 40 MP), `provenance` (text) → Photo. EXIF stripped, re-encoded. |
| POST | `/v1/profiles/{id}/photos/{photo_id}/review` | `{decision: "approved"|"rejected", reason}` |
| DELETE | `/v1/profiles/{id}/photos/{photo_id}` | deletes media + any templates |
| POST | `/v1/profiles/{id}/{action}` | action ∈ `submit, approve, reject, suspend, reinstate, delete`; body `{expected_version, reason}`. Approver must differ from creator. Watchlist approval requires ≥1 approved photo and an unexpired profile; a linked source incident is optional, but when one is linked its human outcome must be `confirmed`. |
| GET | `/v1/photos?kind=&status=` | photo library items `Photo` |

`Profile = {id, kind, reference, display_name, last_seen_at, basis, source_incident_id, store_ids, status: "draft"|"pending_review"|"approved"|"suspended"|"expired"|"deleted", expires_at, review_at, role_context, notice_recorded, photo_count, approved_photo_count, gallery_state: "not_in_gallery"|"face_sdk_unavailable"|"in_gallery", created_by, approved_by, version, created_at}`
`Photo = {id, profile_id, profile_kind, profile_reference, media_id, thumb_media_id, width, height, status: "pending"|"approved"|"rejected"|"deleted", quality: {image: {sharpness, brightness, width, height}, face: {status: "unavailable", reason: "face_sdk_unavailable"}}, provenance, created_at}`

## Incidents, cases, exports

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/incidents?store_id=&channel=&status=&outcome=&assignee=me|<id>&q=&from=&to=&evidence_state=` | items `IncidentSummary` ordered `captured_at desc, id` |
| POST | `/v1/incidents` | manual: `{store_id, camera_id?, description, observed_at?}` → Incident (channel `manual_observation`) |
| GET | `/v1/incidents/{id}` | → `Incident` |
| POST | `/v1/incidents/{id}/claim` | `{expected_version}` → status `acknowledged`, assignee = actor. 409 `owned_by_another_responder` if someone else owns it. |
| POST | `/v1/incidents/{id}/request-review` | `{expected_version, reason}` → status `reviewing` |
| POST | `/v1/incidents/{id}/outcome` | `{expected_version, outcome: "confirmed"|"false_alert"|"inconclusive", reason (required), observed_behavior?, loss_value?, recovered_value?}` → status `resolved`. Must be assignee (claim first). 409 `evidence_pending` for `confirmed` while evidence pending. |
| POST | `/v1/incidents/{id}/escalate` | `{expected_version, reason, priority: "normal"|"high"|"urgent"}` |
| POST | `/v1/incidents/{id}/reopen` | `{expected_version, reason}` (incident.reopen) |
| POST | `/v1/incidents/{id}/notes` | `{body}` |
| GET | `/v1/incidents/{id}/visit` | `{available: false, reason: "reid_unavailable", events: [...camera events of this incident]}` |
| GET | `/v1/incidents/{id}/pos-events` | POS events on mapped lanes within ±5 min |

`IncidentSummary = {id, ref, store_id, store_name, camera_id, camera_name, channel: "behavior_candidate"|"watchlist_candidate"|"checkout_exception"|"rfid_exception"|"manual_observation", status: "new"|"acknowledged"|"reviewing"|"resolved", outcome, priority, assignee: {id, display_name}|null, evidence_state: "pending"|"available"|"unavailable"|"expired", captured_at, ingested_at, delayed: bool, version}`
`Incident = IncidentSummary + {description, signals: {...}, gate_reason, model_version, uncertainty: [str], evidence: [{media_id, mime, sha256, kind: "clip"|"frame"}], notes: [{id, author, body, created_at}], reviews: [{id, actor, action, outcome, reason, created_at}], timeline: [{at, action, actor}], observed_behavior, loss_value, recovered_value, currency, ack_deadline, acknowledged_at, resolved_at, cases: [{id, ref}]}`

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/v1/cases` | POST `{title, store_id?, incident_ids?: []}` |
| GET | `/v1/cases/{id}` | `{id, ref, title, owner, status, incidents, notes, timeline, exports, access_log, version}` |
| POST/DELETE | `/v1/cases/{id}/incidents[/{incident_id}]` | link/unlink `{incident_id}` |
| POST | `/v1/cases/{id}/notes` | `{body}` |
| POST | `/v1/cases/{id}/close` / `reopen` | `{expected_version, reason}` |
| POST | `/v1/exports` | header `Idempotency-Key`; `{case_id, redaction: "none"|"blur_bystanders"|"faces_and_bystanders", reason, recipient, expires_in_days (1-30)}` → Export (requires MFA-verified session) |
| GET | `/v1/exports`, `/v1/exports/{id}`, `/v1/exports/{id}/download` | Export `{id, case_id, status: "queued"|"ready"|"failed"|"expired", manifest: {files: [{name, sha256, size}]}|null, expires_at, recipient, reason, redaction, download_count}` |

## Search, media, reporting, operations

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/search?from=&to=&store_id=&camera_id=&channel=&outcome=&assignee=&profile_id=&evidence_state=` | `{items: IncidentSummary[], next_cursor, coverage: {from, to, retention_cutoff, cameras: [{id, name, store_id, activated_at, outages: [{from, to}]}], gaps: [{camera_id|null, from, to, reason: "before_activation"|"outage"|"beyond_retention"|"no_cameras"}]}}` |
| POST | `/v1/search/photo` | multipart `file` → image validated (422 on invalid/low quality); then 503 `face_sdk_unavailable` while the licensed SDK is absent; query photo is deleted immediately |
| GET | `/v1/media/{id}` | authorized bytes (photos expose separate `media_id` and `thumb_media_id`); `Cache-Control: private, no-store` |
| GET | `/v1/dashboard?store_id=` | `{open_alerts, reviewed_today, cameras: {online, total}, median_ack_seconds|null, awaiting_review: IncidentSummary[], camera_health: [{id, name, readiness, analysis_state, last_frame_at}], trend: [{date, detections, reviewed}], last_refresh}` |
| GET | `/v1/reports/summary?store_id=&from=&to=` | `{detections: {by_channel}, reviewed, confirmed, false_alert, inconclusive, reviewed_precision: {value|null, n, ci95: [lo, hi]|null}, false_alerts_per_camera_hour: {value|null, false_alerts, camera_hours}, median_ack_seconds, confirmed_loss, recovered_value, currency, daily: [...]}` |
| GET | `/v1/checkout/exceptions?store_id=` | checkout_exception incidents + POS availability per store |
| GET/POST | `/v1/integrations` | `{id, store_id, kind: "pos"|"rfid"|"vms", name, config: {lane_map?, clock_offset_ms?}, status: "configured"|"receiving"|"stale", last_event_at, version}`; POST returns `webhook_secret` once |
| PATCH | `/v1/integrations/{id}` | `{expected_version, name?, config?}` |
| POST | `/v1/integrations/{id}/rotate-secret` | → `{webhook_secret}` once |
| POST | `/v1/integrations/{id}/webhook` | external system: HMAC-SHA256 hex over `"{timestamp}.{nonce}.{body}"` in `X-RG-Signature`, headers `X-RG-Timestamp`, `X-RG-Nonce`; body `{events: [{kind: "scan"|"void"|"refund"|"suspend"|"payment"|"heartbeat", lane, transaction_id, barcode?, item_count?, amount?, occurred_at}]}` |
| GET/POST | `/v1/models` | register manifest `{name, version, channel, manifest: {...}}`; items `{id, name, version, channel, sha256, license_status, validation_status, rollout_state, manifest, version_row}` |
| POST | `/v1/models/{id}/{action}` | `license`/`validate` `{expected_version, status, note}`; `rollout` `{expected_version, stage: "shadow"|"canary"|"active", camera_id?}`; `rollback` `{expected_version, reason}` |
| GET | `/v1/audit?actor_id=&action=&store_id=&from=&to=&result=` | `{id, at, actor: {id, display_name}|null, action, resource_type, resource_id, store_id, result, request_id, detail}` |
| GET | `/v1/health/system` | `{edges: [...], cameras: {...}, outbox: {pending, oldest_pending_age_s, dead_letter}, worker: {last_seen_at}, dependencies: {face_sdk, behavior_model, apns, oidc, smtp}: "available"|"unavailable"|"unconfigured"}` |
| GET | `/v1/notifications` / POST `/v1/notifications/read` `{ids?: [] (all if omitted)}` | in-app notices `{id, kind, incident_id, created_at, read_at}` |
| POST | `/v1/push/devices` | `{token, environment: "sandbox"|"production", bundle_id}` → `{id}`; DELETE `/v1/push/devices/{id}` |
| POST | `/v1/support/bundles` | `{category, store_id?, consent: true, description}` → `{id, download_url, expires_at}` (redacted diagnostics) |
| POST | `/v1/incidents/{id}/legal-hold` | `{reason, review_days?}` → keeps evidence beyond retention until review (privacy.manage) |
| POST | `/v1/incidents/{id}/legal-hold/release` | `{reason}` |
| GET | `/v1/privacy/holds` | active holds `{id, ref, store_id, legal_hold_reason, legal_hold_review_at, placed_by, review_overdue}` |
| GET/POST | `/v1/privacy/requests` | data-subject requests `{kind: "access"|"correction"|"deletion", subject_reference, received_at, notes}` → `{id, status: "open"|"completed"|"rejected", due_at, overdue, version, ...}` |
| POST | `/v1/privacy/requests/{id}/complete` | `{expected_version, status: "completed"|"rejected", resolution}` |
| GET | `/v1/audit/verify` | recompute the audit hash chain `{valid, checked, head}` (org.manage) |
| GET | `/healthz`, `/readyz` | liveness / dependency readiness |

## Clarifications (resolved during implementation)
- `/v1/incidents` and `/v1/search` also accept comma-separated `status`/`channel`, `priority`, `open=1`,
  `assignee=none`; list items include `store_timezone` for display.
- `/v1/dashboard` also returns `preview` (latest camera snapshot), `cameras.analyzing`, `acknowledged_today`, `timezone`.
- Edge `event_id` is a deterministic UUIDv5 computed by the edge over org/camera/track/window/channel; it is
  also the `Idempotency-Key`. This is the one identifier the edge mints (it must be stable across retries).
- Command acks: `provision_camera` acks `succeeded` only when readiness is `ready`, otherwise `failed` with
  `error` = first error code and full `{readiness, report}`; the API still records the report. `activate_camera`
  acks `succeeded` with honest per-channel states (`unavailable` + reason when no model/SDK is installed); the
  API sets `analysis_state=analyzing` only if some channel is `running`. `gallery_update` acks
  `failed`/`face_sdk_unavailable`. `model_rollout` reports local installation status only (no download endpoint).
- `credential_sealed` plaintext is JSON `{"username", "password"}` sealed with libsodium SealedBox to the
  edge's X25519 key.
- Evidence: one `PUT .../evidence` per file (clip `video/mp4` or frame `image/jpeg`, detected from bytes);
  the event's `evidence_sha256` refers to the primary clip.
- `clock_offset_ms` = edge clock − server clock (from the HTTP `Date` header; 1 s resolution).
- Signed path = raw percent-encoded path plus query string exactly as sent.
- Readiness reports may carry extra diagnostic keys; the API stores the documented subset plus `conformance`.
