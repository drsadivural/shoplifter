"""Store edge appliances: pairing, signed edge API (heartbeat, commands, events, evidence, snapshots)."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from importlib import resources

import jsonschema
from fastapi import APIRouter, Depends, Request
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from pydantic import BaseModel, Field

from ..authz import audit, clean, iso, now, outbox
from ..db import J, Tx, transaction
from ..deps import Ctx, ctx
from ..errors import ApiError, conflict, invalid, not_found
from ..security import new_token, token_hash
from ..settings import get_settings
from .. import media as media_store
from .org import store_policy

router = APIRouter(prefix="/v1", tags=["edge"])

SIGNATURE_WINDOW_S = 300
ONLINE_WINDOW_S = 60


class PairingCodeIn(BaseModel):
    device_name: str = Field(min_length=1, max_length=120)


class RevokeIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class PairIn(BaseModel):
    code: str = Field(min_length=6, max_length=64)
    device_name: str = Field(min_length=1, max_length=120)
    sign_public_key: str = Field(max_length=100)
    box_public_key: str = Field(max_length=100)
    software_version: str = Field(default="", max_length=100)
    # Chosen on the device; the console can change it later.
    processing_mode: str = "streaming"


MODES = ("streaming", "full")


class EdgePatch(BaseModel):
    expected_version: int
    name: str | None = Field(default=None, min_length=1, max_length=120)
    processing_mode: str | None = None


def edge_state(row: dict) -> str:
    if row["revoked_at"]:
        return "revoked"
    if row["last_seen_at"] and row["last_seen_at"] > now() - timedelta(seconds=ONLINE_WINDOW_S):
        return "online"
    return "offline"


def edge_out(row: dict) -> dict:
    return {"id": str(row["id"]), "store_id": str(row["store_id"]), "name": row["name"],
            "fingerprint": row["certificate_fingerprint"], "software_version": row["software_version"],
            "last_seen_at": iso(row["last_seen_at"]), "state": edge_state(row), "health": row["health"],
            "models": row["models"], "clock_offset_ms": row["clock_offset_ms"], "created_at": iso(row["created_at"]),
            "processing_mode": row["processing_mode"], "reported_mode": row["reported_mode"], "version": row["version"]}


# Without EDGE_ALLOWED_SUBNETS the API accepts any private camera address; the appliance is told the
# same thing explicitly (an empty list means "nothing allowed" on the edge).
PRIVATE_CAMERA_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]


def allowed_subnets() -> list[str]:
    nets = get_settings().edge_allowed_subnets
    return [str(n) for n in nets] if nets else list(PRIVATE_CAMERA_RANGES)


# ---- console endpoints -------------------------------------------------------------------

@router.post("/stores/{store_id}/edge-pairing-codes", status_code=201)
def create_pairing_code(store_id: uuid.UUID, body: PairingCodeIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("edge.manage", str(store_id))
    if not c.tx.one("SELECT 1 FROM stores WHERE id=%s", (store_id,)):
        raise not_found()
    # 12 characters from an unambiguous alphabet, grouped for typing on the appliance console.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    import secrets
    raw = "".join(secrets.choice(alphabet) for _ in range(12))
    code = f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"
    expires = now() + timedelta(minutes=15)
    c.tx.run("""INSERT INTO edge_pairing_codes (id, org_id, store_id, code_hash, device_name, expires_at, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
             (uuid.uuid4(), c.actor.org_id, store_id, token_hash(code), body.device_name.strip(), expires, c.actor.user_id))
    audit(c.tx, c.actor.org_id, "edge.pairing_code_created", "store", store_id, actor=c.actor, store_id=store_id,
          detail={"device_name": body.device_name.strip()})
    return {"code": code, "expires_at": iso(expires)}


@router.get("/edges")
def list_edges(store_id: uuid.UUID | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("store.read")
    stores = c.actor.scoped_stores(str(store_id) if store_id else None)
    rows = c.tx.all("SELECT * FROM edges WHERE store_id = ANY(%s::uuid[]) ORDER BY created_at DESC", (stores,))
    return {"items": [edge_out(r) for r in rows], "next_cursor": None}


@router.patch("/edges/{edge_id}")
def update_edge(edge_id: uuid.UUID, body: EdgePatch, c: Ctx = Depends(ctx)) -> dict:
    """Rename an appliance or switch it between streaming only and full processing on the edge."""
    row = c.tx.one("SELECT * FROM edges WHERE id=%s FOR UPDATE", (edge_id,))
    if not row:
        raise not_found()
    c.actor.require("edge.manage", str(row["store_id"]))
    if row["version"] != body.expected_version:
        raise conflict("version_conflict", row["version"])
    if row["revoked_at"]:
        raise ApiError(409, "already_revoked", "This appliance is revoked")
    detail: dict = {}
    if body.name is not None and body.name.strip() != row["name"]:
        c.tx.run("UPDATE edges SET name=%s WHERE id=%s", (body.name.strip(), edge_id))
        detail["name"] = body.name.strip()
    if body.processing_mode is not None and body.processing_mode != row["processing_mode"]:
        if body.processing_mode not in MODES:
            raise invalid("processing_mode")
        c.tx.run("UPDATE edges SET processing_mode=%s WHERE id=%s", (body.processing_mode, edge_id))
        queue_command(c.tx, c.actor.org_id, row["store_id"], edge_id, "set_processing_mode",
                      {"mode": body.processing_mode}, c.actor.user_id)
        if body.processing_mode == "streaming":
            # Analysis stops on the appliance; the console must not keep showing it as running.
            c.tx.run("""UPDATE cameras SET analysis_state='unavailable', version=version+1
                        WHERE edge_id=%s AND analysis_state IN ('analyzing','activation_requested','degraded')""", (edge_id,))
        detail["processing_mode"] = {"from": row["processing_mode"], "to": body.processing_mode}
    if detail:
        c.tx.run("UPDATE edges SET version=version+1 WHERE id=%s", (edge_id,))
        audit(c.tx, c.actor.org_id, "edge.updated", "edge", edge_id, actor=c.actor, store_id=row["store_id"], detail=detail)
    return edge_out(c.tx.one("SELECT * FROM edges WHERE id=%s", (edge_id,)))


@router.get("/edges/tree")
def edges_tree(c: Ctx = Depends(ctx)) -> dict:
    """Paired appliances in the caller's stores with the cameras each one serves (side menu)."""
    c.actor.require("camera.read")
    stores = c.actor.scoped_stores()
    edges = c.tx.all("""SELECT e.*, s.name AS store_name FROM edges e JOIN stores s ON s.id=e.store_id
                        WHERE e.store_id = ANY(%s::uuid[]) AND e.revoked_at IS NULL ORDER BY s.name, e.name""", (stores,))
    cams = c.tx.all("""SELECT id, edge_id, store_id, name, location, readiness, analysis_state, source_type
                       FROM cameras WHERE store_id = ANY(%s::uuid[]) AND readiness <> 'disabled' ORDER BY name, id""", (stores,))
    by_edge: dict[str, list] = {}
    unassigned: list = []
    for cam in cams:
        item = {"id": str(cam["id"]), "name": cam["name"], "location": cam["location"], "readiness": cam["readiness"],
                "analysis_state": cam["analysis_state"], "source_type": cam["source_type"], "store_id": str(cam["store_id"])}
        (by_edge.setdefault(str(cam["edge_id"]), []) if cam["edge_id"] else unassigned).append(item)
    items = [{**{k: v for k, v in edge_out(e).items() if k not in ("health", "models", "fingerprint")},
              "store_name": e["store_name"], "cameras": by_edge.get(str(e["id"]), [])} for e in edges]
    return {"items": items, "unassigned_cameras": unassigned}


@router.post("/edges/{edge_id}/revoke")
def revoke_edge(edge_id: uuid.UUID, body: RevokeIn, c: Ctx = Depends(ctx)) -> dict:
    row = c.tx.one("SELECT * FROM edges WHERE id=%s FOR UPDATE", (edge_id,))
    if not row:
        raise not_found()
    c.actor.require("edge.manage", str(row["store_id"]))
    if row["revoked_at"]:
        raise ApiError(409, "already_revoked", "This appliance is already revoked")
    c.tx.run("UPDATE edges SET revoked_at=now(), revoke_reason=%s WHERE id=%s", (body.reason, edge_id))
    c.tx.run("UPDATE edge_commands SET status='expired' WHERE edge_id=%s AND status IN ('queued','sent')", (edge_id,))
    c.tx.run("""UPDATE cameras SET analysis_state='unavailable', readiness=CASE WHEN readiness='disabled' THEN readiness ELSE 'offline' END,
                version=version+1 WHERE edge_id=%s""", (edge_id,))
    audit(c.tx, c.actor.org_id, "edge.revoked", "edge", edge_id, actor=c.actor, store_id=row["store_id"],
          detail={"reason": body.reason})
    return edge_out(c.tx.one("SELECT * FROM edges WHERE id=%s", (edge_id,)))


def queue_command(tx: Tx, org_id: str, store_id, edge_id, kind: str, payload: dict, actor_id: str | None) -> dict:
    return tx.one("""INSERT INTO edge_commands (id, org_id, store_id, edge_id, kind, payload, created_by)
                     VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                  (uuid.uuid4(), org_id, store_id, edge_id, kind, J(payload), actor_id))


def online_edge(tx: Tx, store_id) -> dict | None:
    return tx.one("""SELECT * FROM edges WHERE store_id=%s AND revoked_at IS NULL
                     ORDER BY last_seen_at DESC NULLS LAST LIMIT 1""", (store_id,))


# ---- edge pairing (code-gated, unsigned) -------------------------------------------------

@router.post("/edge/pair", status_code=201)
def pair(body: PairIn, request: Request) -> dict:
    from .auth import _throttle_check, _throttle_fail, client_ip
    key = f"pair:{client_ip(request)}"
    try:
        sign_key = base64.b64decode(body.sign_public_key, validate=True)
        box_key = base64.b64decode(body.box_public_key, validate=True)
        VerifyKey(sign_key)
    except Exception:
        raise invalid("sign_public_key", "invalid_key")
    if len(sign_key) != 32 or len(box_key) != 32:
        raise invalid("public_key", "invalid_length")
    with transaction() as tx:
        _throttle_check(tx, key)
        found = tx.one("SELECT * FROM rg_pairing_lookup(%s)", (token_hash(body.code.strip().upper()),))
    if not found:
        _throttle_fail(key)
        raise ApiError(401, "invalid_pairing_code", "Pairing code is invalid or expired")
    with transaction() as tx:
        tx.set_context(found["org_id"])
        code = tx.one("SELECT * FROM edge_pairing_codes WHERE id=%s AND used_at IS NULL FOR UPDATE", (found["id"],))
        if not code:
            raise ApiError(401, "invalid_pairing_code", "Pairing code is invalid or expired")
        fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(sign_key).digest()).decode().rstrip("=")
        if tx.one("SELECT 1 FROM edges WHERE certificate_fingerprint=%s", (fingerprint,)):
            raise ApiError(409, "key_already_paired", "This appliance key is already paired")
        edge_id = uuid.uuid4()
        tx.run("UPDATE edge_pairing_codes SET used_at=now() WHERE id=%s", (code["id"],))
        mode = body.processing_mode if body.processing_mode in MODES else "streaming"
        tx.run("""INSERT INTO edges (id, org_id, store_id, name, sign_public_key, box_public_key, certificate_fingerprint,
                  software_version, processing_mode, reported_mode) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
               (edge_id, code["org_id"], code["store_id"], body.device_name.strip() or code["device_name"],
                body.sign_public_key, body.box_public_key, fingerprint, body.software_version, mode, mode))
        store = tx.one("SELECT timezone FROM stores WHERE id=%s", (code["store_id"],))
        audit(tx, str(code["org_id"]), "edge.paired", "edge", edge_id, actor_kind="edge", actor_id=None,
              store_id=code["store_id"], detail={"fingerprint": fingerprint, "device_name": body.device_name,
                                                 "processing_mode": mode})
        return {"edge_id": str(edge_id), "processing_mode": mode, "org_id": str(code["org_id"]), "store_id": str(code["store_id"]),
                "store_timezone": store["timezone"], "allowed_subnets": allowed_subnets(), "api_version": 1,
                "fingerprint": fingerprint}


# ---- signed edge requests ------------------------------------------------------------------

class EdgeCtx:
    def __init__(self, tx: Tx, edge: dict, body: bytes):
        self.tx, self.edge, self.body = tx, edge, body
        self.org_id = str(edge["org_id"])
        self.store_id = str(edge["store_id"])
        self.id = str(edge["id"])


async def _raw_body(request: Request) -> bytes:
    return await request.body()


def edge_ctx(request: Request, body: bytes = Depends(_raw_body)):
    h = request.headers
    edge_id, ts, nonce, sig = (h.get("x-edge-id"), h.get("x-edge-timestamp"), h.get("x-edge-nonce"),
                               h.get("x-edge-signature"))
    if not all((edge_id, ts, nonce, sig)):
        raise ApiError(401, "edge_signature_required", "Signed request required")
    try:
        edge_uuid = uuid.UUID(edge_id)
        ts_int = int(ts)
        signature = base64.b64decode(sig, validate=True)
    except ValueError:
        raise ApiError(401, "edge_signature_invalid", "Invalid signature headers")
    if abs(time.time() - ts_int) > SIGNATURE_WINDOW_S:
        raise ApiError(401, "edge_clock_skew", "Request timestamp outside the accepted window; check time sync")
    if not 16 <= len(nonce) <= 128:
        raise ApiError(401, "edge_signature_invalid", "Invalid nonce")
    path = request.url.path + (("?" + request.url.query) if request.url.query else "")
    canonical = f"{request.method}\n{path}\n{ts}\n{nonce}\n{hashlib.sha256(body).hexdigest()}".encode()
    with transaction() as tx:
        found = tx.one("SELECT * FROM rg_edge_lookup(%s)", (edge_uuid,))
        if not found or found["revoked"]:
            raise ApiError(401, "edge_revoked", "Appliance is not paired or has been revoked")
        try:
            VerifyKey(base64.b64decode(found["sign_public_key"])).verify(canonical, signature)
        except (BadSignatureError, ValueError):
            raise ApiError(401, "edge_signature_invalid", "Signature verification failed")
        tx.set_context(found["org_id"])
        inserted = tx.run("INSERT INTO edge_nonces (edge_id, nonce) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                          (edge_uuid, nonce))
        if not inserted:
            raise ApiError(401, "edge_replay", "Replayed request rejected")
        edge = tx.one("SELECT * FROM edges WHERE id=%s", (edge_uuid,))
        yield EdgeCtx(tx, edge, body)


def _json(body: bytes) -> dict:
    try:
        data = json.loads(body or b"{}")
    except ValueError:
        raise ApiError(400, "invalid_json", "Malformed JSON")
    if not isinstance(data, dict):
        raise ApiError(422, "object_required", "JSON object required")
    return data


def _parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


READINESS = {"pending", "ready", "degraded", "offline", "disabled"}
ANALYSIS = {"unavailable", "activation_requested", "analyzing", "paused", "degraded"}
CHANNEL_STATES = {"not_requested", "unavailable", "starting", "running", "degraded"}


def _channels(value) -> dict:
    out = {}
    if isinstance(value, dict):
        for name in ("behavior", "watchlist", "checkout"):
            v = value.get(name)
            if isinstance(v, dict) and v.get("state") in CHANNEL_STATES:
                out[name] = {"state": v["state"], "reason": str(v.get("reason") or "")[:100] or None}
    return out


@router.post("/edge/heartbeat")
def heartbeat(e: EdgeCtx = Depends(edge_ctx)) -> dict:
    data = _json(e.body)
    health = data.get("health") if isinstance(data.get("health"), dict) else {}
    health = {k: health[k] for k in ("disk_free_bytes", "disk_total_bytes", "gpu_utilization", "decode_latency_ms_p95",
                                     "queue_age_s", "spool_pending") if isinstance(health.get(k), (int, float))}
    models = [m for m in data.get("models", []) if isinstance(m, dict)][:50] if isinstance(data.get("models"), list) else []
    offset = data.get("clock_offset_ms")
    prev_seen = e.edge["last_seen_at"]
    reported = data.get("processing_mode") if data.get("processing_mode") in MODES else None
    e.tx.run("""UPDATE edges SET last_seen_at=now(), software_version=%s, health=%s, models=%s, clock_offset_ms=%s,
                reported_mode=COALESCE(%s, reported_mode) WHERE id=%s""",
             (str(data.get("software_version", ""))[:100], J(health), J(models),
              int(offset) if isinstance(offset, (int, float)) else None, reported, e.id))
    elapsed = 0
    if prev_seen:
        elapsed = int(min(max((now() - prev_seen).total_seconds(), 0), 60))
    for cam in data.get("cameras", [])[:256] if isinstance(data.get("cameras"), list) else []:
        if not isinstance(cam, dict):
            continue
        try:
            cid = uuid.UUID(str(cam.get("camera_id")))
        except ValueError:
            continue
        row = e.tx.one("SELECT * FROM cameras WHERE id=%s AND store_id=%s FOR UPDATE", (cid, e.store_id))
        if not row:
            continue
        readiness = cam.get("readiness") if cam.get("readiness") in READINESS else row["readiness"]
        analysis = cam.get("analysis_state") if cam.get("analysis_state") in ANALYSIS else row["analysis_state"]
        if readiness != "ready" and analysis == "analyzing":
            analysis = "degraded"
        last_frame = _parse_ts(cam.get("last_frame_at")) or row["last_frame_at"]
        channels = _channels(cam.get("channels")) or row["channels"]
        e.tx.run("""UPDATE cameras SET readiness=%s, analysis_state=%s, channels=%s, last_frame_at=%s, edge_id=%s
                    WHERE id=%s""", (readiness, analysis, J(channels), last_frame, e.id, cid))
        if row["readiness"] == "ready" and readiness in ("offline", "degraded"):
            e.tx.run("INSERT INTO camera_outages (id, org_id, camera_id, started_at, reason) VALUES (%s,%s,%s,now(),%s)",
                     (uuid.uuid4(), e.org_id, cid, readiness))
            audit(e.tx, e.org_id, f"camera.{readiness}", "camera", cid, actor_kind="edge", actor_id=None,
                  store_id=e.store_id, detail={"error": str(cam.get("error") or "")[:200]})
        elif row["readiness"] in ("offline", "degraded") and readiness == "ready":
            e.tx.run("UPDATE camera_outages SET ended_at=now() WHERE camera_id=%s AND ended_at IS NULL", (cid,))
            audit(e.tx, e.org_id, "camera.recovered", "camera", cid, actor_kind="edge", actor_id=None, store_id=e.store_id)
        if analysis == "analyzing" and row["analysis_state"] == "analyzing" and elapsed > 0:
            e.tx.run("""INSERT INTO camera_analysis_time (org_id, camera_id, day, seconds) VALUES (%s,%s,%s,%s)
                        ON CONFLICT (org_id, camera_id, day) DO UPDATE SET seconds = camera_analysis_time.seconds + EXCLUDED.seconds""",
                     (e.org_id, cid, date.today(), elapsed))
    return {"ok": True, "config_version": e.tx.scalar("SELECT config_version FROM stores WHERE id=%s", (e.store_id,)),
            "allowed_subnets": allowed_subnets(), "processing_mode": e.edge["processing_mode"]}


@router.get("/edge/commands")
def edge_commands(e: EdgeCtx = Depends(edge_ctx)) -> dict:
    e.tx.run("""UPDATE edge_commands SET status='expired', completed_at=now() WHERE edge_id=%s AND status IN ('queued','sent')
                AND created_at < now() - interval '1 day'""", (e.id,))
    rows = e.tx.all("""SELECT * FROM edge_commands WHERE edge_id=%s AND (status='queued' OR
                       (status='sent' AND sent_at < now() - interval '120 seconds')) ORDER BY created_at LIMIT 20""", (e.id,))
    for r in rows:
        e.tx.run("UPDATE edge_commands SET status='sent', sent_at=now() WHERE id=%s", (r["id"],))
        if r["kind"] == "discover":
            e.tx.run("UPDATE discovery_jobs SET status='running' WHERE command_id=%s AND status='queued'", (r["id"],))
    # Cameras someone is watching: the appliance uploads live segments only for these.
    live = [str(r["id"]) for r in e.tx.all(
        """SELECT id FROM cameras WHERE store_id=%s AND (edge_id=%s OR edge_id IS NULL) AND readiness='ready'
           AND live_demand_at > now() - make_interval(secs => %s)""", (e.store_id, e.id, LIVE_DEMAND_S))]
    return {"items": [{"id": str(r["id"]), "kind": r["kind"], "payload": r["payload"], "created_at": iso(r["created_at"])}
                      for r in rows], "live": live}


@router.post("/edge/commands/{command_id}/ack")
def ack_command(command_id: uuid.UUID, e: EdgeCtx = Depends(edge_ctx)) -> dict:
    data = _json(e.body)
    status = data.get("status")
    if status not in ("succeeded", "failed"):
        raise invalid("status")
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    error = str(data.get("error") or "")[:500] or None
    cmd = e.tx.one("SELECT * FROM edge_commands WHERE id=%s AND edge_id=%s FOR UPDATE", (command_id, e.id))
    if not cmd:
        raise not_found()
    if cmd["status"] in ("succeeded", "failed", "expired"):
        return {"ok": True, "duplicate": True}
    e.tx.run("UPDATE edge_commands SET status=%s, result=%s, error=%s, completed_at=now() WHERE id=%s",
             (status, J(result), error, command_id))
    p = cmd["payload"]
    if cmd["kind"] == "discover":
        _apply_discovery(e, cmd, status, result, error)
    elif cmd["kind"] in ("provision_camera", "activate_camera", "pause_camera", "update_zones"):
        _apply_camera_result(e, cmd["kind"], p, status, result, error)
    audit(e.tx, e.org_id, f"edge.command_{status}", "edge_command", command_id, actor_kind="edge", actor_id=None,
          store_id=e.store_id, detail={"kind": cmd["kind"], "error": error})
    return {"ok": True}


# Linux V4L2 device path, or "dshow:" + a Windows DirectShow device (no quotes, ":" or control chars).
USB_DEVICE = re.compile(r'^(/dev/(v4l/by-(id|path)/[A-Za-z0-9._:+-]{1,200}|video\d{1,3})|dshow:[^":\x00-\x1f]{1,300})$')


def _apply_discovery(e: EdgeCtx, cmd: dict, status: str, result: dict, error: str | None) -> None:
    import ipaddress
    devices = []
    known = {r["address"] for r in e.tx.all("SELECT address FROM cameras WHERE store_id=%s", (e.store_id,))}
    for d in result.get("devices", [])[:512] if isinstance(result.get("devices"), list) else []:
        if not isinstance(d, dict) or not d.get("endpoint"):
            continue
        address = str(d.get("address") or d.get("source_ip") or "")[:100]
        try:
            ipaddress.ip_address(address)
        except ValueError:
            continue
        devices.append({"kind": "onvif", "endpoint": str(d["endpoint"])[:200], "address": address,
                        "xaddrs": [str(x)[:300] for x in d.get("xaddrs", [])][:8],
                        "scopes": [str(x)[:300] for x in d.get("scopes", [])][:32],
                        "vendor": (str(d["vendor"])[:100] if d.get("vendor") else None),
                        "model": (str(d["model"])[:100] if d.get("model") else None),
                        "already_added": address in known})
    # USB (V4L2) cameras attached to the appliance; the device path is the camera's address.
    for d in result.get("usb_devices", [])[:32] if isinstance(result.get("usb_devices"), list) else []:
        if not isinstance(d, dict) or not isinstance(d.get("device"), str) or not USB_DEVICE.match(d["device"]):
            continue
        devices.append({"kind": "usb", "endpoint": "usb:" + d["device"], "address": d["device"],
                        "xaddrs": [], "scopes": [], "vendor": None,
                        "model": (str(d["name"])[:100] if d.get("name") else None),
                        "already_added": d["device"] in known})
    e.tx.run("""UPDATE discovery_jobs SET status=%s, devices=%s, error=%s, completed_at=now() WHERE command_id=%s""",
             ("completed" if status == "succeeded" else "failed", J(devices), error, cmd["id"]))


def _apply_camera_result(e: EdgeCtx, kind: str, p: dict, status: str, result: dict, error: str | None) -> None:
    cam = e.tx.one("SELECT * FROM cameras WHERE id=%s AND store_id=%s FOR UPDATE", (p.get("camera_id"), e.store_id))
    if not cam:
        return
    if kind == "provision_camera":
        report = result.get("report") if isinstance(result.get("report"), dict) else {}
        report = {k: report.get(k) for k in ("checked_at", "codec", "width", "height", "fps", "decoded_seconds",
                                             "monotonic_time", "errors", "profile_token", "conformance")}
        if error:
            report["errors"] = list(report.get("errors") or []) + [error]
        readiness = result.get("readiness") if result.get("readiness") in READINESS else "offline"
        # Ready requires real decoded frames reported by the edge (>= 10 s sample).
        if readiness == "ready" and not (isinstance(report.get("decoded_seconds"), (int, float)) and report["decoded_seconds"] >= 10):
            readiness = "degraded"
        if status == "failed":
            readiness = "offline"
        e.tx.run("""UPDATE cameras SET readiness=%s, readiness_report=%s, vendor=COALESCE(%s, vendor),
                    model=COALESCE(%s, model), endpoint_uuid=COALESCE(%s, endpoint_uuid), version=version+1 WHERE id=%s""",
                 (readiness, J(report), result.get("vendor"), result.get("model"), result.get("endpoint"), cam["id"]))
    elif kind == "activate_camera":
        channels = _channels(result.get("channels"))
        running = any(v["state"] == "running" for v in channels.values())
        state = "analyzing" if status == "succeeded" and running else "unavailable"
        e.tx.run("""UPDATE cameras SET channels=%s, analysis_state=%s, activated_at=CASE WHEN %s THEN COALESCE(activated_at, now())
                    ELSE activated_at END, version=version+1 WHERE id=%s""", (J(channels), state, running, cam["id"]))
    elif kind == "pause_camera" and status == "succeeded":
        e.tx.run("UPDATE cameras SET analysis_state='paused', version=version+1 WHERE id=%s", (cam["id"],))
    elif kind == "update_zones" and status == "succeeded":
        v = result.get("zones_version")
        if isinstance(v, int) and v <= cam["zones_version"]:
            e.tx.run("UPDATE cameras SET zones_acked_version=GREATEST(zones_acked_version, %s) WHERE id=%s", (v, cam["id"]))


@lru_cache(maxsize=1)
def event_schema() -> dict:
    return json.loads(resources.files("retailguard_api").joinpath("contracts/event.schema.json").read_text())


def next_seq(tx: Tx, org_id: str) -> int:
    tx.run("INSERT INTO incident_counters (org_id) VALUES (%s) ON CONFLICT DO NOTHING", (org_id,))
    return tx.scalar("UPDATE incident_counters SET next_seq=next_seq+1 WHERE org_id=%s RETURNING next_seq-1", (org_id,))


def ack_deadline(tx: Tx, org_id: str, store_id) -> datetime:
    minutes = store_policy(tx, org_id, store_id, "escalation")["settings"]["ack_deadline_minutes"]
    return now() + timedelta(minutes=minutes)


@router.post("/edge/events")
def ingest_event(request: Request, e: EdgeCtx = Depends(edge_ctx)) -> dict:
    data = _json(e.body)
    try:
        jsonschema.validate(data, event_schema(), format_checker=jsonschema.FormatChecker())
    except jsonschema.ValidationError as exc:
        raise ApiError(422, "schema_invalid", "Event does not match the contract",
                       field_errors={".".join(str(p) for p in exc.absolute_path) or "event": exc.validator})
    if request.headers.get("idempotency-key") != data["event_id"]:
        raise ApiError(400, "idempotency_key_mismatch", "Idempotency-Key must equal event_id")
    if data["org_id"] != e.org_id or data["store_id"] != e.store_id:
        raise ApiError(403, "edge_scope_violation", "Event is outside this appliance's store binding")
    cam = e.tx.one("SELECT id FROM cameras WHERE id::text=%s AND store_id=%s", (data["camera_id"], e.store_id))
    if not cam:
        raise ApiError(404, "camera_not_found", "Camera not registered for this store")
    captured = _parse_ts(data["captured_at"])
    if captured is None or captured > now() + timedelta(minutes=5):
        raise invalid("captured_at", "invalid_or_future")
    existing = e.tx.one("SELECT id, version FROM incidents WHERE event_id=%s", (data["event_id"],))
    if existing:
        return {"incident_id": str(existing["id"]), "duplicate": True}
    seq = next_seq(e.tx, e.org_id)
    iid = uuid.uuid4()
    delayed = captured < now() - timedelta(minutes=5)
    e.tx.run("""INSERT INTO incidents (id, org_id, store_id, camera_id, seq, event_id, channel, signals, gate_reason,
                uncertainty, model_version, preprocessing_version, evidence_state, evidence_sha256, captured_at, delayed,
                ack_deadline, priority)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             (iid, e.org_id, e.store_id, cam["id"], seq, data["event_id"], data["channel"], J(data.get("signals", {})),
              data["gate_reason"], J(data.get("uncertainty", [])), data["model_version"], data["preprocessing_version"],
              data["evidence_state"], data.get("evidence_sha256"), captured, delayed,
              ack_deadline(e.tx, e.org_id, e.store_id), "normal"))
    audit(e.tx, e.org_id, "incident.ingested", "incident", iid, actor_kind="edge", actor_id=None, store_id=e.store_id,
          detail={"channel": data["channel"], "event_id": data["event_id"], "model_version": data["model_version"],
                  "delayed": delayed})
    outbox(e.tx, e.org_id, f"incident:{iid}", "incident.created", {"incident_id": str(iid), "store_id": e.store_id,
                                                                    "channel": data["channel"]})
    return {"incident_id": str(iid), "duplicate": False}


EVIDENCE_MAX = 64 * 1024 * 1024
SNAPSHOT_MAX = 4 * 1024 * 1024
LIVE_SEGMENT_MAX = 6 * 1024 * 1024
LIVE_DEMAND_S = 30      # a viewer keeps a camera live this long after their last request
LIVE_KEEP_SEGMENTS = 8


def evidence_retention_days(tx: Tx, org_id: str) -> int:
    from .. import policies
    row = tx.one("SELECT settings FROM org_settings WHERE org_id=%s AND kind='privacy'", (org_id,))
    return policies.validate(policies.Privacy, row["settings"] if row else {})["evidence_retention_days"]


@router.put("/edge/events/{event_id}/evidence")
def upload_evidence(event_id: str, request: Request, e: EdgeCtx = Depends(edge_ctx)) -> dict:
    data = e.body
    if not data or len(data) > EVIDENCE_MAX:
        raise ApiError(413, "evidence_size", "Evidence size out of bounds")
    declared = request.headers.get("x-content-sha256", "")
    digest = hashlib.sha256(data).hexdigest()
    if declared != digest:
        raise ApiError(422, "checksum_mismatch", "Evidence checksum mismatch")
    mime = media_store.sniff(data)
    if mime not in ("video/mp4", "image/jpeg"):
        raise ApiError(415, "unsupported_media", "Evidence must be MP4 video or JPEG")
    inc = e.tx.one("SELECT * FROM incidents WHERE event_id=%s AND store_id=%s FOR UPDATE", (event_id, e.store_id))
    if not inc:
        raise not_found()
    kind = "clip" if mime == "video/mp4" else "frame"
    if kind == "clip" and inc["evidence_sha256"] and inc["evidence_sha256"] != digest:
        raise ApiError(422, "checksum_mismatch", "Clip does not match the event's evidence checksum")
    existing = e.tx.one("""SELECT m.id FROM incident_evidence ie JOIN media m ON m.id=ie.media_id
                           WHERE ie.incident_id=%s AND m.sha256=%s""", (inc["id"], digest))
    if existing:
        return {"media_id": str(existing["id"]), "duplicate": True}
    expires = now() + timedelta(days=evidence_retention_days(e.tx, e.org_id))
    m = media_store.store(e.tx, e.org_id, data, mime, "evidence", store_id=e.store_id, expires_at=expires)
    e.tx.run("INSERT INTO incident_evidence (org_id, incident_id, media_id, kind) VALUES (%s,%s,%s,%s)",
             (e.org_id, inc["id"], m["id"], kind))
    e.tx.run("UPDATE incidents SET evidence_state='available', version=version+1 WHERE id=%s", (inc["id"],))
    audit(e.tx, e.org_id, "incident.evidence_attached", "incident", inc["id"], actor_kind="edge", actor_id=None,
          store_id=e.store_id, detail={"media_id": str(m["id"]), "sha256": digest, "kind": kind})
    return {"media_id": str(m["id"]), "duplicate": False}


@router.put("/edge/cameras/{camera_id}/snapshot")
def upload_snapshot(camera_id: uuid.UUID, e: EdgeCtx = Depends(edge_ctx)) -> dict:
    data = e.body
    if not data or len(data) > SNAPSHOT_MAX or media_store.sniff(data) != "image/jpeg":
        raise ApiError(415, "unsupported_media", "Snapshot must be a JPEG up to 4 MB")
    cam = e.tx.one("SELECT * FROM cameras WHERE id=%s AND store_id=%s FOR UPDATE", (camera_id, e.store_id))
    if not cam:
        raise not_found()
    m = media_store.store(e.tx, e.org_id, data, "image/jpeg", "snapshot", store_id=e.store_id,
                          expires_at=now() + timedelta(hours=24))
    old = cam["snapshot_media_id"]
    e.tx.run("UPDATE cameras SET snapshot_media_id=%s, snapshot_at=now() WHERE id=%s", (m["id"], camera_id))
    if old:
        media_store.delete(e.tx, old)
    return {"media_id": str(m["id"])}


# ---- live relay (on demand) ----------------------------------------------------------------

def live_dir(camera_id) -> "Path":
    from pathlib import Path
    return Path(get_settings().media_dir) / "live" / str(camera_id)


@router.put("/edge/cameras/{camera_id}/live/{seq}")
def upload_live_segment(camera_id: uuid.UUID, seq: int, request: Request, e: EdgeCtx = Depends(edge_ctx)) -> dict:
    """One MPEG-TS segment of a camera's live view. Kept only briefly (the newest few) and served
    to signed-in viewers of that store; never part of evidence."""
    data = e.body
    if not data or len(data) > LIVE_SEGMENT_MAX or data[0] != 0x47:
        raise ApiError(415, "unsupported_media", "Live segments must be MPEG-TS up to 6 MB")
    try:
        duration = float(request.headers.get("x-segment-duration", ""))
        if not 0.1 <= duration <= 15:
            raise ValueError
    except ValueError:
        raise invalid("x-segment-duration")
    if seq < 0:
        raise invalid("seq")
    cam = e.tx.one("SELECT * FROM cameras WHERE id=%s AND store_id=%s FOR UPDATE", (camera_id, e.store_id))
    if not cam:
        raise not_found()
    if cam["edge_id"] and str(cam["edge_id"]) != e.id:
        raise ApiError(409, "wrong_edge", "This camera is served by another appliance")
    if seq <= cam["live_edge_seq"]:
        return {"ok": True, "duplicate": True}
    # A gap (appliance restarted, viewer came back) starts a new run of segments for the player.
    stale = not cam["live_segment_at"] or cam["live_segment_at"] < now() - timedelta(seconds=10)
    discontinuity = request.headers.get("x-segment-discontinuity") == "1" or stale
    index = cam["live_seq"] + 1
    d = live_dir(camera_id)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".{index}.tmp"
    tmp.write_bytes(data)
    tmp.replace(d / f"{index}.ts")
    (d / f"{index}.meta").write_text(json.dumps({"duration": round(duration, 3), "discontinuity": discontinuity}))
    for old in sorted(d.glob("*.ts"), key=lambda p: int(p.stem))[:-LIVE_KEEP_SEGMENTS]:
        old.unlink(missing_ok=True)
        old.with_suffix(".meta").unlink(missing_ok=True)
    e.tx.run("UPDATE cameras SET live_seq=%s, live_edge_seq=%s, live_segment_at=now() WHERE id=%s",
             (index, seq, camera_id))
    return {"ok": True, "index": index}
