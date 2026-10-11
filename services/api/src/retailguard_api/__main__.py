"""Operational CLI: migrate, bootstrap, serve, worker, openapi."""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import uuid
from importlib import resources

import psycopg


def _owner_url() -> str:
    url = os.environ.get("MIGRATION_DATABASE_URL")
    if not url:
        raise SystemExit("MIGRATION_DATABASE_URL (table owner / migration identity) is required")
    return url


def migrate() -> None:
    app_role = os.environ.get("APP_DB_ROLE", "retailguard_app")
    worker_role = os.environ.get("WORKER_DB_ROLE", "retailguard_worker")
    files = sorted(p for p in resources.files("retailguard_api").joinpath("migrations").iterdir()
                   if p.name.endswith(".sql"))
    with psycopg.connect(_owner_url(), autocommit=False) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        conn.execute("SELECT pg_advisory_xact_lock(424242)")
        done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
        for f in files:
            if f.name in done:
                continue
            print(f"applying {f.name}")
            conn.execute(f.read_text())
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (f.name,))
        # Least-privilege grants: the API role is subject to RLS and cannot alter audit history.
        for stmt in (
            f"GRANT USAGE ON SCHEMA public TO {app_role}, {worker_role}",
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {app_role}, {worker_role}",
            f"REVOKE UPDATE, DELETE ON audit FROM {app_role}, {worker_role}",
            f"REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM {app_role}, {worker_role}",
            f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {app_role}, {worker_role}",
            f"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {app_role}",
        ):
            conn.execute(stmt)
        conn.commit()
    print("migrations complete")


def bootstrap(args) -> None:
    """One-time creation of the organization and its first administrator. Prints a generated
    password once; the administrator must enroll MFA at first sign-in."""
    from zoneinfo import ZoneInfo
    ZoneInfo(args.timezone)
    from .security import hash_password
    password = secrets.token_urlsafe(18)
    # Open the output first so a write failure cannot leave an account whose password was never shown.
    out_fh = os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") if args.output else None
    with psycopg.connect(_owner_url(), autocommit=False) as conn:
        if conn.execute("SELECT 1 FROM app_users WHERE lower(email)=lower(%s)", (args.email,)).fetchone():
            raise SystemExit("An account with this email already exists; bootstrap is one-time.")
        org_id, user_id = uuid.uuid4(), uuid.uuid4()
        conn.execute("INSERT INTO organizations (id, name, timezone, region) VALUES (%s,%s,%s,%s)",
                     (org_id, args.org_name, args.timezone, args.region))
        conn.execute("""INSERT INTO app_users (id, org_id, email, display_name, role, password_hash)
                        VALUES (%s,%s,%s,%s,'org_admin',%s)""",
                     (user_id, org_id, args.email.lower(), args.display_name, hash_password(password)))
        conn.execute("UPDATE organizations SET primary_admin_id=%s WHERE id=%s", (user_id, org_id))
        import hashlib
        record = {"org_id": str(org_id), "actor": None, "actor_kind": "system", "action": "org.bootstrapped",
                  "resource_type": "organization", "resource_id": str(org_id), "store_id": None, "result": "success",
                  "detail": {"admin_email": args.email.lower()}, "request_id": "bootstrap"}
        from datetime import datetime, timezone
        at = datetime.now(timezone.utc)
        record["at"] = at.isoformat().replace("+00:00", "Z")
        digest = hashlib.sha256(json.dumps(record, sort_keys=True, default=str).encode()).hexdigest()
        conn.execute("""INSERT INTO audit (id, org_id, actor_kind, action, resource_type, resource_id, detail, request_id,
                        prev_hash, hash, created_at) VALUES (%s,%s,'system','org.bootstrapped','organization',%s,%s,'bootstrap',NULL,%s,%s)""",
                     (uuid.uuid4(), org_id, str(org_id), json.dumps(record["detail"]), digest, at))
        conn.commit()
    out = {"org_id": str(org_id), "admin_email": args.email.lower(), "one_time_password": password}
    if out_fh:
        with out_fh:
            json.dump(out, out_fh, indent=2)
        print(f"Bootstrap complete. Credentials written to {args.output} (mode 600). Delete after first sign-in.")
    else:
        print(json.dumps(out, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser(prog="retailguard-api")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate")
    b = sub.add_parser("bootstrap")
    b.add_argument("--org-name", required=True)
    b.add_argument("--timezone", default="Asia/Tokyo")
    b.add_argument("--region", default="Japan")
    b.add_argument("--email", required=True)
    b.add_argument("--display-name", required=True)
    b.add_argument("--output")
    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8710)
    sub.add_parser("worker")
    sub.add_parser("openapi")
    args = ap.parse_args()
    if args.cmd == "migrate":
        migrate()
    elif args.cmd == "bootstrap":
        bootstrap(args)
    elif args.cmd == "serve":
        import uvicorn
        from .app import get_app
        uvicorn.run(get_app(), host=args.host, port=args.port, proxy_headers=True, forwarded_allow_ips="127.0.0.1",
                    server_header=False, access_log=False)
    elif args.cmd == "worker":
        from .worker import run
        run()
    elif args.cmd == "openapi":
        from .app import get_app
        json.dump(get_app().openapi(), sys.stdout, indent=2)


if __name__ == "__main__":
    main()
