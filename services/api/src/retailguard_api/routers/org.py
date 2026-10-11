"""Organization, stores, store policies, users, invitations, roles and team."""
from __future__ import annotations

import uuid
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import policies
from ..authz import ALL_ACTIONS, PERMISSIONS, ROLES, audit, check_version, clean, iso, now
from ..deps import Ctx, ctx
from ..errors import ApiError, conflict, forbidden, invalid, not_found
from ..security import new_token, token_hash
from ..settings import get_settings

router = APIRouter(prefix="/v1", tags=["organization"])


def valid_tz(tz: str) -> str:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise invalid("timezone", "unknown_timezone")
    return tz


class OrgPatch(BaseModel):
    expected_version: int
    name: str | None = Field(default=None, min_length=1, max_length=200)
    timezone: str | None = None
    region: str | None = Field(default=None, min_length=1, max_length=100)
    primary_admin_id: uuid.UUID | None = None


class SettingsPut(BaseModel):
    expected_version: int
    settings: dict


class StoreIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    region: str = Field(default="", max_length=100)
    address: str = Field(min_length=1, max_length=500)
    timezone: str
    manager_name: str = Field(default="", max_length=120)
    opening_hours: str = Field(default="", max_length=200)


class StorePatch(BaseModel):
    expected_version: int
    name: str | None = Field(default=None, min_length=1, max_length=200)
    region: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, min_length=1, max_length=500)
    timezone: str | None = None
    manager_name: str | None = Field(default=None, max_length=120)
    opening_hours: str | None = Field(default=None, max_length=200)


class UserPatch(BaseModel):
    expected_version: int
    role: str | None = None
    store_ids: list[uuid.UUID] | None = None
    active: bool | None = None


class InviteIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    role: str
    store_ids: list[uuid.UUID] = Field(default_factory=list)
    expires_in_days: int = Field(default=7, ge=1, le=14)


# ---- organization ------------------------------------------------------------------------

@router.get("/org")
def get_org(c: Ctx = Depends(ctx)) -> dict:
    return clean(c.tx.one("SELECT id, name, timezone, region, primary_admin_id, version, created_at FROM organizations WHERE id=%s",
                          (c.actor.org_id,)))


@router.patch("/org")
def patch_org(body: OrgPatch, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("org.manage")
    row = c.tx.one("SELECT * FROM organizations WHERE id=%s FOR UPDATE", (c.actor.org_id,))
    check_version(row, body.expected_version)
    changes = body.model_dump(exclude_none=True, exclude={"expected_version"})
    if "timezone" in changes:
        valid_tz(changes["timezone"])
    if "primary_admin_id" in changes:
        admin = c.tx.one("SELECT role, active FROM app_users WHERE id=%s", (changes["primary_admin_id"],))
        if not admin or admin["role"] != "org_admin" or not admin["active"]:
            raise invalid("primary_admin_id", "must_be_active_org_admin")
    if changes:
        sets = ", ".join(f"{k}=%s" for k in changes)
        c.tx.run(f"UPDATE organizations SET {sets}, version=version+1 WHERE id=%s", (*changes.values(), c.actor.org_id))
        audit(c.tx, c.actor.org_id, "org.updated", "organization", c.actor.org_id, actor=c.actor,
              detail={"fields": sorted(changes)})
    return get_org(c)


def _settings_row(c: Ctx, kind: str) -> dict:
    row = c.tx.one("SELECT * FROM org_settings WHERE org_id=%s AND kind=%s", (c.actor.org_id, kind))
    if row is None:
        return {"kind": kind, "settings": policies.default(policies.ORG_KINDS[kind]), "version": 0,
                "updated_at": None, "updated_by": None}
    merged = policies.validate(policies.ORG_KINDS[kind], row["settings"])
    return {"kind": kind, "settings": merged, "version": row["version"], "updated_at": iso(row["updated_at"]),
            "updated_by": str(row["updated_by"]) if row["updated_by"] else None}


@router.get("/org/settings/{kind}")
def get_org_settings(kind: str, c: Ctx = Depends(ctx)) -> dict:
    if kind not in policies.ORG_KINDS:
        raise not_found()
    return _settings_row(c, kind)


@router.put("/org/settings/{kind}")
def put_org_settings(kind: str, body: SettingsPut, c: Ctx = Depends(ctx)) -> dict:
    if kind not in policies.ORG_KINDS:
        raise not_found()
    c.actor.require("privacy.manage" if kind == "privacy" else "org.manage")
    data = policies.validate(policies.ORG_KINDS[kind], body.settings)
    current = c.tx.one("SELECT * FROM org_settings WHERE org_id=%s AND kind=%s FOR UPDATE", (c.actor.org_id, kind))
    from ..db import J
    if current is None:
        if body.expected_version != 0:
            raise conflict("version_conflict", 0)
        c.tx.run("INSERT INTO org_settings (org_id, kind, settings, updated_by) VALUES (%s,%s,%s,%s)",
                 (c.actor.org_id, kind, J(data), c.actor.user_id))
    else:
        check_version(current, body.expected_version)
        c.tx.run("UPDATE org_settings SET settings=%s, version=version+1, updated_by=%s, updated_at=now() WHERE org_id=%s AND kind=%s",
                 (J(data), c.actor.user_id, c.actor.org_id, kind))
    audit(c.tx, c.actor.org_id, f"settings.{kind}_updated", "org_settings", kind, actor=c.actor, detail={"settings": data})
    return _settings_row(c, kind)


# ---- stores ------------------------------------------------------------------------------

STORE_SQL = """
SELECT s.*,
  (SELECT count(*) FROM cameras c WHERE c.store_id=s.id AND c.readiness<>'disabled') AS camera_count,
  (SELECT count(*) FROM cameras c WHERE c.store_id=s.id AND c.readiness='ready') AS cameras_ready,
  (SELECT count(*) FROM cameras c WHERE c.store_id=s.id AND c.analysis_state='analyzing') AS cameras_analyzing,
  (SELECT count(*) FROM incidents i WHERE i.store_id=s.id AND i.status<>'resolved') AS open_alerts,
  (SELECT CASE WHEN count(*)=0 THEN 'unpaired'
               WHEN bool_or(e.last_seen_at > now() - interval '60 seconds') THEN 'online' ELSE 'offline' END
     FROM edges e WHERE e.store_id=s.id AND e.revoked_at IS NULL) AS edge_state,
  (SELECT max(e.last_seen_at) FROM edges e WHERE e.store_id=s.id AND e.revoked_at IS NULL) AS edge_last_seen_at
FROM stores s"""


def store_out(r: dict) -> dict:
    out = clean(r)
    out.pop("config_version", None)
    return out


@router.get("/stores")
def list_stores(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("store.read")
    rows = c.tx.all(STORE_SQL + " WHERE s.id = ANY(%s::uuid[]) ORDER BY s.name, s.id", (c.actor.store_ids,))
    return {"items": [store_out(r) for r in rows], "next_cursor": None}


@router.post("/stores", status_code=201)
def create_store(body: StoreIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("org.manage")
    valid_tz(body.timezone)
    if c.tx.one("SELECT 1 FROM stores WHERE lower(name)=lower(%s)", (body.name.strip(),)):
        raise ApiError(422, "validation_failed", "A store with this name exists", field_errors={"name": "duplicate"})
    sid = uuid.uuid4()
    c.tx.run("""INSERT INTO stores (id, org_id, name, region, address, timezone, manager_name, opening_hours)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
             (sid, c.actor.org_id, body.name.strip(), body.region.strip(), body.address.strip(), body.timezone,
              body.manager_name.strip(), body.opening_hours.strip()))
    audit(c.tx, c.actor.org_id, "store.created", "store", sid, actor=c.actor, store_id=sid,
          detail={"name": body.name.strip()})
    return store_out(c.tx.one(STORE_SQL + " WHERE s.id=%s", (sid,)))


@router.get("/stores/{store_id}")
def get_store(store_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("store.read", str(store_id))
    r = c.tx.one(STORE_SQL + " WHERE s.id=%s", (store_id,))
    if not r:
        raise not_found()
    out = store_out(r)
    out["summary"] = {
        "coverage": {"cameras_total": r["camera_count"], "cameras_ready": r["cameras_ready"],
                     "cameras_analyzing": r["cameras_analyzing"]},
        "open_incidents": r["open_alerts"],
        "review_queue": c.tx.scalar("SELECT count(*) FROM incidents WHERE store_id=%s AND status IN ('new','reviewing')",
                                    (store_id,)),
        "last_refresh": iso(now()),
    }
    return out


@router.patch("/stores/{store_id}")
def patch_store(store_id: uuid.UUID, body: StorePatch, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("store.manage", str(store_id))
    row = c.tx.one("SELECT * FROM stores WHERE id=%s FOR UPDATE", (store_id,))
    check_version(row, body.expected_version)
    changes = body.model_dump(exclude_none=True, exclude={"expected_version"})
    if "timezone" in changes:
        valid_tz(changes["timezone"])
    if changes:
        sets = ", ".join(f"{k}=%s" for k in changes)
        c.tx.run(f"UPDATE stores SET {sets}, version=version+1 WHERE id=%s", (*changes.values(), store_id))
        audit(c.tx, c.actor.org_id, "store.updated", "store", store_id, actor=c.actor, store_id=store_id,
              detail={"fields": sorted(changes)})
    return get_store(store_id, c)


def store_policy(c_tx, org_id: str, store_id, kind: str) -> dict:
    row = c_tx.one("SELECT * FROM store_policies WHERE store_id=%s AND kind=%s", (store_id, kind))
    if row is None:
        return {"kind": kind, "store_id": str(store_id), "settings": policies.default(policies.STORE_KINDS[kind]),
                "version": 0, "updated_at": None, "updated_by": None}
    return {"kind": kind, "store_id": str(store_id), "settings": policies.validate(policies.STORE_KINDS[kind], row["settings"]),
            "version": row["version"], "updated_at": iso(row["updated_at"]),
            "updated_by": str(row["updated_by"]) if row["updated_by"] else None}


@router.get("/stores/{store_id}/policies/{kind}")
def get_policy(store_id: uuid.UUID, kind: str, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("store.read", str(store_id))
    if kind not in policies.STORE_KINDS:
        raise not_found()
    return store_policy(c.tx, c.actor.org_id, store_id, kind)


@router.put("/stores/{store_id}/policies/{kind}")
def put_policy(store_id: uuid.UUID, kind: str, body: SettingsPut, c: Ctx = Depends(ctx)) -> dict:
    if kind not in policies.STORE_KINDS:
        raise not_found()
    c.actor.require("policy.manage", str(store_id))
    data = policies.validate(policies.STORE_KINDS[kind], body.settings)
    if kind == "escalation":
        ids = set(data["primary_responder_ids"]) | set(data["backup_responder_ids"])
        for uid in ids:
            u = c.tx.one("""SELECT u.role FROM app_users u WHERE u.id::text=%s AND u.active AND
                            (u.role='org_admin' OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.store_id=%s))""",
                         (uid, store_id))
            if not u or u["role"] == "viewer":
                raise invalid("responder_ids", "not_a_store_responder")
    if kind == "detection_rules":
        current_cal = store_policy(c.tx, c.actor.org_id, store_id, "calibration")["settings"]
        data["calibrated"] = bool(current_cal.get("published"))
    if kind == "calibration" and data["published"]:
        reviewed = c.tx.scalar("""SELECT count(*) FROM incidents WHERE store_id=%s AND outcome IS NOT NULL
                                  AND channel='behavior_candidate'""", (store_id,))
        if not data["reason"].strip():
            raise invalid("settings.reason", "required")
        if data["threshold"] is None:
            raise invalid("settings.threshold", "required")
        data["based_on_reviewed_incidents"] = reviewed
    from ..db import J
    current = c.tx.one("SELECT * FROM store_policies WHERE store_id=%s AND kind=%s FOR UPDATE", (store_id, kind))
    if current is None:
        if body.expected_version != 0:
            raise conflict("version_conflict", 0)
        c.tx.run("INSERT INTO store_policies (org_id, store_id, kind, settings, updated_by) VALUES (%s,%s,%s,%s,%s)",
                 (c.actor.org_id, store_id, kind, J(data), c.actor.user_id))
    else:
        check_version(current, body.expected_version)
        c.tx.run("""UPDATE store_policies SET settings=%s, version=version+1, updated_by=%s, updated_at=now()
                    WHERE store_id=%s AND kind=%s""", (J(data), c.actor.user_id, store_id, kind))
    c.tx.run("UPDATE stores SET config_version=config_version+1 WHERE id=%s", (store_id,))
    audit(c.tx, c.actor.org_id, f"policy.{kind}_updated", "store_policy", f"{store_id}:{kind}", actor=c.actor,
          store_id=store_id, detail={"settings": data})
    return store_policy(c.tx, c.actor.org_id, store_id, kind)


# ---- users -------------------------------------------------------------------------------

def user_out(c: Ctx, u: dict) -> dict:
    stores = [str(r["store_id"]) for r in c.tx.all("SELECT store_id FROM memberships WHERE user_id=%s", (u["id"],))]
    return {"id": str(u["id"]), "email": u["email"], "display_name": u["display_name"], "role": u["role"],
            "store_ids": stores, "mfa_enabled": u["mfa_enabled"], "active": u["active"],
            "last_sign_in_at": iso(u["last_sign_in_at"]), "version": u["version"]}


@router.get("/users")
def list_users(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("user.manage")
    rows = c.tx.all("SELECT * FROM app_users ORDER BY lower(display_name), lower(email), id")
    return {"items": [user_out(c, u) for u in rows], "next_cursor": None}


def _check_stores(c: Ctx, store_ids) -> list[str]:
    ids = [str(s) for s in store_ids]
    if ids:
        found = c.tx.scalar("SELECT count(*) FROM stores WHERE id = ANY(%s::uuid[])", (ids,))
        if found != len(set(ids)):
            raise invalid("store_ids", "unknown_store")
    return sorted(set(ids))


@router.patch("/users/{user_id}")
def patch_user(user_id: uuid.UUID, body: UserPatch, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("user.manage")
    u = c.tx.one("SELECT * FROM app_users WHERE id=%s FOR UPDATE", (user_id,))
    check_version(u, body.expected_version)
    is_self = str(user_id) == c.actor.user_id
    detail = {}
    if body.role is not None and body.role != u["role"]:
        if body.role not in ROLES:
            raise invalid("role")
        if is_self:
            raise ApiError(403, "self_lockout", "You cannot change your own role")
        if u["role"] == "org_admin":
            others = c.tx.scalar("SELECT count(*) FROM app_users WHERE role='org_admin' AND active AND id<>%s", (user_id,))
            if others == 0:
                raise conflict("last_admin", u["version"], "At least one active organization admin is required")
        c.tx.run("UPDATE app_users SET role=%s WHERE id=%s", (body.role, user_id))
        detail["role"] = {"from": u["role"], "to": body.role}
    if body.active is not None and body.active != u["active"]:
        if is_self:
            raise ApiError(403, "self_lockout", "You cannot deactivate yourself")
        if not body.active and u["role"] == "org_admin":
            others = c.tx.scalar("SELECT count(*) FROM app_users WHERE role='org_admin' AND active AND id<>%s", (user_id,))
            if others == 0:
                raise conflict("last_admin", u["version"], "At least one active organization admin is required")
        c.tx.run("UPDATE app_users SET active=%s WHERE id=%s", (body.active, user_id))
        detail["active"] = body.active
    if body.store_ids is not None:
        ids = _check_stores(c, body.store_ids)
        c.tx.run("DELETE FROM memberships WHERE user_id=%s", (user_id,))
        for sid in ids:
            c.tx.run("INSERT INTO memberships (org_id, store_id, user_id) VALUES (%s,%s,%s)", (c.actor.org_id, sid, user_id))
        detail["store_ids"] = ids
    if detail:
        c.tx.run("UPDATE app_users SET version=version+1 WHERE id=%s", (user_id,))
        # Permission changes take effect immediately: active sessions must re-authenticate.
        if "role" in detail or detail.get("active") is False:
            c.tx.run("UPDATE sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (user_id,))
            c.tx.run("UPDATE push_devices SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (user_id,))
        audit(c.tx, c.actor.org_id, "user.updated", "user", user_id, actor=c.actor, detail=detail)
    return user_out(c, c.tx.one("SELECT * FROM app_users WHERE id=%s", (user_id,)))


@router.post("/users/invitations", status_code=201)
def invite(body: InviteIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("user.manage")
    if body.role not in ROLES:
        raise invalid("role")
    email = body.email.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise invalid("email")
    ids = _check_stores(c, body.store_ids)
    if body.role != "org_admin" and not ids:
        raise invalid("store_ids", "required")
    if c.tx.one("SELECT 1 FROM rg_user_for_login(%s)", (email,)):
        raise ApiError(409, "account_exists", "This person already has an account")
    token = new_token()
    iid = uuid.uuid4()
    expires = now() + timedelta(days=body.expires_in_days)
    c.tx.run("""INSERT INTO invitations (id, org_id, email, role, store_ids, token_hash, expires_at, created_by)
                VALUES (%s,%s,%s,%s,%s::uuid[],%s,%s,%s)""",
             (iid, c.actor.org_id, email, body.role, ids, token_hash(token), expires, c.actor.user_id))
    audit(c.tx, c.actor.org_id, "user.invited", "invitation", iid, actor=c.actor,
          detail={"email": email, "role": body.role, "store_ids": ids})
    return {"id": str(iid), "accept_url": f"{get_settings().web_origin}/web/invite?token={token}",
            "expires_at": iso(expires)}


@router.get("/users/invitations")
def list_invitations(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("user.manage")
    rows = c.tx.all("""SELECT id, email, role, store_ids, expires_at, created_at FROM invitations
                       WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC""")
    return {"items": [clean(r) for r in rows], "next_cursor": None}


@router.delete("/users/invitations/{inv_id}")
def revoke_invitation(inv_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("user.manage")
    if not c.tx.run("UPDATE invitations SET revoked_at=now() WHERE id=%s AND accepted_at IS NULL AND revoked_at IS NULL", (inv_id,)):
        raise not_found()
    audit(c.tx, c.actor.org_id, "user.invitation_revoked", "invitation", inv_id, actor=c.actor)
    return {"ok": True}


@router.post("/users/{user_id}/password-reset-link")
def reset_link(user_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("user.manage")
    u = c.tx.one("SELECT * FROM app_users WHERE id=%s", (user_id,))
    if not u:
        raise not_found()
    token = new_token()
    expires = now() + timedelta(hours=24)
    c.tx.run("UPDATE password_resets SET used_at=now() WHERE user_id=%s AND used_at IS NULL", (user_id,))
    c.tx.run("INSERT INTO password_resets (id, org_id, user_id, token_hash, expires_at) VALUES (%s,%s,%s,%s,%s)",
             (uuid.uuid4(), c.actor.org_id, user_id, token_hash(token), expires))
    audit(c.tx, c.actor.org_id, "user.password_reset_link_issued", "user", user_id, actor=c.actor)
    return {"reset_url": f"{get_settings().web_origin}/web/reset?token={token}", "expires_at": iso(expires)}


@router.post("/users/{user_id}/sessions/revoke")
def revoke_user_sessions(user_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("user.manage")
    if not c.tx.one("SELECT 1 FROM app_users WHERE id=%s", (user_id,)):
        raise not_found()
    n = c.tx.run("UPDATE sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (user_id,))
    c.tx.run("UPDATE push_devices SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (user_id,))
    audit(c.tx, c.actor.org_id, "user.sessions_revoked", "user", user_id, actor=c.actor, detail={"count": n})
    return {"ok": True, "revoked": n}


@router.post("/users/{user_id}/mfa/reset")
def reset_user_mfa(user_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("user.manage")
    if str(user_id) == c.actor.user_id:
        raise ApiError(403, "self_lockout", "Ask another administrator to reset your authenticator")
    if not c.tx.run("UPDATE app_users SET mfa_enabled=false, mfa_secret_enc=NULL, recovery_codes='[]', version=version+1 WHERE id=%s",
                    (user_id,)):
        raise not_found()
    c.tx.run("UPDATE sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (user_id,))
    audit(c.tx, c.actor.org_id, "user.mfa_reset", "user", user_id, actor=c.actor)
    return {"ok": True}


@router.get("/roles")
def roles(c: Ctx = Depends(ctx)) -> dict:
    return {"roles": list(ROLES), "actions": [{"action": a, "roles": [r for r in ROLES if a in PERMISSIONS[r]]}
                                              for a in ALL_ACTIONS]}


@router.get("/team")
def team(store_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("store.read", str(store_id))
    esc = store_policy(c.tx, c.actor.org_id, store_id, "escalation")["settings"]
    duty = set(esc["primary_responder_ids"]) | set(esc["backup_responder_ids"])
    rows = c.tx.all("""SELECT u.id, u.display_name, u.role FROM app_users u WHERE u.active AND u.role<>'viewer' AND
                       (u.role='org_admin' OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.store_id=%s))
                       ORDER BY u.display_name, u.id""", (store_id,))
    return {"items": [{"id": str(r["id"]), "display_name": r["display_name"], "role": r["role"],
                       "on_duty": str(r["id"]) in duty,
                       "duty": "primary" if str(r["id"]) in esc["primary_responder_ids"] else
                               "backup" if str(r["id"]) in esc["backup_responder_ids"] else None} for r in rows]}
