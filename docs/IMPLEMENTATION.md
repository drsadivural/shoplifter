# Milestones and detailed build instructions

## M0 — Setup and contract baseline
Read all sources and enumerate designs. Preserve the current connected reference client for regression. Create monorepo and environments. Add schema validation, migrations and CI. Generate tokens/JA/EN catalogs. Deliver coverage ledger, architecture decision records, dependency/license lockfiles and local test commands. Exit: every screen accounted for; reference tests pass; no real SDK/model methods invented.

## M1 — Identity, stores and UI shell
Create enterprise OIDC login/BFF, callback/session/logout/me and active session revocation. Configure org/store memberships and permission checks. Build login/MFA/recovery/setup/store/user/roles screens. Add Japanese/English i18n, UTC/store-time conversion, responsive nav and light/dark. Exit: org/store denied tests, MFA admin policy, login E2E and accessibility focus checks.

## M2 — Store edge and cameras
Build signed pairing flow and certificate revocation. Package Linux appliance services with read-only OS user, encrypted persistent spool and diagnostics. Integrate ONVIF SOAP client with credentials in edge vault. Implement discover/add/bulk/profile/readiness/zones/activate UI and commands. Decoder uses recent-frame bounded queue and watchdog; ffmpeg invoked without shell interpolation and redacted logs. Add main-stream evidence ring buffer with monitored storage. Exit: real ONVIF device discovery, 10s decoded frames, physical outage/restart tests, pending/degraded UI and secure target rejection.

## M3 — Enrollment and licensed face adapter
Integrate Ayonix SDK from supplied documentation/package; record license/version/template compatibility. Implement encrypted photo upload/quality/transcode/template gallery and per-store approvals. Version galleries and edge acks. Implement staff/profile/photo detail and correction/deletion. Exit: no/multiple/blurred-face rejection, approved/excluded-gallery tests, stale/expired profile suppression, image and template deletion, benchmarked local false matches.

## M4 — Behavior baseline and evidence
Verify actual source availability: the inspected Shopformer root lacks its described training/model sources. Obtain authorized source/checkpoints or build and independently validate a paper reproduction. Obtain licensed data/weights and establish a reproducible protocol. Build person/tracker/pose adapters with explicit COCO17/18 conversion fixtures, gap handling, track TTL and exact preprocessing manifests. Train/export/verify model parity. Build product interaction model from rights-cleared store data. Implement temporal gating and dedup with persisted cooldown and durable outbox. Exit: local held-out evaluation, false-negative and hard-negative audit, temporal reset tests, offline spool/retry/idempotency and no anomaly-only accusations.

## M5 — Alert operations across web/iOS
Implement incident ingress, evidence pending/ready states and APNs outbox worker. Claim/review/outcome CAS commands and audit. Build all mobile authentication/home/alert/evidence/outcome/notifications/offline routes with Keychain and Face ID. iOS reconnect fetches current version before any draft submission. Add escalation routing/ack deadlines and delayed alert handling. Exit: physical-device push sandbox/production routing, expired user/token tests, concurrent claim/outcome races, evidence URL expiry and human outcomes.

## M6 — Search, cases and exports
Index permitted metadata and compatible face/re-ID features. Implement query-photo TTL and scoped candidate results, uncertainty and review. Add coverage gaps and retained availability. Build cases and evidence manifest/redaction/export workers. Exit: scoped query result tests, false association review, corrupt/expired evidence handling, export hashes/authorized recipients/audit and hold/deletion behavior.

## M7 — Connectors, impact and administration
Implement documented POS/RFID/VMS adapters independently; avoid claiming unsupported vendor integrations. Add signed webhooks, replay prevention, lane/time mapping, telemetry outage states and checkout/RFID review. Add dashboard analytics denominators, model registry/evaluation/canary/rollback, logs/settings/health/support. Exit: actual vendor test data or clearly disabled connector, drift/rollback exercises, financial figures backed by reviewed outcomes and no fake records.

## M8 — Release
Complete docs/ACCEPTANCE; run production auth, load, security and restore exercises. Build macOS iOS simulator/device release and TestFlight. Use Cloudflare DNS/TLS/front door and appropriate regional compute. Supply install/update/rollback with real config secrets in vault. Publish internal release for owner review. Deliver exhaustive coverage/test/license manifest and blocker ledger. Exit: every critical acceptance item passes, physical camera/model/APNs tests recorded and customer operating procedure trained.

## Definition of complete
A screen is complete only when its layout, permissions, APIs, form validation, persistence, audited actions, localization, responsiveness, error/empty/denied paths and tests pass. A model is complete only after rights, exact preprocessing, inference parity, local held-out evaluation, monitoring and rollback. A camera is complete only after verified decoded frames and pipeline health. A release is complete only after installation/restore/device tests, not a screenshot gallery.

## Coding decisions
Use a small modular API instead of splitting every menu into a separate service. Keep domain commands independent of HTTP, inject clock/session/media providers, and execute all DB changes transactionally. Generate TypeScript/Swift types from the same contract where practicable. Avoid general-purpose LLMs in the deterministic alarm loop; optional evidence summaries must quote only observed facts and never assign guilt. Use structured logs and request IDs. Test behavior/outcomes, not private method implementation details.
