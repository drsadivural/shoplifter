"""Identity: password + TOTP MFA (built-in), optional enterprise OIDC (Authorization Code + PKCE),
BFF cookie sessions for the browser and bearer sessions for iOS."""
from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from ..authz import MFA_REQUIRED_ROLES, PERMISSIONS, audit, clean, iso, now
from ..db import J, Tx, transaction
from ..deps import CSRF_COOKIE, SESSION_COOKIE, Ctx, ctx, partial_ctx, public_tx
from ..errors import ApiError, invalid
from ..security import (decrypt_secret, encrypt_secret, hash_password, new_recovery_codes, new_token,
                        new_totp_secret, password_problem, token_hash, totp_uri, verify_password, verify_totp)
from ..settings import get_settings

router = APIRouter(prefix="/v1", tags=["identity"])

TRUST_COOKIE = "rg_trust"
MAX_FAILURES = 5
LOCK_MINUTES = 15


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)
    client: str = "web"


class MfaVerifyIn(BaseModel):
    code: str | None = Field(default=None, max_length=12)
    recovery_code: str | None = Field(default=None, max_length=40)
    trust_device: bool = False


class MfaEnableIn(BaseModel):
    code: str = Field(max_length=12)


class ResetRequestIn(BaseModel):
    email: str = Field(max_length=254)


class ResetCompleteIn(BaseModel):
    token: str = Field(max_length=200)
    new_password: str = Field(max_length=1024)


class InviteAcceptIn(BaseModel):
    token: str = Field(max_length=200)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(max_length=1024)


class PrefsIn(BaseModel):
    locale: str | None = None
    theme: str | None = None
    notification_prefs: dict[str, Any] | None = None


def client_ip(request: Request) -> str:
    # Caddy is the only ingress; it sets X-Forwarded-For. The API binds to loopback.
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "unknown")


def _throttle_check(tx: Tx, key: str) -> None:
    row = tx.one("SELECT * FROM login_throttle WHERE key=%s", (key,))
    if row and row["locked_until"] and row["locked_until"] > now():
        raise ApiError(429, "rate_limited", "Too many attempts. Try again later.", retriable=True)


def _throttle_fail(key: str) -> None:
    # Separate transaction so the failure counter survives the request's rollback.
    with transaction() as tx:
        tx.run("""INSERT INTO login_throttle (key, failures, window_start) VALUES (%s, 1, now())
                  ON CONFLICT (key) DO UPDATE SET
                    failures = CASE WHEN login_throttle.window_start < now() - interval '15 minutes' THEN 1
                                    ELSE login_throttle.failures + 1 END,
                    window_start = CASE WHEN login_throttle.window_start < now() - interval '15 minutes' THEN now()
                                        ELSE login_throttle.window_start END""", (key,))
        tx.run("""UPDATE login_throttle SET locked_until = now() + make_interval(mins => %s)
                  WHERE key=%s AND failures >= %s""", (LOCK_MINUTES, key, MAX_FAILURES))


def _set_session_cookies(response: Response, token: str, csrf: str, expires_at) -> None:
    s = get_settings()
    max_age = int((expires_at - now()).total_seconds())
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.cookie_secure,
                        samesite="strict", path="/")
    response.set_cookie(CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=s.cookie_secure,
                        samesite="strict", path="/")


def _clear_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def create_session(tx: Tx, user: dict, client: str, request: Request, *, mfa_verified: bool) -> tuple[str, dict]:
    s = get_settings()
    if user["role"] in MFA_REQUIRED_ROLES and not mfa_verified:
        state = "mfa_required" if user["mfa_enabled"] else "mfa_enrollment_required"
    elif user["mfa_enabled"] and not mfa_verified:
        state = "mfa_required"
    else:
        state = "authenticated"
    token = new_token()
    lifetime = timedelta(days=s.mobile_session_days) if client == "ios" else timedelta(hours=s.session_hours)
    row = tx.one("""INSERT INTO sessions (id, org_id, user_id, token_hash, csrf_token, client, state, mfa_verified,
                    user_agent, expires_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                 (uuid.uuid4(), user["org_id"], user["id"], token_hash(token), new_token(24), client, state,
                  mfa_verified, (request.headers.get("user-agent") or "")[:300], now() + lifetime))
    return token, row


def _trusted(tx: Tx, request: Request, user_id) -> bool:
    raw = request.cookies.get(TRUST_COOKIE)
    if not raw:
        return False
    return tx.one("SELECT 1 FROM trusted_devices WHERE token_hash=%s AND user_id=%s AND expires_at>now()",
                  (token_hash(raw), user_id)) is not None


@router.get("/auth/config")
def auth_config() -> dict:
    s = get_settings()
    return {"oidc_enabled": s.oidc_enabled, "password_login": True, "mfa_required_roles": list(MFA_REQUIRED_ROLES),
            "support_contact": s.support_contact}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, tx: Tx = Depends(public_tx)) -> dict:
    if body.client not in ("web", "ios"):
        raise invalid("client")
    email = body.email.strip().lower()
    key = f"login:{email}:{client_ip(request)}"
    _throttle_check(tx, key)
    _throttle_check(tx, f"login:{email}")
    found = tx.one("SELECT * FROM rg_user_for_login(%s)", (email,))
    ok = verify_password(found["password_hash"] if found else None, body.password)
    if not found or not ok or not found["active"]:
        if found:
            with transaction() as atx:  # persists although this request fails
                atx.set_context(found["org_id"])
                audit(atx, str(found["org_id"]), "auth.login", "user", found["id"], actor_kind="system",
                      result="failed", detail={"reason": "invalid_credentials"})
        _throttle_fail(key)
        _throttle_fail(f"login:{email}")
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect")
    tx.set_context(found["org_id"], found["id"])
    user = tx.one("SELECT * FROM app_users WHERE id=%s", (found["id"],))
    trusted = body.client == "web" and _trusted(tx, request, user["id"])
    token, sess = create_session(tx, user, body.client, request, mfa_verified=trusted and user["mfa_enabled"])
    if sess["state"] == "authenticated":
        tx.run("UPDATE app_users SET last_sign_in_at=now() WHERE id=%s", (user["id"],))
    audit(tx, str(user["org_id"]), "auth.login", "session", sess["id"], actor_id=str(user["id"]),
          detail={"client": body.client, "state": sess["state"], "trusted_device": trusted})
    tx.run("DELETE FROM login_throttle WHERE key=%s OR key=%s", (key, f"login:{email}"))
    out = {"state": sess["state"], "expires_at": iso(sess["expires_at"])}
    if body.client == "ios":
        out["token"] = token
    else:
        _set_session_cookies(response, token, sess["csrf_token"], sess["expires_at"])
    return out


def _complete_mfa(c: Ctx) -> None:
    c.tx.run("UPDATE sessions SET state='authenticated', mfa_verified=true WHERE id=%s", (c.actor.session_id,))
    c.tx.run("UPDATE app_users SET last_sign_in_at=now() WHERE id=%s", (c.actor.user_id,))


@router.post("/auth/mfa/verify")
def mfa_verify(body: MfaVerifyIn, request: Request, response: Response, c: Ctx = Depends(partial_ctx)) -> dict:
    a = c.actor
    key = f"mfa:{a.user_id}"
    _throttle_check(c.tx, key)
    user = c.tx.one("SELECT * FROM app_users WHERE id=%s", (a.user_id,))
    if not user["mfa_enabled"]:
        raise ApiError(409, "mfa_not_enabled", "Set up an authenticator first")
    ok = False
    method = "totp"
    if body.code:
        ok = verify_totp(decrypt_secret(user["mfa_secret_enc"], "mfa"), body.code)
    elif body.recovery_code:
        method = "recovery_code"
        wanted = token_hash(body.recovery_code.strip().lower())
        codes = list(user["recovery_codes"])
        if wanted in codes:
            codes.remove(wanted)
            c.tx.run("UPDATE app_users SET recovery_codes=%s WHERE id=%s", (J(codes), a.user_id))
            ok = True
    if not ok:
        _throttle_fail(key)
        raise ApiError(401, "invalid_code", "The code is not valid")
    _complete_mfa(c)
    if body.trust_device and a.client == "web":
        raw = new_token()
        c.tx.run("INSERT INTO trusted_devices (id, org_id, user_id, token_hash, expires_at) VALUES (%s,%s,%s,%s,%s)",
                 (uuid.uuid4(), a.org_id, a.user_id, token_hash(raw), now() + timedelta(days=30)))
        response.set_cookie(TRUST_COOKIE, raw, max_age=30 * 86400, httponly=True,
                            secure=get_settings().cookie_secure, samesite="strict", path="/v1/auth")
    audit(c.tx, a.org_id, "auth.mfa_verified", "session", a.session_id, actor=a,
          detail={"method": method, "trust_device": body.trust_device})
    return {"state": "authenticated"}


@router.get("/auth/mfa/setup")
def mfa_setup(c: Ctx = Depends(partial_ctx)) -> dict:
    user = c.tx.one("SELECT * FROM app_users WHERE id=%s", (c.actor.user_id,))
    if user["mfa_enabled"]:
        raise ApiError(409, "mfa_already_enabled", "Multi-factor authentication is already enabled")
    secret = new_totp_secret()
    c.tx.run("UPDATE app_users SET mfa_secret_enc=%s WHERE id=%s", (encrypt_secret(secret, "mfa"), user["id"]))
    return {"secret": secret, "otpauth_uri": totp_uri(secret, user["email"])}


@router.post("/auth/mfa/enable")
def mfa_enable(body: MfaEnableIn, c: Ctx = Depends(partial_ctx)) -> dict:
    user = c.tx.one("SELECT * FROM app_users WHERE id=%s", (c.actor.user_id,))
    if user["mfa_enabled"]:
        raise ApiError(409, "mfa_already_enabled", "Multi-factor authentication is already enabled")
    if not user["mfa_secret_enc"] or not verify_totp(decrypt_secret(user["mfa_secret_enc"], "mfa"), body.code):
        raise ApiError(401, "invalid_code", "The code is not valid")
    codes = new_recovery_codes()
    c.tx.run("UPDATE app_users SET mfa_enabled=true, recovery_codes=%s, version=version+1 WHERE id=%s",
             (J([token_hash(x) for x in codes]), user["id"]))
    _complete_mfa(c)
    audit(c.tx, c.actor.org_id, "auth.mfa_enabled", "user", user["id"], actor=c.actor)
    return {"state": "authenticated", "recovery_codes": codes}


@router.post("/auth/logout")
def logout(response: Response, c: Ctx = Depends(partial_ctx)) -> dict:
    c.tx.run("UPDATE sessions SET revoked_at=now() WHERE id=%s", (c.actor.session_id,))
    c.tx.run("UPDATE push_devices SET revoked_at=now() WHERE session_id=%s AND revoked_at IS NULL",
             (c.actor.session_id,))
    audit(c.tx, c.actor.org_id, "auth.logout", "session", c.actor.session_id, actor=c.actor)
    _clear_cookies(response)
    return {"ok": True}


@router.post("/auth/password-reset/request", status_code=202)
def reset_request(body: ResetRequestIn, request: Request, tx: Tx = Depends(public_tx)) -> dict:
    # Email delivery is not configured in this deployment (no SMTP input supplied). The request is
    # recorded for administrators; administrators issue reset links from User management.
    # The response is identical whether or not the account exists.
    key = f"reset:{client_ip(request)}"
    _throttle_check(tx, key)
    _throttle_fail(key)  # counts requests per client address
    found = tx.one("SELECT * FROM rg_user_for_login(%s)", (body.email.strip().lower(),))
    if found:
        tx.set_context(found["org_id"])
        audit(tx, str(found["org_id"]), "auth.password_reset_requested", "user", found["id"], actor_kind="system",
              detail={"delivery": "administrator_issued_link_required"})
    return {"ok": True}


@router.post("/auth/password-reset/complete")
def reset_complete(body: ResetCompleteIn, tx: Tx = Depends(public_tx)) -> dict:
    problem = password_problem(body.new_password)
    if problem:
        raise ApiError(422, "weak_password", "Choose a longer password", field_errors={"new_password": problem})
    found = tx.one("SELECT * FROM rg_reset_lookup(%s)", (token_hash(body.token),))
    if not found:
        raise ApiError(422, "invalid_or_expired_token", "This reset link is invalid or has expired")
    tx.set_context(found["org_id"])
    reset = tx.one("SELECT * FROM password_resets WHERE id=%s FOR UPDATE", (found["id"],))
    tx.run("UPDATE password_resets SET used_at=now() WHERE id=%s", (reset["id"],))
    tx.run("UPDATE app_users SET password_hash=%s, version=version+1 WHERE id=%s",
           (hash_password(body.new_password), reset["user_id"]))
    tx.run("UPDATE sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (reset["user_id"],))
    audit(tx, str(found["org_id"]), "auth.password_reset_completed", "user", reset["user_id"],
          actor_id=str(reset["user_id"]))
    return {"ok": True}


@router.post("/auth/invitations/accept")
def accept_invitation(body: InviteAcceptIn, tx: Tx = Depends(public_tx)) -> dict:
    problem = password_problem(body.password)
    if problem:
        raise ApiError(422, "weak_password", "Choose a longer password", field_errors={"password": problem})
    found = tx.one("SELECT * FROM rg_invitation_lookup(%s)", (token_hash(body.token),))
    if not found:
        raise ApiError(422, "invalid_or_expired_token", "This invitation is invalid or has expired")
    tx.set_context(found["org_id"])
    inv = tx.one("SELECT * FROM invitations WHERE id=%s FOR UPDATE", (found["id"],))
    if tx.one("SELECT 1 FROM rg_user_for_login(%s)", (inv["email"],)):
        raise ApiError(409, "account_exists", "An account already exists for this invitation")
    uid = uuid.uuid4()
    tx.run("""INSERT INTO app_users (id, org_id, email, display_name, role, password_hash)
              VALUES (%s,%s,%s,%s,%s,%s)""",
           (uid, inv["org_id"], inv["email"], body.display_name.strip(), inv["role"], hash_password(body.password)))
    for sid in inv["store_ids"]:
        tx.run("INSERT INTO memberships (org_id, store_id, user_id) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
               (inv["org_id"], sid, uid))
    tx.run("UPDATE invitations SET accepted_at=now() WHERE id=%s", (inv["id"],))
    audit(tx, str(inv["org_id"]), "user.invitation_accepted", "user", uid, actor_id=str(uid),
          detail={"role": inv["role"], "invitation_id": str(inv["id"])})
    return {"ok": True}


# ---- OIDC (enterprise SSO) -------------------------------------------------------------

def _oidc_metadata() -> dict:
    s = get_settings()
    r = httpx.get(s.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration", timeout=10)
    r.raise_for_status()
    meta = r.json()
    if meta.get("issuer", "").rstrip("/") != s.oidc_issuer.rstrip("/"):
        raise ApiError(503, "oidc_misconfigured", "Identity provider issuer mismatch")
    return meta


@router.get("/auth/oidc/start")
def oidc_start() -> Response:
    s = get_settings()
    if not s.oidc_enabled:
        raise ApiError(503, "oidc_unconfigured", "Company SSO is not configured for this deployment")
    meta = _oidc_metadata()
    verifier, state, nonce = new_token(48), new_token(24), new_token(24)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    params = {"response_type": "code", "client_id": s.oidc_client_id, "scope": "openid email profile",
              "redirect_uri": s.web_origin + "/v1/auth/oidc/callback", "state": state, "nonce": nonce,
              "code_challenge": challenge, "code_challenge_method": "S256"}
    resp = RedirectResponse(meta["authorization_endpoint"] + "?" + urlencode(params), status_code=302)
    for name, value in (("rg_oidc_state", state), ("rg_oidc_nonce", nonce), ("rg_oidc_verifier", verifier)):
        resp.set_cookie(name, value, max_age=600, httponly=True, secure=s.cookie_secure, samesite="lax",
                        path="/v1/auth/oidc")
    return resp


@router.get("/auth/oidc/callback")
def oidc_callback(request: Request, code: str = "", state: str = "") -> Response:
    s = get_settings()
    if not s.oidc_enabled:
        raise ApiError(503, "oidc_unconfigured", "Company SSO is not configured for this deployment")
    if not code or not state or not secrets.compare_digest(state, request.cookies.get("rg_oidc_state", "")):
        raise ApiError(400, "oidc_state_mismatch", "Sign-in request expired. Start again.")
    meta = _oidc_metadata()
    token_resp = httpx.post(meta["token_endpoint"], timeout=10, data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": s.web_origin + "/v1/auth/oidc/callback",
        "client_id": s.oidc_client_id, "client_secret": s.oidc_client_secret or "",
        "code_verifier": request.cookies.get("rg_oidc_verifier", "")})
    if token_resp.status_code != 200:
        raise ApiError(401, "oidc_exchange_failed", "Company sign-in failed")
    id_token = token_resp.json().get("id_token", "")
    jwks = jwt.PyJWKClient(meta["jwks_uri"])
    claims = jwt.decode(id_token, jwks.get_signing_key_from_jwt(id_token).key, algorithms=["RS256", "ES256"],
                        audience=s.oidc_client_id, issuer=meta["issuer"])
    if not secrets.compare_digest(claims.get("nonce", ""), request.cookies.get("rg_oidc_nonce", "")):
        raise ApiError(401, "oidc_nonce_mismatch", "Company sign-in failed")
    if not claims.get("email") or claims.get("email_verified") is False:
        raise ApiError(403, "oidc_email_unverified", "Your company account email is not verified")
    with transaction() as tx:
        found = tx.one("SELECT * FROM rg_oidc_user(%s, %s)", (claims["sub"], claims["email"]))
        if not found or not found["active"]:
            raise ApiError(403, "not_provisioned", "Your account has not been invited to this organization")
        tx.set_context(found["org_id"], found["id"])
        tx.run("UPDATE app_users SET oidc_subject=%s WHERE id=%s AND oidc_subject IS NULL", (claims["sub"], found["id"]))
        user = tx.one("SELECT * FROM app_users WHERE id=%s", (found["id"],))
        # Enterprise IdP authentication; RetailGuard still requires its own MFA for sensitive roles
        # unless the IdP asserts MFA via amr.
        idp_mfa = "mfa" in (claims.get("amr") or [])
        token, sess = create_session(tx, user, "web", request, mfa_verified=idp_mfa)
        audit(tx, str(user["org_id"]), "auth.login", "session", sess["id"], actor_id=str(user["id"]),
              detail={"client": "web", "method": "oidc", "state": sess["state"]})
    target = "/web/dashboard" if sess["state"] == "authenticated" else (
        "/web/mfa" if sess["state"] == "mfa_required" else "/web/mfa?enroll=1")
    resp = RedirectResponse(target, status_code=302)
    _set_session_cookies(resp, token, sess["csrf_token"], sess["expires_at"])
    return resp


# ---- me ----------------------------------------------------------------------------------

def me_payload(c: Ctx) -> dict:
    a = c.actor
    u = c.tx.one("SELECT * FROM app_users WHERE id=%s", (a.user_id,))
    org = c.tx.one("SELECT id, name, timezone, region FROM organizations WHERE id=%s", (a.org_id,))
    stores = [clean(r) for r in c.tx.all(
        "SELECT id, name, timezone, region FROM stores WHERE id = ANY(%s::uuid[]) ORDER BY name", (a.store_ids,))]
    sess = c.tx.one("SELECT id, expires_at, mfa_verified FROM sessions WHERE id=%s", (a.session_id,))
    unread = c.tx.scalar("SELECT count(*) FROM notifications WHERE user_id=%s AND read_at IS NULL", (a.user_id,))
    return {
        "user": {"id": str(u["id"]), "email": u["email"], "display_name": u["display_name"], "role": u["role"],
                 "locale": u["locale"], "theme": u["theme"], "mfa_enabled": u["mfa_enabled"],
                 "notification_prefs": notification_prefs(u)},
        "org": clean(org), "stores": stores, "permissions": sorted(PERMISSIONS[u["role"]]),
        "session": clean(sess), "unread_notifications": unread,
    }


DEFAULT_PREFS = {"behavior": True, "watchlist": True, "checkout": True, "rfid": True, "sound": True,
                 "private_preview": True, "quiet_hours": None, "store_ids": []}


def notification_prefs(user: dict) -> dict:
    prefs = dict(DEFAULT_PREFS)
    prefs.update({k: v for k, v in (user.get("notification_prefs") or {}).items() if k in DEFAULT_PREFS})
    prefs["private_preview"] = True  # lock-screen text is always generic
    return prefs


@router.get("/me")
def me(c: Ctx = Depends(ctx)) -> dict:
    return me_payload(c)


@router.patch("/me/preferences")
def update_prefs(body: PrefsIn, c: Ctx = Depends(ctx)) -> dict:
    sets, vals = [], []
    if body.locale is not None:
        if body.locale not in ("ja", "en"):
            raise invalid("locale")
        sets.append("locale=%s"); vals.append(body.locale)
    if body.theme is not None:
        if body.theme not in ("light", "dark", "system"):
            raise invalid("theme")
        sets.append("theme=%s"); vals.append(body.theme)
    if body.notification_prefs is not None:
        p = body.notification_prefs
        merged = notification_prefs({"notification_prefs": p})
        for k in ("behavior", "watchlist", "checkout", "rfid", "sound"):
            if not isinstance(merged[k], bool):
                raise invalid(f"notification_prefs.{k}")
        qh = merged["quiet_hours"]
        if qh is not None:
            import re
            if not (isinstance(qh, dict) and all(isinstance(qh.get(x), str) and re.fullmatch(r"[0-2]\d:[0-5]\d", qh[x])
                                                 for x in ("start", "end"))):
                raise invalid("notification_prefs.quiet_hours")
        if not isinstance(merged["store_ids"], list) or any(str(x) not in c.actor.store_ids for x in merged["store_ids"]):
            raise invalid("notification_prefs.store_ids")
        sets.append("notification_prefs=%s"); vals.append(J(merged))
    if sets:
        c.tx.run(f"UPDATE app_users SET {', '.join(sets)}, version=version+1 WHERE id=%s", (*vals, c.actor.user_id))
        audit(c.tx, c.actor.org_id, "user.preferences_updated", "user", c.actor.user_id, actor=c.actor,
              detail={"fields": [s.split("=")[0] for s in sets]})
    return me_payload(c)


@router.get("/me/sessions")
def my_sessions(c: Ctx = Depends(ctx)) -> dict:
    rows = c.tx.all("""SELECT id, client, created_at, last_seen_at, expires_at, user_agent FROM sessions
                       WHERE user_id=%s AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC""",
                    (c.actor.user_id,))
    return {"items": [dict(clean(r), current=str(r["id"]) == c.actor.session_id) for r in rows]}


@router.delete("/me/sessions/{session_id}")
def revoke_my_session(session_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    n = c.tx.run("UPDATE sessions SET revoked_at=now() WHERE id=%s AND user_id=%s AND revoked_at IS NULL",
                 (session_id, c.actor.user_id))
    if not n:
        raise ApiError(404, "not_found", "Not found")
    c.tx.run("UPDATE push_devices SET revoked_at=now() WHERE session_id=%s AND revoked_at IS NULL", (session_id,))
    audit(c.tx, c.actor.org_id, "auth.session_revoked", "session", session_id, actor=c.actor)
    return {"ok": True}
