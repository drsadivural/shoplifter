"""Role/permission matrix, actor context, audit writing and shared request helpers."""
from __future__ import annotations

import base64
import contextvars
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .db import J, Tx
from .errors import ApiError, conflict, forbidden, invalid

ROLES = ("viewer", "responder", "investigator", "store_admin", "org_admin")
MFA_REQUIRED_ROLES = ("org_admin", "store_admin", "investigator")


def mfa_required(tx: Tx, org_id: Any, role: str) -> bool:
    """Whether this role must use an authenticator app in this organization. Organization admins
    can switch the requirement off (general settings); anything but an explicit false keeps it on."""
    if role not in MFA_REQUIRED_ROLES:
        return False
    row = tx.one("SELECT settings FROM org_settings WHERE org_id=%s AND kind='general'", (org_id,))
    return ((row or {}).get("settings") or {}).get("require_mfa_for_privileged_roles") is not False

_VIEW = {"dashboard.read", "incident.read", "camera.read", "store.read", "report.read", "health.read",
         "support.create"}
_RESPOND = _VIEW | {"incident.create", "incident.respond", "search.metadata", "profile.read", "photo.read"}
_INVESTIGATE = _RESPOND | {"case.read", "case.manage", "export.create", "search.photo", "audit.read",
                           "incident.reopen"}
_STORE_ADMIN = _RESPOND | {"case.read", "search.photo", "audit.read", "incident.reopen", "staff.manage",
                           "watchlist.manage", "watchlist.approve", "camera.manage", "edge.manage",
                           "store.manage", "policy.manage", "integration.manage"}
ALL_ACTIONS = sorted(_INVESTIGATE | _STORE_ADMIN | {"user.manage", "org.manage", "model.manage",
                                                    "privacy.manage"})
PERMISSIONS: dict[str, set[str]] = {
    "viewer": _VIEW,
    "responder": _RESPOND,
    "investigator": _INVESTIGATE,
    "store_admin": _STORE_ADMIN,
    "org_admin": set(ALL_ACTIONS),
}

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


@dataclass
class Actor:
    user_id: str
    org_id: str
    role: str
    email: str
    display_name: str
    store_ids: list[str]
    session_id: str
    client: str
    mfa_verified: bool
    all_stores: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    def can(self, action: str) -> bool:
        return action in PERMISSIONS.get(self.role, set())

    def require(self, action: str, store_id: str | None = None) -> None:
        if not self.can(action):
            raise forbidden()
        if store_id is not None:
            self.require_store(store_id)

    def require_store(self, store_id: str | None) -> None:
        if store_id is None:
            return
        if not self.all_stores and str(store_id) not in self.store_ids:
            # Out-of-scope objects are indistinguishable from nonexistent ones.
            raise ApiError(404, "not_found", "Not found")

    def scoped_stores(self, requested: str | None = None) -> list[str]:
        if requested:
            self.require_store(requested)
            return [str(requested)]
        return list(self.store_ids)


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value


def clean(row: dict | None) -> dict | None:
    """Convert DB row values into JSON-safe values."""
    if row is None:
        return None
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = iso(v)
        elif hasattr(v, "hex") and type(v).__name__ == "UUID":
            out[k] = str(v)
        elif type(v).__name__ == "Decimal":
            out[k] = float(v)
        elif isinstance(v, list):
            out[k] = [str(x) if type(x).__name__ == "UUID" else x for x in v]
        else:
            out[k] = v
    return out


def audit(tx: Tx, org_id: str, action: str, resource_type: str, resource_id: Any, *,
          actor: Actor | None = None, actor_id: str | None = None, actor_kind: str = "user",
          store_id: Any = None, result: str = "success", detail: dict | None = None) -> None:
    """Append-only audit with a per-organization hash chain for tamper evidence."""
    tx.run("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"audit:{org_id}",))
    prev = tx.scalar("SELECT hash FROM audit WHERE org_id=%s ORDER BY seq DESC LIMIT 1", (org_id,))
    who = actor.user_id if actor else actor_id
    stamp = now()
    record = {"org_id": str(org_id), "actor": str(who) if who else None, "actor_kind": actor_kind,
              "action": action, "resource_type": resource_type, "resource_id": str(resource_id),
              "store_id": str(store_id) if store_id else None, "result": result, "detail": detail or {},
              "request_id": request_id_var.get(), "at": iso(stamp)}
    digest = hashlib.sha256(((prev or "") + json.dumps(record, sort_keys=True, default=str)).encode()).hexdigest()
    import uuid
    tx.run("""INSERT INTO audit (id, org_id, store_id, actor_id, actor_kind, action, resource_type, resource_id,
              result, detail, request_id, prev_hash, hash, created_at)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
           (uuid.uuid4(), org_id, store_id, who, actor_kind, action, resource_type, str(resource_id), result,
            J(detail or {}), request_id_var.get(), prev, digest, stamp))


def outbox(tx: Tx, org_id: str, event_key: str, topic: str, payload: dict) -> None:
    import uuid
    tx.run("""INSERT INTO outbox (id, org_id, event_key, topic, payload) VALUES (%s,%s,%s,%s,%s)
              ON CONFLICT (org_id, event_key, topic) DO NOTHING""",
           (uuid.uuid4(), org_id, event_key, topic, J(payload)))


def check_version(row: dict | None, expected: Any) -> None:
    if row is None:
        raise ApiError(404, "not_found", "Not found")
    if type(expected) is not int:
        raise invalid("expected_version", "required")
    if expected != row["version"]:
        raise conflict("version_conflict", row["version"])


# ---- cursor pagination ------------------------------------------------------------------

def encode_cursor(*values: Any) -> str:
    return base64.urlsafe_b64encode(json.dumps([iso(v) if isinstance(v, datetime) else str(v)
                                                for v in values]).encode()).decode()


def decode_cursor(cursor: str | None, n: int) -> list[str] | None:
    if not cursor:
        return None
    try:
        values = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except (ValueError, TypeError):
        raise ApiError(400, "invalid_cursor", "Invalid cursor")
    if not isinstance(values, list) or len(values) != n:
        raise ApiError(400, "invalid_cursor", "Invalid cursor")
    return values


def page_limit(limit: int | None) -> int:
    if limit is None:
        return 50
    if not 1 <= limit <= 100:
        raise invalid("limit", "out_of_range")
    return limit
