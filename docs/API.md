# API and event contract

All production endpoints use `/v1`, authenticated actor context and organization/store permissions. Timestamps are RFC3339 UTC with captured_at and ingested_at distinct. IDs are UUID/opaque. All mutations return updated entity/version and request ID, and write audit/outbox atomically. Idempotency-Key is required for edge events, commands that create export jobs and duplicate-prone mobile submissions. Request bodies never contain caller-chosen administrative roles.

## Endpoint groups
| Group | Required endpoints / behavior |
|---|---|
| Identity | OIDC start/callback/logout; me; active sessions; revoke; MFA requirements |
| Organization | GET/PATCH settings with version, create/list regional stores, store membership |
| Users | invite, accept, scoped role changes, revoke, expire invitation |
| Edge | single-use pairing; certificate issue/rotate/revoke; config; heartbeat; command acknowledgements |
| Cameras | scan job start/status, discovered devices, add/auth/profile/readiness, zones/policy, activate/pause, health, live relay token |
| Profiles | staff/watchlist create/list/read/update, photo upload/quality/delete, submit/approve/suspend/expire, gallery revision |
| Incidents | paginated inbox/history, retrieve, claim, escalate, outcome, note, evidence link |
| Cases | create/link/unlink, notes, timeline, close/reopen with reason |
| Search | metadata query, temporary photo query/job, candidate associations/rejections, coverage metadata |
| Media | authorized upload/download, short-lived URLs, redaction, export jobs/status/manifests |
| Integrations | POS/RFID/VMS config/test/health, signed ingestion, mapping, replay protection |
| Operations | dashboard metrics, audit/events, model registry, evaluation/rollout/rollback, diagnostics, retention/hold/delete |
| Push | register device/APNs environment, revoke token, user notification preferences |

## Incident states
new → acknowledged → reviewing → resolved. Explicit inconclusive can resolve or remain under review according to store policy; record outcome independently from workflow status. Escalation changes ownership/priority and creates notification tasks; it does not set a confirmed outcome. Reopen requires authorized reason and increments version. Confirmed, false_alert and inconclusive are human outcomes; use suspected_behavior/watchlist_candidate/checkout_exception/rfid_exception as event types.

Claim and review request includes expected_version. Server checks current version and actor permission inside one transaction. Conflict returns 409 plus current version; no lost update. At least one reviewer sees evidence before outcome. Another responder cannot overwrite ownership implicitly. Watchlist identity verification has a separate association review field.

## Errors
400 malformed payload, 401 missing/expired session, 403 action/scope denied, 404 inaccessible/nonexistent opaque resource, 409 conflicting version/idempotency mismatch, 413 file too large, 422 schema/quality invalid, 429 rate limit, 503 required pipeline unavailable. Error body: code, safe message, request_id, retriable and optional field errors/current_version. No SDK exception or secret leaks.

## Edge event
See contracts/event.schema.json. event_id is a deterministic unique event identifier retained by the edge outbox. Captured time and media checksum remain stable across retry. Require store/camera certificate binding, model/preprocessing version and gate reason. Media may arrive after metadata; incident evidence_state distinguishes pending, available, unavailable and expired. Do not resolve an incident as confirmed while expected evidence is still pending without separately documented evidence.

## Local reference endpoints
- POST /api/login {email,password}; POST /api/logout; GET /api/me.
- GET/POST /api/cameras; camera creation stores metadata with state pending.
- GET/POST /api/profiles; filters kind and q. POST /api/profiles/{id}/photos {filename,data_base64}.
- GET/POST /api/incidents; q/type/outcome metadata filters. GET /api/incidents/{id}.
- POST /api/incidents/{id}/transition {action,expected_version,reason,outcome}; actions acknowledge/review/resolve.
- GET /api/audit; GET /api/photos/{id} returns authorized bytes.

Reference API supports manual records, not real edge ML/APNs or biometric photo search. Native reference source and functional workbench use exactly these endpoints. Production will generate typed clients from actual OpenAPI rather than continuing handwritten JS contracts.
