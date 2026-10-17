# Architecture decision records

Decisions made while implementing the package. Each records context, decision and consequences.

## ADR-001 Monorepo layout
`apps/web` (React/TypeScript), `apps/ios` (SwiftUI + Foundation-only `RetailGuardCore` Swift package),
`services/api` (FastAPI API/BFF + background worker module), `services/edge` (store appliance),
`packages/contracts` (generated OpenAPI + event schema), `packages/design` (tokens, Japanese catalog),
`infra` (compose, Caddy, Cloudflare tunnel, Postgres roles, deploy script). The original package
(`reference/`, `ios/`, `edge/discover.py`, `tests/`) is kept unchanged and runnable for contract regression.
The worker shares the API's domain code (`retailguard_api.worker`) and runs as a separate process/container
with its own DB role, instead of a separate codebase (CLAUDE_CODE_JOB §1.4 lists `services/worker`; we
deliberately avoid duplicating the domain layer — see "small modular API" in docs/IMPLEMENTATION.md).

## ADR-002 PostgreSQL with RLS and three roles
`retailguard_owner` (migrations, BYPASSRLS), `retailguard_app` (API, NOBYPASSRLS, cannot UPDATE/DELETE
audit), `retailguard_worker` (cross-tenant outbox/retention, BYPASSRLS, every query org-scoped explicitly).
Each API request is one transaction that sets `app.org_id` via `set_config(..., true)` after authentication.
Pre-authentication lookups (login, session, edge key, pairing code, invitation, reset, webhook) use narrow
`SECURITY DEFINER` functions returning only what is needed to set tenant context. RLS is defense in
depth; every endpoint still checks role permission and store scope (out-of-scope objects return 404).

## ADR-003 Identity: built-in password + TOTP now, OIDC when configured
No OIDC issuer/client was supplied, so production starts with built-in identity: Argon2id password
hashes, TOTP MFA mandatory for `org_admin`, `store_admin` and `investigator`, single-use hashed recovery
codes, optional 30-day trusted-device cookie, per-email and per-email+IP lockout, admin-issued
invitation and reset links (no SMTP configured, so links are shown once to the administrator for delivery
through an approved channel). OIDC Authorization Code + PKCE (`/v1/auth/oidc/*`) activates when
`OIDC_ISSUER`/`OIDC_CLIENT_ID` are set; accounts must already be invited (no just-in-time provisioning);
RetailGuard MFA is still required for sensitive roles unless the IdP asserts `amr=mfa`.
Browser sessions are BFF cookies (`HttpOnly; Secure; SameSite=Strict`) with a double-submit CSRF token
checked against the server session; iOS uses bearer tokens stored in the Keychain.

## ADR-004 Edge trust: Ed25519 request signing instead of mTLS at the proxy
Pairing exchanges a single-use, 15-minute, store-bound code for registration of the appliance's
Ed25519 signing key and X25519 box key. Every edge request is signed over method, path, timestamp,
nonce and body hash, with a ±300 s window and single-use nonces; revocation is immediate. This gives the
properties the package asks of mTLS (key-bound identity, revocation, replay protection) without
requiring client-certificate termination on the shared Cloudflare/Caddy front door. Camera credentials
entered in the console are sealed (libsodium SealedBox) to the store appliance's X25519 key on receipt,
so the cloud stores only ciphertext it cannot decrypt.

## ADR-005 Media encryption
Each object is encrypted with a random AES-256-GCM data key, wrapped by `MEDIA_MASTER_KEY` (AAD binds
the media ID). Storage keys are random. Integrity is verified against the stored SHA-256 on every read.
The wrap/unwrap functions are the seam for a KMS (`KMS_KEY_ID` in docs/CONFIG_AND_INPUTS.md) — no KMS
was provided, so the master key lives in the root-only secrets file.

## ADR-006 Honest unavailability
The Ayonix face SDK, behavior/pose models, re-identification, automated redaction, APNs credentials,
SMTP and OIDC were not supplied. The corresponding features are implemented up to the integration seam
and report `unconfigured`/`unavailable` with a reason (`face_sdk_unavailable`, `model_not_installed`,
`reid_unavailable`, `redaction_unavailable`, `push_unconfigured`). Cameras never show `analyzing` unless the
appliance reports a running channel; readiness requires ≥10 s of decoded frames reported by the edge.
Photo quality shows measured image statistics (brightness, edge variance) and labels face checks as
unavailable rather than estimating them.

## ADR-007 Hosting topology
Single host: Cloudflare (DNS/TLS/WAF) → dedicated `retailguard` Cloudflare Tunnel → Caddy listener bound
to 127.0.0.1:8730 (static web + `/v1` proxy) → API on 127.0.0.1:8720 (container, host network, read-only
root FS, no capabilities) + worker + PostgreSQL 17 (127.0.0.1:8716). This follows docs/DEPLOYMENT.md
("Cloudflare front door ... Cloudflare Tunnel may expose the API origin"). Secrets live in
`/etc/retailguard/retailguard.env` (root, 0600), never in git.

## ADR-008 Incident numbering and versions
Human-readable references (`INC-2026-000042`, `CASE-2026-000003`) come from per-organization sequences;
all APIs use opaque UUIDs. Every state transition is a compare-and-swap on `version` inside one
transaction with the audit row and outbox message.

## ADR-009 Organization-controlled two-step verification
Two-step verification (TOTP) is required for org_admin, store_admin and investigator by default
(`general.require_mfa_for_privileged_roles = true`). An organization admin may switch the requirement off;
then every person chooses in Settings. The check fails closed: any stored value other than an explicit
`false` keeps it required. Turning one's own authenticator off needs the password and a current or
recovery code and is audited (`auth.mfa_disabled`). Evidence export still requires an MFA-verified
session regardless of the setting. Turning the requirement back on sends unenrolled privileged users to
enrollment on their next request.

## ADR-010 Camera sources: ONVIF, RTSP URL, USB
Cameras record `source_type`. `onvif` (existing rows) negotiates the stream through the ONVIF Media
service. `rtsp` takes an operator-entered URL when WS-Discovery cannot see the camera (other VLAN, no
ONVIF): the host must still be a private IP inside the allowed subnets, credentials in the URL are split
off and sealed to the edge, and uniqueness is per address+port+path so NVR channels are separate cameras.
`usb` is a V4L2 device on the edge appliance, found by the same discovery job (`include_usb`); the edge
accepts only `/dev/v4l/by-(id|path)/…` or `/dev/videoN`, reads it with `-f v4l2`, and the systemd unit
allows only `char-video4linux` devices. All sources use the same readiness rule (>= 10 s of decoded
frames); USB adds MJPEG/raw YUV to the accepted codecs. Discovery no longer asks for the appliance's
network interface (user request): without one the edge probes from every private IPv4 interface.
The design contract for web-11 listed "Network interface" and "Scan timeout"; both were removed at the
user's request (timeout fixed at 5 s).

## ADR-011 Edge on Windows
Customers may run the edge agent on a Windows PC. The same Python package runs there: default paths move
to `%ProgramData%\RetailGuard\Edge`, protected by an ACL (SYSTEM + Administrators) instead of POSIX modes;
interfaces come from the host's resolved IPv4 addresses instead of `SIOCGIFADDR`; USB cameras are
DirectShow devices (`dshow:` + the device's alternative name, which stays unique for identical cameras;
quotes, `:` and control characters are refused so a value cannot select a second device). The agent runs
as a SYSTEM scheduled task (no third-party service wrapper). Linux remains the reference appliance
(systemd hardening has no exact Windows equivalent).

## ADR-012 Windows setup wizard
Customers get `RetailGuardEdgeSetup-<version>.exe` (Inno Setup, MIT-licensed tooling, no runtime
dependency). It installs the same files as the zip and runs the same `install-windows.ps1` one phase
at a time so the wizard can show progress; pairing happens on a page after installation because it
needs the installed agent, and a rejected code keeps the user on that page. The same AppId makes a
re-run an in-place update that keeps `%ProgramData%\RetailGuard\Edge`. The executable is unsigned until
a code-signing certificate is provided.

## ADR-013 Live view relay
Live video goes from the edge to browsers as HLS through the API, on demand. The camera's stream
monitor (the one ffmpeg reader per camera, which USB cameras require) also writes a rolling local
playlist of 1 s MPEG-TS segments: H.264 RTSP cameras are remuxed without re-encoding; USB, H.265 and
privacy-masked cameras are encoded to H.264 (≤ 960 px, 15 fps) with privacy masks burned in, so live
video never shows what snapshots hide. The appliance uploads the newest segments (signed requests) only
for cameras the API lists as watched in its command-poll response (a viewer request in the last 30 s);
the API keeps 8 segments per camera, serves them to signed-in users of that store, audits viewing, and
the worker deletes them 2 min after the last one. This works through the existing Cloudflare Tunnel
(HTTPS only); it is a few seconds behind real time. WebRTC would be faster but needs UDP/TURN
reachability that the tunnel does not provide.

## ADR-014 Edge processing modes
Each appliance is either `streaming` (live view only; analysis refused with `edge_streaming_only`) or
`full` (it also runs installed analysis channels and reports events, which become alerts through the
existing event pipeline). The device requests a mode at pairing (setup wizard / `--mode`); afterwards
the console is authoritative (`PATCH /v1/edges/{id}`, `set_processing_mode` command, and the heartbeat
response, which the appliance adopts). Full processing does not ship a detection model: per the
algorithm and model-lifecycle rules, a licensed, validated model must be installed through a manifest.
Until then the channels report `model_not_installed`, the console says that no alerts are generated,
and nothing is fabricated.
