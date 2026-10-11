# Ayonix RetailGuard

Retail loss-prevention platform: a Japanese/English web console, a native SwiftUI iOS responder app, a
regional API with background worker, and a store-local edge appliance for ONVIF/RTSP cameras.
AI signals are candidates for human review — every outcome (confirmed / false alert / inconclusive) is
recorded by a person with a reason.

**Live:** https://shoplifter.ayonix.com (Cloudflare → `retailguard` tunnel → this host).

## Status at a glance

| Component | Path | State |
|---|---|---|
| Web console (54 screens, JA/EN, light/dark, responsive) | `apps/web` | Implemented, deployed, browser-verified against the API |
| API / BFF + worker (FastAPI, PostgreSQL RLS) | `services/api` | Implemented, deployed, 28 integration tests |
| Edge appliance (pairing, ONVIF, RTSP readiness, evidence gate, outbox) | `services/edge` | Implemented, 125 tests, E2E with real RTSP |
| iOS app (34 screens, String Catalog JA/EN) | `apps/ios` | Implemented, compiles in macOS CI; not yet run on device |
| Behavior models, Ayonix face SDK, re-ID, redaction | — | **Not supplied** — reported as unavailable everywhere, never simulated |

Details: [`docs/COVERAGE.md`](docs/COVERAGE.md) (all 88 screens), [`validation/README.md`](validation/README.md)
(real test results and the not-verified list), [`docs/DECISIONS.md`](docs/DECISIONS.md) (architecture decisions),
[`docs/API_V1.md`](docs/API_V1.md) (implemented API contract), [`docs/SBOM.md`](docs/SBOM.md) (dependencies and licenses).

## Repository layout

```text
apps/web            React 19 + TypeScript console (Vite). FOUNDATION.md explains the patterns.
apps/ios            SwiftUI app (XcodeGen) + RetailGuardCore Swift package (Foundation-only, tested on Linux)
services/api        FastAPI API/BFF, migrations, worker (outbox → notifications/APNs, escalation, exports, retention)
services/edge       Store appliance (`retailguard-edge pair|run|discover|probe|status`), systemd unit
packages/contracts  Generated OpenAPI + edge event JSON schema
packages/design     Design tokens and Japanese catalog
infra               docker-compose (prod), Postgres roles, Caddy origin, Cloudflare tunnel, deploy.sh
docs                Product/engineering/ML/security docs from the package + implementation records
design, mockups     Screen catalog and EN/JA × light/dark mockups (acceptance references)
reference, ios, edge/discover.py, tests   Original package reference implementation (kept runnable)
validation          Test and E2E evidence
```

## Develop

```bash
# Database with production roles (one-time)
docker run -d --name rg-dev-pg -p 127.0.0.1:8715:5432 -e POSTGRES_PASSWORD=... \
  -e RG_OWNER_PASSWORD=... -e RG_APP_PASSWORD=... -e RG_WORKER_PASSWORD=... \
  -v $PWD/infra/postgres/10-roles.sh:/docker-entrypoint-initdb.d/10-roles.sh:ro postgres:17-alpine

cd services/api && uv sync && uv run python -m retailguard_api migrate && uv run python -m retailguard_api serve
cd apps/web && npm ci && npm run dev            # proxies /v1 to 127.0.0.1:8710
cd services/edge && uv sync && uv run pytest
cd apps/ios/RetailGuardCore && swift test       # app target: xcodegen generate + Xcode on a Mac
```

Environment variables are documented in `services/api/README.md` and `infra/retailguard.env.example`.

## Deploy (this host)

`infra/deploy.sh` builds the committed `HEAD` (never uncommitted work), runs migrations, restarts the API and
worker containers, publishes the web build to `/srv/retailguard/web` and reloads Caddy. Secrets live only in
`/etc/retailguard/retailguard.env` (root, 0600). The initial administrator was created with the one-time
bootstrap; its one-time password is in `/etc/retailguard/initial-admin.json` (root only). Sign-in requires
setting up an authenticator app (TOTP) on first use. Delete that file after the first sign-in.

## External inputs still required for a commercial release
Licensed Ayonix face SDK + license, rights-cleared trained behavior models with held-out validation, an
enterprise OIDC tenant, APNs key + Apple team/bundle ID, SMTP (or keep admin-issued links), POS/RFID vendor
access, real store cameras and an edge GPU appliance, and the pilot acceptance targets in `docs/ACCEPTANCE.md`.
The original package brief is in `docs/PACKAGE_README.md`, `START_HERE.md` and `CLAUDE_CODE_JOB.md`.
