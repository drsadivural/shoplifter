# Detailed job for Claude Code — Ayonix RetailGuard

You are implementing a commercial retail loss prevention platform from the attached repository. Deliver a connected web console, native SwiftUI iOS responder and store-local video analysis appliance. The owner is Ayonix. Default Japanese and English are equally supported. This is a production engineering task, not a single-page demonstration. Use the existing design artifacts and executable reference logic as acceptance inputs; migrate reference shortcuts before commercial deployment.

## 1. Establish inputs and repository
1. Read every mandatory file listed in CLAUDE.md. Enumerate all web/iOS screen IDs from design/screens.json and create an implementation coverage ledger with route, component, API dependency, tests and completion status.
2. Inventory current files and existing dependencies. Preserve customer changes. Create a Git branch. Confirm Python, Node, Docker and Xcode toolchains; report unavailable tools accurately.
3. Resolve the organization name, base domains, Apple bundle ID, region, OIDC issuer/client IDs, permitted store subnets, deployment host, photo/evidence retention policy and license inventory from configuration. Generate local-only secrets securely. Do not substitute sample domains for real production origins.
4. Create a maintainable monorepo: apps/web (React/TypeScript), apps/ios (SwiftUI), services/api (FastAPI), services/edge (video), services/worker (APNs/exports), packages/contracts, packages/design, infra, tests, docs. The current reference service is local-only; keep it runnable for contract regression and migrate its features deliberately.
5. Select supported dependency releases from official documentation. Pin exact dependencies and container digests in the working implementation. Commit lockfiles and migrations. Produce a software bill of materials and license report.

## 2. Requirements and implementation order
Build the following vertical slices in order, with real persistence and negative-path tests before starting the next:
A. Organization/store setup, enterprise login/MFA, scoped users, light/dark and JA/EN UI.
B. Edge pairing, certificate issuance, ONVIF discovery, credential vault, stream readiness, camera activation, live viewing and health.
C. Enrollment and photo lifecycle for staff and evidence-backed watchlist subjects; approval/suspension/expiry; SDK face template extraction and enrollment rollback.
D. Behavior pipeline with person detection, tracking, pose extraction, exact model preprocessing, evidence gates, alert deduplication, evidence capture and offline outbox.
E. Incident inbox, mobile delivery, ownership, outcome review, escalation, notes and case management.
F. Historical search by metadata/photo, candidate review, visit association and controlled exports.
G. POS/RFID/VMS connectors, store-specific policy, measured impact, model registry, logs, retention, support.
H. Security, robustness, load, native accessibility, deployment, App Store handoff and operational acceptance.

## 3. Web implementation contract
- Implement every web route, not only the dashboard. Every primary action must reach a validated API command with visible success/failure and an audit event. Use the exact design hierarchy and screen-specific fields.
- Implement sidebar/header, store selector, unread count, permission-based navigation, breadcrumbs and responsive tables/cards. The desktop target is 1440 px; add 1024/768/390 px coverage.
- Login uses OIDC Authorization Code + PKCE through a backend session/BFF. HttpOnly Secure SameSite cookies; CSRF protection for mutations. Access denial on client and server. Mandatory MFA for administrators and evidence export roles.
- Build ONVIF wizard Discover → authenticate → select profile → readiness → zones/policy → activate. Bulk add verifies every row and never silently skips failures. User-added camera records stay pending until real frames and model dependencies are healthy.
- Enrollment includes reference ID, lawful purpose/evidence basis, linked reviewed incident when appropriate, permitted stores, approval, expiry, quality checked photos and deletion controls. Display raw SDK similarity as candidate ranking only.
- Alert detail supports pre/post trigger clip, reason signals, camera timeline, observed uncertainty, ack/claim, escalation and outcome. Require reason for false alert, inconclusive and confirmed. Outcomes cannot be authored by the inference model.
- Search supports date/time in store timezone, store/camera/type/outcome/assignee/profile and optional reference photo. Availability clearly reflects retention and camera outage. Photo search returns candidates requiring review. No permanent matching across unrelated tenants.
- Analytics distinguish detections, reviewed incidents, false alerts, inconclusive results and verified financial effects. Never put a marketing “accuracy” percentage on the dashboard without a defined denominator.
- Implement users, role matrix, audit/event logs, settings, integrations, retention, health and model rollout. Empty/error/denied states must be designed and tested; do not seed fake production records to fill screens.

## 4. iOS implementation contract
- Use native SwiftUI, URLSession, Keychain, LocalAuthentication, UserNotifications, PhotosPicker/AVFoundation and AVKit. The included connected client supplies reference flows; extend to all mobile screen IDs. iOS 17 is the package minimum; test on the latest supported release at build time.
- Face ID unlocks a securely retained local session; it does not enroll the user into the retail face watchlist. No API key, SDK admin credential or APNs private key on device. If Face ID is unavailable or denied, keep normal login available.
- Support organization sign-in, MFA continuation, assigned stores, dashboard, alerts, evidence video, claim/outcome/escalation, history, metadata/photo search, staff/subject enrollment, photo capture/quality, visit candidates, cameras, notifications, account, team and diagnostics.
- Register device token to the correct tenant/user/APNs environment. Notification payload contains only an incident ID and generic text. On tap, authenticate, fetch current incident, verify permissions and open detail. Do not assume delivery or use push as durable storage.
- When another responder already owns or updated an incident, show current state and allow refresh; never overwrite it. Use expected_version on all transitions. Offline screens may retain short-lived redacted summaries and drafts; refresh before submitting a draft after reconnection.
- Provide a Notification Service Extension only if approved media previews are needed, using short-lived scoped downloads. Default lock-screen notices do not contain face pictures or accusations. Critical Alerts require an Apple entitlement; do not rely on that entitlement being granted.
- Complete English/Japanese String Catalogs, Dynamic Type, VoiceOver, reduced motion, color-safe status labels, 44pt tap targets and native dark mode. Screenshots are design references, not permission to bake UI as images.

## 5. Edge and algorithms
- Install edge on a store-local Linux GPU appliance with time sync and outbound mTLS. Probe ONVIF using the configured interface and permitted LAN only. Fetch device information/services/media profiles using standards-compliant SOAP auth and support configured manual RTSP fallback.
- Decode H.264/H.265 substreams, preserve timestamps, extract evidence from the main stream, track health, apply privacy masks before persistence. Limit queues and recover from stalled streams/credential failure/time drift/disk pressure. Use distinct camera readiness and analysis states.
- Person detector → tracker → pose extractor → timestamp-consistent pose windows. Export and use the exact preprocessing/tensor/channel/keypoint contract of the trained model. RetailS COCO17 and Shopformer 18-keypoint conventions need an explicit adapter and regression fixtures; no guessed ordering.
- First resolve Shopformer source availability (the inspected official listing lacks its described training/model sources), obtain authorized source or independently reproduce the paper, and then evaluate in store; optionally test STG-NF offline where permitted. Use item-hand/shelf evidence and store context as independent corroboration. Dwell or repeated browsing alone must not trigger a theft alert. Implement uncertainty when the item or relevant body region is occluded.
- Face pipeline is independent and uses Ayonix licensed SDK. Confirm SDK lifecycle, alignment, template compatibility, quality assessment, 1:N threshold/margin, gallery revision, concurrency and license checks from actual vendor documentation. Keep SDK calls behind an adapter, with real integration tests; do not invent method names.
- Separate behavior, watchlist, checkout and RFID events. Merge related evidence without assuming they prove each other. Staff association never suppresses a genuine POS exception. Person re-identification across cameras is a candidate link with temporal/geometric constraints.
- Use evidence-gating kernel semantics in reference/domain.py as initial rules only. Its thresholds are design defaults that must be calibrated; its scores are not a validated neural detector. Durable dedup keys/outbox, bounded ring buffers and idempotent event ingestion must survive restarts.

## 6. APIs, database and jobs
- Derive typed clients from the versioned OpenAPI/JSON contracts. All identifiers are opaque; authorize each object against tenant and store. Validate file content rather than trusting extensions or MIME headers.
- Implement PostgreSQL schema and migrations using contracts/schema.sql as the starting schema. Enable RLS with a restricted application role; SET LOCAL tenant/user/store context only after authentication. RLS is defense in depth, not a replacement for authorization.
- Media is encrypted object storage with randomized keys, authenticated fetch or short-lived signed URLs, deletion and legal hold handling. Templates are protected separately and never returned to general API clients. Use content hash and immutable manifests for evidence exports.
- Command transactions record entity mutation + audit + outbox atomically. Workers retry with jitter and idempotency keys. APNs rejection and stale tokens do not lose the underlying incident. Maintain a dead-letter queue and alert on oldest unsent event.
- API endpoint groups and their required behavior are in docs/API.md. Implement pagination, request size/timeout limits, optimistic concurrency, signed edge events, webhook replay protection and consistent error bodies with request IDs.

## 7. Testing, release and evidence
- Follow docs/ACCEPTANCE.md. Run scoped tenant/store tests, concurrent claim tests, photo validation/deletion tests, edge restart and stream dropout tests, recorded footage replay and held-out ML evaluation, API/UI E2E and native simulator/device checks.
- Store evidence by milestone in validation/ with real versions, commands and outputs. Distinguish pass, fail, skipped and unavailable. No “all tests passed” summary with missing real camera/GPU/APNs/iOS checks.
- Train from normal training windows only, tune on validation, test on disjoint store/time/identity splits. Report frame metrics and event precision/recall, false alerts per camera-hour, duplicate rate, detection latency and inconclusive rate. Reconcile inconsistent upstream AUC-PR figures before using them commercially.
- Ship only after pilot goals in docs/ACCEPTANCE are demonstrated at the agreed store coverage and conditions. Configure thresholds per zone; exclude training contamination; review labels before retraining; canary/rollback models.
- Produce a reproducible release artifact, model/license manifest, install/update/rollback guide, backup restore test, monitoring and on-call guide, administrator guide, staff response guide, App Store submission materials and final open-issues ledger.
- Provide the owner a completion report with all screen coverage, deployed/tested components, validation results, exact remaining external prerequisites and commercial release blockers. Never label unfinished model adapters or untested iOS source “production-ready”.

## Expected final outcome
A deployable, licensed, locally validated retail security product, with complete Japanese/English web and iOS UI, automatic store-local camera discovery and activation after readiness, staff/watchlist enrollment with photos, evidence-based alerts and review, historical metadata/photo search, auditable multi-store operations, secure updates and operational documentation.
