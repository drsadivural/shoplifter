"""Integration test fixtures. Tests run against a real PostgreSQL with the production roles and
row level security. A fresh database is created per test session.

Required env: TEST_ADMIN_DATABASE_URL (superuser on a server whose roles were created by
infra/postgres/10-roles.sh), RG_OWNER_PASSWORD, RG_APP_PASSWORD, RG_WORKER_PASSWORD.
"""
from __future__ import annotations

import base64
import os
import secrets
import tempfile
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pyotp
import pytest

ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL")


def _url(user: str, password: str, db: str) -> str:
    p = urlsplit(ADMIN_URL)
    return urlunsplit((p.scheme, f"{user}:{password}@{p.hostname}:{p.port}", f"/{db}", "", ""))


@pytest.fixture(scope="session", autouse=True)
def database():
    if not ADMIN_URL:
        pytest.skip("TEST_ADMIN_DATABASE_URL not set")
    name = f"rg_test_{secrets.token_hex(4)}"
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f"CREATE DATABASE {name} OWNER retailguard_owner")
    with psycopg.connect(_url("postgres", urlsplit(ADMIN_URL).password, name), autocommit=True) as conn:
        conn.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
        conn.execute("ALTER SCHEMA public OWNER TO retailguard_owner")
    media = tempfile.mkdtemp(prefix="rg-media-")
    os.environ.update({
        "MIGRATION_DATABASE_URL": _url("retailguard_owner", os.environ["RG_OWNER_PASSWORD"], name),
        "DATABASE_URL": _url("retailguard_app", os.environ["RG_APP_PASSWORD"], name),
        "WORKER_DATABASE_URL": _url("retailguard_worker", os.environ["RG_WORKER_PASSWORD"], name),
        "MEDIA_DIR": media,
        "MEDIA_MASTER_KEY": base64.b64encode(os.urandom(32)).decode(),
        "SECRETS_KEY": base64.b64encode(os.urandom(32)).decode(),
        "EDGE_ALLOWED_SUBNETS": "10.20.0.0/16,192.168.10.0/24",
        "APP_ENV": "test", "WEB_ORIGIN": "https://retailguard.test", "COOKIE_SECURE": "false",
    })
    from retailguard_api.__main__ import migrate
    migrate()
    yield name
    from retailguard_api.db import close_pool
    close_pool()
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


@pytest.fixture(scope="session")
def app(database):
    from retailguard_api.app import create_app
    return create_app()


class Client:
    """TestClient wrapper that adds the CSRF header like the web app does."""

    def __init__(self, app):
        from fastapi.testclient import TestClient
        self.c = TestClient(app, base_url="https://retailguard.test", raise_server_exceptions=False)

    def _h(self, headers):
        h = dict(headers or {})
        csrf = self.c.cookies.get("rg_csrf")
        if csrf:
            h.setdefault("X-CSRF-Token", csrf)
        return h

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, json=None, headers=None, **kw):
        return self.c.post(url, json=json, headers=self._h(headers), **kw)

    def put(self, url, json=None, headers=None, **kw):
        return self.c.put(url, json=json, headers=self._h(headers), **kw)

    def patch(self, url, json=None, headers=None, **kw):
        return self.c.patch(url, json=json, headers=self._h(headers), **kw)

    def delete(self, url, headers=None, **kw):
        return self.c.delete(url, headers=self._h(headers), **kw)


def bootstrap_org(name: str | None = None) -> dict:
    """Create an organization + admin exactly as the CLI does, returning credentials."""
    import argparse
    import io
    import json
    import contextlib
    from retailguard_api.__main__ import bootstrap
    email = f"admin-{uuid.uuid4().hex[:8]}@example.test"
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        bootstrap(argparse.Namespace(org_name=name or f"Org {uuid.uuid4().hex[:6]}", timezone="Asia/Tokyo",
                                     region="Japan", email=email, display_name="Admin", output=None))
    out = json.loads(buf.getvalue())
    return {"email": email, "password": out["one_time_password"], "org_id": out["org_id"]}


def login_admin(app, creds: dict) -> tuple[Client, str]:
    """Sign in an org admin and complete mandatory MFA enrollment. Returns client and TOTP secret."""
    cl = Client(app)
    r = cl.post("/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "mfa_enrollment_required"
    secret = creds.get("totp")
    if secret is None:
        setup = cl.get("/v1/auth/mfa/setup").json()
        secret = setup["secret"]
        r = cl.post("/v1/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()})
        assert r.status_code == 200, r.text
        creds["totp"] = secret
    return cl, secret


def invite_and_login(app, admin: Client, role: str, store_ids: list[str]) -> tuple[Client, dict]:
    email = f"{role}-{uuid.uuid4().hex[:8]}@example.test"
    r = admin.post("/v1/users/invitations", json={"email": email, "role": role, "store_ids": store_ids})
    assert r.status_code == 201, r.text
    token = r.json()["accept_url"].split("token=")[1]
    pw = secrets.token_urlsafe(16)
    anon = Client(admin.c.app)
    assert anon.post("/v1/auth/invitations/accept", json={"token": token, "display_name": role.title(), "password": pw}).status_code == 200
    cl = Client(admin.c.app)
    r = cl.post("/v1/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    creds = {"email": email, "password": pw}
    if r.json()["state"] == "mfa_enrollment_required":
        secret = cl.get("/v1/auth/mfa/setup").json()["secret"]
        assert cl.post("/v1/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()}).status_code == 200
        creds["totp"] = secret
    me = cl.get("/v1/me").json()
    creds["id"] = me["user"]["id"]
    return cl, creds


@pytest.fixture()
def org(app):
    creds = bootstrap_org()
    admin, _ = login_admin(app, creds)
    store = admin.post("/v1/stores", json={"name": "Tokyo flagship", "region": "Kanto", "address": "Tokyo",
                                           "timezone": "Asia/Tokyo"}).json()
    store_b = admin.post("/v1/stores", json={"name": "Osaka branch", "region": "Kansai", "address": "Osaka",
                                             "timezone": "Asia/Tokyo"}).json()
    return {"creds": creds, "admin": admin, "store": store, "store_b": store_b, "app": app}
