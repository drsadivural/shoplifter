"""Request dependencies: authenticated actor + tenant-scoped transaction."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Iterator

from fastapi import Request

from .authz import Actor, mfa_required, now
from .db import Tx, transaction
from .errors import ApiError
from .security import constant_eq, token_hash

SESSION_COOKIE = "rg_session"
CSRF_COOKIE = "rg_csrf"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class Ctx:
    tx: Tx
    actor: Actor
    request: Request


def _token(request: Request) -> tuple[str | None, bool]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None, False
    return request.cookies.get(SESSION_COOKIE), True


def session_timeout_minutes(tx: Tx, org_id: str) -> int:
    row = tx.one("SELECT settings FROM org_settings WHERE org_id=%s AND kind='general'", (org_id,))
    value = (row or {}).get("settings", {}).get("session_timeout_minutes") if row else None
    return int(value) if isinstance(value, int) and 5 <= value <= 1440 else 60


def load_actor(tx: Tx, request: Request, *, allow_partial: bool = False) -> Actor:
    token, via_cookie = _token(request)
    if not token:
        raise ApiError(401, "authentication_required", "Sign in to continue")
    found = tx.one("SELECT * FROM rg_session_lookup(%s)", (token_hash(token),))
    if not found:
        raise ApiError(401, "session_expired", "Your session has expired. Sign in again.")
    tx.set_context(found["org_id"], found["user_id"])
    s = tx.one("SELECT * FROM sessions WHERE id=%s", (found["id"],))
    u = tx.one("SELECT * FROM app_users WHERE id=%s", (found["user_id"],))
    if not s or not u or not u["active"]:
        raise ApiError(401, "session_expired", "Your session has expired. Sign in again.")
    timeout = session_timeout_minutes(tx, found["org_id"])
    if s["client"] == "web" and s["last_seen_at"] + timedelta(minutes=timeout) < now():
        tx.run("UPDATE sessions SET revoked_at=now() WHERE id=%s", (s["id"],))
        raise ApiError(401, "session_expired", "Your session timed out. Sign in again.")
    if via_cookie and request.method not in SAFE_METHODS:
        header = request.headers.get("x-csrf-token", "")
        if not header or not constant_eq(header, s["csrf_token"]):
            raise ApiError(403, "csrf_failed", "Security token missing or invalid. Reload the page.")
    if not allow_partial and s["state"] != "authenticated":
        raise ApiError(401, s["state"], "Additional verification is required")
    if s["state"] == "authenticated" and not s["mfa_verified"] and mfa_required(tx, u["org_id"], u["role"]):
        # Role changed to an MFA-required role (or the organization turned the requirement on)
        # after sign-in: force re-verification.
        tx.run("UPDATE sessions SET state=%s WHERE id=%s",
               ("mfa_required" if u["mfa_enabled"] else "mfa_enrollment_required", s["id"]))
        if not allow_partial:
            raise ApiError(401, "mfa_required" if u["mfa_enabled"] else "mfa_enrollment_required",
                           "Additional verification is required")
    if now() - s["last_seen_at"] > timedelta(seconds=60):
        tx.run("UPDATE sessions SET last_seen_at=now() WHERE id=%s", (s["id"],))
    if u["role"] == "org_admin":
        stores = [str(r["id"]) for r in tx.all("SELECT id FROM stores ORDER BY name")]
        all_stores = True
    else:
        stores = [str(r["store_id"]) for r in tx.all(
            "SELECT m.store_id FROM memberships m JOIN stores s ON s.id=m.store_id WHERE m.user_id=%s ORDER BY s.name",
            (u["id"],))]
        all_stores = False
    return Actor(user_id=str(u["id"]), org_id=str(u["org_id"]), role=u["role"], email=u["email"],
                 display_name=u["display_name"], store_ids=stores, session_id=str(s["id"]),
                 client=s["client"], mfa_verified=s["mfa_verified"], all_stores=all_stores,
                 extra={"session_state": s["state"], "via_cookie": via_cookie})


def ctx(request: Request) -> Iterator[Ctx]:
    with transaction() as tx:
        yield Ctx(tx, load_actor(tx, request), request)


def partial_ctx(request: Request) -> Iterator[Ctx]:
    with transaction() as tx:
        yield Ctx(tx, load_actor(tx, request, allow_partial=True), request)


def public_tx() -> Iterator[Tx]:
    with transaction() as tx:
        yield tx
