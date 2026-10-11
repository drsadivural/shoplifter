# Verification and release gates

These are proposed engineering/pilot targets, not measured claims. Customer must agree acceptable false-alert burden and missed-event risk for actual stores. Real-camera/GPU/SDK/APNs/iOS checks cannot be replaced with local reference unit tests.

## Core workflow tests
- Bootstrap has no hardcoded public password; expired/revoked sessions denied. Anonymous API cannot enumerate photos/incidents. Cross-store and cross-tenant object IDs denied.
- ONVIF device discovered on permitted LAN, authenticated and profile selected. No analyzing status until real frames and enabled model/SDK healthy. Invalid credential/VLAN isolation/codec failure produce actionable errors.
- Added camera starts valid channels automatically after readiness. Restart resumes committed configuration; incompatible model/expired license gives degraded status, never fake success.
- Staff/watchlist photos persist; invalid/multiple-face quality rejected in production; enrollment cannot be approved from an unreviewed anomaly alone. Expired/suspended/deleted profiles excluded from matching/search according to policy.
- New evidence-led candidate creates one incident per dedup policy. Retry/restart does not duplicate it. Evidence pending versus unavailable distinguished.
- Mobile push opens authorized current incident after sign-in. Quiet/disabled notifications do not remove inbox record. APNs expiry retries are bounded; revoked token stops routing.
- Two responders racing to claim/outcome yield one winning transaction and a 409 on stale version. Every outcome has actor, timestamp and reason. AI process cannot resolve confirmed outcomes.
- Metadata/photo search restricted by store/date/retention; empty search shows coverage gap. Low-quality query yields validation failure, not random matches. Photos remain candidates.
- Case linking and export preserve hashes, scope, purpose and audit. Deletion/expiry removes media/templates/indexes except explicit policy-authorized hold.
- Web/iOS all catalog IDs covered; loading/empty/error/denied screens tested; JA/EN complete; dark/light and accessible text/tap/contrast pass.

## ML verification
Frozen splits by store, camera, time and track/person before segmentation. Real and staged positives reported separately. Include hard negatives and low visibility. Measure event precision, recall with confidence intervals, false alerts per camera-hour, duplicate rate, inconclusive rate and p50/p95 latency. Report frame AUC-ROC and AUC-PR only with exact labels/prevalence/orientation. Do not turn unreviewed alerts into false-positive ground truth.

Initial candidate pilot goals: event precision ≥0.85 on reviewed visible supported events; false alerts ≤0.02 per analyzed camera-hour; p95 candidate-to-server delay ≤5s after completed temporal evidence window; duplicate incidents <1%; outcome synchronization p95 ≤2s after server receipt. Recall is reported from adjudicated complete recordings, with proposed ≥0.80 for agreed visible supported actions, not all theft. These may be unattainable with the baseline and must be adjusted or block release after evidence. At 0.02 per camera-hour, 8 cameras × 12h/day implies about 1.92 false alerts/day; communicate that operational burden explicitly.

Use Wilson/binomial confidence intervals for event metrics and Poisson intervals for false-alert rate. A tiny positive set does not justify commercial guarantees. Calibration set thresholds fixed before holdout testing. Evaluate false-match rate and identity-candidate quality separately from behavior. Staff, disability/assistive devices, occlusion, bags and restocking appear in hard negatives without using protected traits as suspicion features.

## Reliability/performance
24h staged soak and a longer live pilot appropriate to observed volumes; network outage 1h with replay, edge reboot, camera reboot, corrupt frame, disk nearly full, certificate revocation, expired SDK/license, GPU OOM and clock drift. Measure target camera profiles and people per frame; do not claim camera capacity from unit tests. Backup restore verifies data, photos, evidence/outbox/audit. Apply consistent bounded queues/retention.

## Release checklist
Every critical workflow/security test passed; all screen coverage complete; commercial rights for code/data/weights/SDK; held-out pilot goals agreed and demonstrated; model/preprocessing checksums; Mac build/device/APNs evidence; production secrets/TLS/OIDC/roles verified; runbooks/training; restore/rollback tested; owner reviews concrete release. Mark any unavailable test explicitly and keep release blocked when it is critical.
