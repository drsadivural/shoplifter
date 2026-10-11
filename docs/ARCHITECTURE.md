# Architecture

## Requirements
Secure multi-store operation; live camera onboarding; independent behavior/face/POS/RFID channels; evidence-led review; web+iOS; historical photo/metadata search; low-bandwidth edge inference; offline durability; auditability; Japanese/English.

## Components
| Component | Responsibility | Persistence |
|---|---|---|
| Cloudflare front door | Static web, DNS/TLS/WAF; optionally authenticated tunnel to regional API | No camera credentials |
| Regional API/BFF | OIDC, authorization, stores/cameras, enrollment, incidents/search, commands | PostgreSQL |
| Background workers | APNs, escalation, export, retention, dead-letter recovery | Outbox + queues |
| Encrypted media store | Evidence, photos, thumbnails, controlled exports | S3-compatible / R2 subject to residency policy |
| Store edge | ONVIF/RTSP, decoding, pose/face/models, ring buffers, evidence, local outbox | Encrypted local disk + SQLite spool |
| React console | Administrative/review UI, camera playback, logs and reports | Secure session, minimal cache |
| SwiftUI iOS | Push-driven incident review, enrollment/search | Keychain + short-lived redacted cache |

Cloudflare Workers/Pages are not the RTSP decoder or GPU inference host. Store-local discovery requires a local network adapter. API/database/ML stay on suitable regional compute; object storage region must match the customer policy. External live video is an authenticated media relay with short-lived authorization, not public camera URLs.

## Event sequence
Camera activated after readiness → real stream decoding → independent pipeline scores → evidence gate → edge writes event+clip+outbox → API verifies certificate/signature/idempotency/store → transaction writes incident+audit+notification outbox → APNs worker → web/iOS fetch current incident → responder claims version → review/outcome transaction → analytics and optional case/enrollment.

Watchlist events follow face quality/gallery match, not a behavioral anomaly dependency. Their human identity review is separate from incident outcome. All clocks store UTC with capture/ingest timestamps and measured camera offset.

## Isolation and resilience
Organization is the tenant boundary. Store membership restricts every query/object; object store/media access uses the same checks. Edge certificates bind to organization/store and can be revoked. Users cannot send arbitrary organization IDs to change scope. Edge inbound ingestion never accepts a client role claim.

On internet loss, local analysis and encrypted spool continue under disk budget; remote push/live view are unavailable. Reconnect replays idempotently, retaining original capture time; stale incidents are labeled delayed. On SDK/model/license failure, display degraded pipeline status and avoid fabrication. On disk pressure, retain active evidence/holds, expire raw buffer first and raise health alarm. Certificate rotation and software/model rollback have independent lifecycles.

## Scaling and capacity
One decoder per source stream; bounded frame queue prioritizes recent frames for real-time analysis while preserving evidence source. Batch model inference with explicit maximum latency. Track counts and resolution drive load; camera count alone is inadequate. Benchmark agreed profiles for p50/p95 decode, inference, event delay, GPU memory and disk.

Initial production topology: one regional API and PostgreSQL, one worker pool, encrypted evidence storage, one appliance per store. Add horizontal stateless API replicas and worker shards after load evidence. No speculative microservices for every UI menu. Choose a customer-controlled retention region; backup and restore tests precede rollout.
