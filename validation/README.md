# Validation report — implementation milestone

Date: 2026-10-11 (JST). Branch `retailguard-platform`. Environment: Linux x86_64 cloud VM (4 vCPU, no GPU,
no physical cameras, no store LAN), plus GitHub Actions (ubuntu-24.04, macos-15). Results below are from real
runs; nothing here measures theft-detection or face-matching performance (no licensed models/SDK exist yet).

## Automated tests

| Suite | Command | Result |
|---|---|---|
| API integration (real PostgreSQL 17, production roles + RLS, fresh DB per run) | `cd services/api && uv run pytest` | **40 passed** |
| Edge appliance (incl. 6 real RTSP tests against mediamtx in Docker, ffmpeg-generated H.264) | `cd services/edge && uv run pytest` | **140 passed** (+ Windows CI job: package + setup wizard install, suite) |
| Web console unit + smoke (51 screens × API 500/403/503) | `cd apps/web && npm test -- --run` | **223 passed** (14 files) |
| Web typecheck + production build | `npm run typecheck && npm run build` | pass |
| iOS core package (Linux, Swift 6.1.3) | `cd apps/ios/RetailGuardCore && swift test` | **65 passed** |
| iOS app target compile (macOS 15 runner, Xcode, iOS Simulator SDK, no signing) | CI job `ios-app` | **BUILD SUCCEEDED** |
| Original package reference tests | `python3 -m unittest discover -s tests` | **25 passed** |
| CI (all of the above on GitHub Actions) | `.github/workflows/ci.yml` | all 6 jobs green |

API tests cover: MFA enrollment/verification and recovery-code single use; generic invalid-credential errors;
lockout after 5 failures; CSRF enforcement; session revocation on logout and role change; self-lockout and
last-admin protection; password reset tokens; RLS hides all rows without tenant context; the API role
cannot delete audit rows; concurrent claim race (exactly one 200, one 409 with current version); outcome
requires owner + reason; reopen permission; store scope and cross-tenant 404s; stable cursor pagination;
case/export with MFA requirement, idempotency key and verified SHA-256 manifest; search coverage gaps;
photo search returns `face_sdk_unavailable` and audits; ack-deadline escalation + notifications; audit hash
chain verification; edge signature/replay/clock-skew/revocation; camera SSRF rejection (metadata IP,
loopback, public, out-of-subnet, hostnames); credentials sealed to the edge key; readiness requires ≥10 s
decoded; activation never reports `analyzing` without a running channel; event idempotency, store-binding
and schema validation; evidence checksum; discovery round trip; CSV import never skips silently; zone
geometry validation and versioning; webhook HMAC + replay; watchlist approval requires a human-confirmed
source incident, an approved photo and a different approver; EXIF/GPS stripped; encrypted media at rest;
staff photos restricted; legal hold and data-subject requests.

## End-to-end runs
- **Edge ↔ API ↔ RTSP** (`validation/E2E_EDGE_API.md`): pairing, signed heartbeats, real 13.3 s decode →
  `ready`, privacy-masked snapshots, activation → honest `model_not_installed` / `face_sdk_unavailable`, real
  WS-Discovery probe.
- **Browser (Playwright, Chromium)** against the dev API: sign-in + TOTP through the UI; all 51 signed-in
  routes render their localized heading with no error state, no failing `/v1` calls and no console errors;
  acknowledge → outcome flow (missing reason blocked; confirmed outcome with reason and ¥3,200 persisted,
  version 1→3); reference-photo upload with provenance (measured image statistics; face checks labelled
  unavailable); Japanese + dark theme rendering; 390 px layout without horizontal overflow; live camera
  snapshot from the edge shown on camera readiness and zone editor.
- **Production** (https://shoplifter.ayonix.com via Cloudflare Tunnel): login page served; Japanese browser
  locale → Japanese UI; invalid sign-in shows the generic error; unauthenticated `/v1/me` → 401; `/v1/docs`
  → 404; CSP/HSTS/X-Frame-Options present; migrations `0001`, `0002` applied; `/readyz` healthy.

## Not verified (release blockers where critical)
- Physical ONVIF cameras and vendor firmware (SOAP auth, Media2, H.265, RTSP/UDP), store LAN multicast, VLANs.
- Any behavior/pose/person model, the licensed Ayonix face SDK, re-identification, automated redaction —
  none are installed; the product reports these as unavailable. Pilot ML acceptance goals in
  `docs/ACCEPTANCE.md` are unmeasured.
- APNs delivery (no Apple keys), iOS on simulator/device, Face ID, Keychain, camera capture, TestFlight.
- Enterprise OIDC (no IdP configured), SMTP delivery (invites/resets are admin-issued links).
- POS/RFID/VMS vendor connectors (only the generic signed webhook exists).
- Load/soak tests, backup-restore exercise, penetration test, native-speaker review of Japanese copy.
