# RetailGuard API (`services/api`)

FastAPI service implementing `docs/API_V1.md`: identity (password + TOTP MFA, optional OIDC
Authorization Code + PKCE), BFF cookie sessions with CSRF, iOS bearer sessions, organization/store/user
administration, edge pairing and Ed25519-signed edge ingestion, cameras/ONVIF discovery jobs, staff and
watchlist enrollment with encrypted photos, incidents with optimistic concurrency, cases, evidence
exports, search with coverage gaps, POS webhooks, model registry, audit hash chain, health and the
background worker (`retailguard_api.worker`: outbox → in-app notifications/APNs, ack-deadline escalation,
exports, retention).

PostgreSQL with row level security: the API connects as `retailguard_app` (NOBYPASSRLS) and sets
`app.org_id` per transaction; migrations run as `retailguard_owner`; the worker uses `retailguard_worker`.
Roles are created by `infra/postgres/10-roles.sh`.

```bash
uv sync
uv run python -m retailguard_api migrate          # MIGRATION_DATABASE_URL
uv run python -m retailguard_api bootstrap --org-name "Ayonix" --email admin@example.com --display-name "Admin" --output /secure/path.json
uv run python -m retailguard_api serve            # 127.0.0.1:8710
uv run python -m retailguard_api worker
uv run python -m retailguard_api openapi > ../../packages/contracts/openapi.json
```

Tests are integration tests against a real PostgreSQL (fresh database per run):

```bash
TEST_ADMIN_DATABASE_URL=postgresql://postgres:...@127.0.0.1:8715/postgres \
RG_OWNER_PASSWORD=... RG_APP_PASSWORD=... RG_WORKER_PASSWORD=... uv run pytest -q
```

Environment variables: see `src/retailguard_api/settings.py` and `docs/CONFIG_AND_INPUTS.md`.
Integrations that are not configured (OIDC, APNs, Ayonix face SDK, SMTP) report `unconfigured`;
nothing is simulated.
