"""Dashboard, reports, checkout/integrations, model registry, audit, health, notifications,
push devices, support bundles and authorized media access."""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import math
import statistics
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import media as media_store
from ..authz import audit, check_version, clean, decode_cursor, encode_cursor, iso, now, page_limit
from ..db import J, transaction
from ..deps import Ctx, ctx
from ..errors import ApiError, conflict, forbidden, invalid, not_found
from ..security import decrypt_secret, encrypt_secret, new_token, token_hash
from ..settings import get_settings
from .incidents import SUMMARY_SQL, summary

router = APIRouter(prefix="/v1", tags=["operations"])


def _window(args_from: str | None, args_to: str | None, default_days: int = 30) -> tuple[datetime, datetime]:
    def parse(v):
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    try:
        end = parse(args_to) if args_to else now()
        start = parse(args_from) if args_from else end - timedelta(days=default_days)
    except ValueError:
        raise invalid("from", "invalid_datetime")
    if start >= end or end - start > timedelta(days=366):
        raise invalid("from", "invalid_range")
    return start, end


def wilson(k: int, n: int, z: float = 1.96) -> list[float] | None:
    if n == 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


@router.get("/dashboard")
def dashboard(store_id: uuid.UUID | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("dashboard.read")
    stores = c.actor.scoped_stores(str(store_id) if store_id else None)
    tz = "UTC"
    if store_id:
        tz = c.tx.scalar("SELECT timezone FROM stores WHERE id=%s", (store_id,)) or "UTC"
    today_start = c.tx.scalar("SELECT date_trunc('day', now() AT TIME ZONE %s) AT TIME ZONE %s", (tz, tz))
    open_alerts = c.tx.scalar("SELECT count(*) FROM incidents WHERE store_id = ANY(%s::uuid[]) AND status<>'resolved'", (stores,))
    reviewed = c.tx.scalar("""SELECT count(*) FROM incidents WHERE store_id = ANY(%s::uuid[]) AND status='resolved'
                              AND resolved_at >= %s""", (stores, today_start))
    cams = c.tx.one("""SELECT count(*) FILTER (WHERE readiness<>'disabled') AS total,
                              count(*) FILTER (WHERE readiness='ready') AS online,
                              count(*) FILTER (WHERE analysis_state='analyzing') AS analyzing
                       FROM cameras WHERE store_id = ANY(%s::uuid[])""", (stores,))
    acks = [r["s"] for r in c.tx.all("""SELECT extract(epoch FROM acknowledged_at - ingested_at) AS s FROM incidents
                                         WHERE store_id = ANY(%s::uuid[]) AND acknowledged_at >= %s""", (stores, today_start))]
    awaiting = c.tx.all(SUMMARY_SQL + " WHERE i.store_id = ANY(%s::uuid[]) AND i.status IN ('new','reviewing') "
                        "ORDER BY i.priority='urgent' DESC, i.priority='high' DESC, i.captured_at DESC LIMIT 8", (stores,))
    health = c.tx.all("""SELECT id, name, location, readiness, analysis_state, last_frame_at, snapshot_media_id, snapshot_at
                         FROM cameras WHERE store_id = ANY(%s::uuid[]) ORDER BY name LIMIT 12""", (stores,))
    trend = c.tx.all("""SELECT d::date AS date,
                          (SELECT count(*) FROM incidents i WHERE i.store_id = ANY(%s::uuid[])
                             AND (i.captured_at AT TIME ZONE %s)::date = d::date) AS detections,
                          (SELECT count(*) FROM incidents i WHERE i.store_id = ANY(%s::uuid[]) AND i.status='resolved'
                             AND (i.resolved_at AT TIME ZONE %s)::date = d::date) AS reviewed
                        FROM generate_series((now() AT TIME ZONE %s)::date - 6, (now() AT TIME ZONE %s)::date, interval '1 day') d""",
                     (stores, tz, stores, tz, tz, tz))
    preview = next((h for h in health if h["snapshot_media_id"]), None)
    return {
        "open_alerts": open_alerts, "reviewed_today": reviewed,
        "cameras": {"online": cams["online"], "total": cams["total"], "analyzing": cams["analyzing"]},
        "median_ack_seconds": round(statistics.median(acks)) if acks else None,
        "acknowledged_today": len(acks),
        "awaiting_review": [summary(r) for r in awaiting],
        "camera_health": [{"id": str(h["id"]), "name": h["name"], "location": h["location"], "readiness": h["readiness"],
                           "analysis_state": h["analysis_state"], "last_frame_at": iso(h["last_frame_at"])} for h in health],
        "preview": {"camera_id": str(preview["id"]), "camera_name": preview["name"], "media_id": str(preview["snapshot_media_id"]),
                    "captured_at": iso(preview["snapshot_at"])} if preview else None,
        "trend": [{"date": r["date"].isoformat(), "detections": r["detections"], "reviewed": r["reviewed"]} for r in trend],
        "timezone": tz, "last_refresh": iso(now()),
    }


@router.get("/reports/summary")
def report_summary(request: Request, store_id: uuid.UUID | None = None, to: str | None = None,
                   c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("report.read")
    stores = c.actor.scoped_stores(str(store_id) if store_id else None)
    start, end = _window(request.query_params.get("from"), to)
    by_channel = {r["channel"]: r["n"] for r in c.tx.all(
        """SELECT channel, count(*) AS n FROM incidents WHERE store_id = ANY(%s::uuid[]) AND captured_at >= %s AND captured_at < %s
           GROUP BY channel""", (stores, start, end))}
    o = c.tx.one("""SELECT count(*) FILTER (WHERE outcome IS NOT NULL) AS reviewed,
                           count(*) FILTER (WHERE outcome='confirmed') AS confirmed,
                           count(*) FILTER (WHERE outcome='false_alert') AS false_alert,
                           count(*) FILTER (WHERE outcome='inconclusive') AS inconclusive,
                           count(*) FILTER (WHERE outcome='false_alert' AND channel<>'manual_observation') AS auto_false,
                           count(*) FILTER (WHERE outcome='confirmed' AND channel<>'manual_observation') AS auto_confirmed,
                           COALESCE(sum(loss_value) FILTER (WHERE outcome='confirmed'), 0) AS loss,
                           COALESCE(sum(recovered_value) FILTER (WHERE outcome='confirmed'), 0) AS recovered,
                           count(*) FILTER (WHERE outcome='confirmed' AND loss_value IS NOT NULL) AS loss_n
                    FROM incidents WHERE store_id = ANY(%s::uuid[]) AND captured_at >= %s AND captured_at < %s""",
                 (stores, start, end))
    n_prec = o["auto_confirmed"] + o["auto_false"]
    hours_s = c.tx.scalar("""SELECT COALESCE(sum(t.seconds), 0) FROM camera_analysis_time t JOIN cameras cm ON cm.id=t.camera_id
                             WHERE cm.store_id = ANY(%s::uuid[]) AND t.day >= %s::date AND t.day <= %s::date""",
                          (stores, start, end))
    camera_hours = round(hours_s / 3600, 2)
    acks = [r["s"] for r in c.tx.all("""SELECT extract(epoch FROM acknowledged_at - ingested_at) AS s FROM incidents
                                         WHERE store_id = ANY(%s::uuid[]) AND acknowledged_at >= %s AND acknowledged_at < %s""",
                                      (stores, start, end))]
    daily = c.tx.all("""SELECT (captured_at AT TIME ZONE 'UTC')::date AS day, count(*) AS detections,
                               count(*) FILTER (WHERE outcome='confirmed') AS confirmed,
                               count(*) FILTER (WHERE outcome='false_alert') AS false_alert,
                               count(*) FILTER (WHERE outcome='inconclusive') AS inconclusive
                        FROM incidents WHERE store_id = ANY(%s::uuid[]) AND captured_at >= %s AND captured_at < %s
                        GROUP BY 1 ORDER BY 1""", (stores, start, end))
    general = c.tx.one("SELECT settings FROM org_settings WHERE kind='general'")
    return {
        "from": iso(start), "to": iso(end), "detections": {"by_channel": by_channel, "total": sum(by_channel.values())},
        "reviewed": o["reviewed"], "confirmed": o["confirmed"], "false_alert": o["false_alert"],
        "inconclusive": o["inconclusive"],
        "reviewed_precision": {
            "value": round(o["auto_confirmed"] / n_prec, 4) if n_prec else None, "n": n_prec,
            "ci95": wilson(o["auto_confirmed"], n_prec),
            "definition": "confirmed / (confirmed + false_alert) for automated alerts with a human outcome; inconclusive excluded"},
        "false_alerts_per_camera_hour": {
            "value": round(o["auto_false"] / camera_hours, 4) if camera_hours > 0 else None,
            "false_alerts": o["auto_false"], "camera_hours": camera_hours,
            "definition": "human-reviewed false alerts / analyzed camera-hours reported by edge heartbeats"},
        "median_ack_seconds": round(statistics.median(acks)) if acks else None, "ack_n": len(acks),
        "confirmed_loss": float(o["loss"]), "recovered_value": float(o["recovered"]), "loss_n": o["loss_n"],
        "currency": ((general or {}).get("settings") or {}).get("currency", "JPY"),
        "daily": [{"date": d["day"].isoformat(), "detections": d["detections"], "confirmed": d["confirmed"],
                   "false_alert": d["false_alert"], "inconclusive": d["inconclusive"]} for d in daily],
    }


@router.get("/checkout/exceptions")
def checkout_exceptions(store_id: uuid.UUID | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("incident.read")
    stores = c.actor.scoped_stores(str(store_id) if store_id else None)
    rows = c.tx.all(SUMMARY_SQL + " WHERE i.store_id = ANY(%s::uuid[]) AND i.channel='checkout_exception' "
                    "ORDER BY i.captured_at DESC LIMIT 200", (stores,))
    pos = c.tx.all("""SELECT store_id, count(*) AS integrations, max(last_event_at) AS last_event_at FROM integrations
                      WHERE kind='pos' AND store_id = ANY(%s::uuid[]) GROUP BY store_id""", (stores,))
    status = {str(p["store_id"]): {"configured": True, "last_event_at": iso(p["last_event_at"]),
                                   "fresh": bool(p["last_event_at"] and p["last_event_at"] > now() - timedelta(minutes=10))}
              for p in pos}
    return {"items": [dict(summary(r), signals=r["signals"]) for r in rows], "next_cursor": None,
            "pos_status": {s: status.get(s, {"configured": False, "last_event_at": None, "fresh": False}) for s in stores}}


# ---- integrations ---------------------------------------------------------------------------

class IntegrationIn(BaseModel):
    store_id: uuid.UUID
    kind: str
    name: str = Field(min_length=1, max_length=120)
    config: dict = Field(default_factory=dict)


class IntegrationPatch(BaseModel):
    expected_version: int
    name: str | None = Field(default=None, min_length=1, max_length=120)
    config: dict | None = None


def _int_config(cfg: dict) -> dict:
    out = {}
    lane_map = cfg.get("lane_map", {})
    if not isinstance(lane_map, dict) or len(lane_map) > 100:
        raise invalid("config.lane_map")
    for lane, cam in lane_map.items():
        try:
            uuid.UUID(str(cam))
        except ValueError:
            raise invalid("config.lane_map", "camera_id_required")
    out["lane_map"] = {str(k)[:40]: str(v) for k, v in lane_map.items()}
    off = cfg.get("clock_offset_ms")
    if off is not None and not (isinstance(off, int) and abs(off) <= 600_000):
        raise invalid("config.clock_offset_ms")
    out["clock_offset_ms"] = off
    vendor = cfg.get("vendor")
    out["vendor"] = str(vendor)[:80] if vendor else None
    return out


def integration_out(r: dict) -> dict:
    out = clean(r)
    out.pop("secret_enc", None)
    out.pop("org_id", None)
    last = r["last_event_at"]
    out["status"] = "configured" if not last else ("receiving" if last > now() - timedelta(minutes=10) else "stale")
    out["webhook_url"] = f"{get_settings().web_origin}/v1/integrations/{r['id']}/webhook"
    return out


@router.get("/integrations")
def list_integrations(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("store.read")
    rows = c.tx.all("SELECT * FROM integrations WHERE store_id = ANY(%s::uuid[]) ORDER BY created_at", (c.actor.store_ids,))
    return {"items": [integration_out(r) for r in rows], "next_cursor": None}


@router.post("/integrations", status_code=201)
def create_integration(body: IntegrationIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("integration.manage", str(body.store_id))
    if body.kind not in ("pos", "rfid", "vms"):
        raise invalid("kind")
    cfg = _int_config(body.config)
    for cam in cfg["lane_map"].values():
        if not c.tx.one("SELECT 1 FROM cameras WHERE id=%s AND store_id=%s", (cam, body.store_id)):
            raise invalid("config.lane_map", "camera_not_in_store")
    secret = new_token(32)
    iid = uuid.uuid4()
    c.tx.run("""INSERT INTO integrations (id, org_id, store_id, kind, name, config, secret_enc) VALUES (%s,%s,%s,%s,%s,%s,%s)""",
             (iid, c.actor.org_id, body.store_id, body.kind, body.name.strip(), J(cfg), encrypt_secret(secret, f"webhook:{iid}")))
    audit(c.tx, c.actor.org_id, "integration.created", "integration", iid, actor=c.actor, store_id=body.store_id,
          detail={"kind": body.kind, "name": body.name})
    out = integration_out(c.tx.one("SELECT * FROM integrations WHERE id=%s", (iid,)))
    out["webhook_secret"] = secret
    return out


def _integration(c: Ctx, iid, lock=False) -> dict:
    r = c.tx.one("SELECT * FROM integrations WHERE id=%s" + (" FOR UPDATE" if lock else ""), (iid,))
    if not r:
        raise not_found()
    c.actor.require("integration.manage", str(r["store_id"]))
    return r


@router.patch("/integrations/{iid}")
def patch_integration(iid: uuid.UUID, body: IntegrationPatch, c: Ctx = Depends(ctx)) -> dict:
    r = _integration(c, iid, lock=True)
    check_version(r, body.expected_version)
    name = body.name.strip() if body.name else r["name"]
    cfg = _int_config(body.config) if body.config is not None else r["config"]
    c.tx.run("UPDATE integrations SET name=%s, config=%s, version=version+1 WHERE id=%s", (name, J(cfg), iid))
    audit(c.tx, c.actor.org_id, "integration.updated", "integration", iid, actor=c.actor, store_id=r["store_id"])
    return integration_out(c.tx.one("SELECT * FROM integrations WHERE id=%s", (iid,)))


@router.post("/integrations/{iid}/rotate-secret")
def rotate_secret(iid: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    r = _integration(c, iid, lock=True)
    secret = new_token(32)
    c.tx.run("UPDATE integrations SET secret_enc=%s, version=version+1 WHERE id=%s", (encrypt_secret(secret, f"webhook:{iid}"), iid))
    audit(c.tx, c.actor.org_id, "integration.secret_rotated", "integration", iid, actor=c.actor, store_id=r["store_id"])
    return {"webhook_secret": secret}


@router.post("/integrations/{iid}/test")
def test_integration(iid: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    r = _integration(c, iid)
    recent = c.tx.scalar("SELECT count(*) FROM pos_events WHERE integration_id=%s AND received_at > now() - interval '10 minutes'", (iid,))
    return {"ok": r["last_event_at"] is not None and recent > 0, "last_event_at": iso(r["last_event_at"]),
            "events_last_10_min": recent,
            "message": "Receiving signed events" if recent else
                       "No signed events received in the last 10 minutes. Send a heartbeat event from the connector."}


@router.post("/integrations/{iid}/webhook")
async def integration_webhook(iid: uuid.UUID, request: Request) -> dict:
    body = await request.body()
    if len(body) > 1_000_000:
        raise ApiError(413, "payload_too_large", "Payload too large")
    ts, nonce, sig = (request.headers.get("x-rg-timestamp", ""), request.headers.get("x-rg-nonce", ""),
                      request.headers.get("x-rg-signature", ""))
    try:
        if abs(time.time() - int(ts)) > 300:
            raise ValueError
    except ValueError:
        raise ApiError(401, "webhook_timestamp_invalid", "Timestamp missing or outside the accepted window")
    if not 16 <= len(nonce) <= 128:
        raise ApiError(401, "webhook_signature_invalid", "Invalid nonce")
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(_webhook_sync, iid, body, ts, nonce, sig)


def _webhook_sync(iid, body: bytes, ts: str, nonce: str, sig: str) -> dict:
    with transaction() as tx:
        found = tx.one("SELECT * FROM rg_integration_lookup(%s)", (iid,))
        if not found:
            raise ApiError(401, "webhook_signature_invalid", "Signature verification failed")
        tx.set_context(found["org_id"])
        r = tx.one("SELECT * FROM integrations WHERE id=%s", (iid,))
        secret = decrypt_secret(r["secret_enc"], f"webhook:{iid}")
        expected = hmac.new(secret.encode(), f"{ts}.{nonce}.".encode() + body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise ApiError(401, "webhook_signature_invalid", "Signature verification failed")
        if not tx.run("INSERT INTO integration_nonces (integration_id, nonce) VALUES (%s,%s) ON CONFLICT DO NOTHING", (iid, nonce)):
            raise ApiError(409, "webhook_replay", "Replayed request rejected")
        try:
            data = json.loads(body)
            events = data["events"]
            assert isinstance(events, list) and 0 < len(events) <= 500
        except (ValueError, KeyError, AssertionError, TypeError):
            raise ApiError(422, "schema_invalid", "Expected {events: [...]} with 1-500 events")
        accepted = 0
        for ev in events:
            if not isinstance(ev, dict) or ev.get("kind") not in ("scan", "void", "refund", "suspend", "payment", "heartbeat"):
                raise ApiError(422, "schema_invalid", "Unknown event kind")
            try:
                at = datetime.fromisoformat(str(ev["occurred_at"]).replace("Z", "+00:00"))
                at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
            except (KeyError, ValueError):
                raise ApiError(422, "schema_invalid", "occurred_at must be RFC 3339")
            tx.run("""INSERT INTO pos_events (id, org_id, store_id, integration_id, kind, lane, transaction_id, barcode, item_count,
                      amount, occurred_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                   (uuid.uuid4(), r["org_id"], r["store_id"], iid, ev["kind"], str(ev.get("lane") or "")[:40] or None,
                    str(ev.get("transaction_id") or "")[:80] or None, str(ev.get("barcode") or "")[:64] or None,
                    ev.get("item_count") if isinstance(ev.get("item_count"), int) else None,
                    ev.get("amount") if isinstance(ev.get("amount"), (int, float)) else None, at))
            accepted += 1
        tx.run("UPDATE integrations SET last_event_at=now() WHERE id=%s", (iid,))
        return {"accepted": accepted}


# ---- model registry -------------------------------------------------------------------------

MANIFEST_REQUIRED = ("algorithm", "source_commit", "code_license", "weights_license", "data_license", "sha256",
                     "preprocessing_version", "input_shape", "output_shape", "keypoint_order", "sampling_rate_fps",
                     "window", "stride", "normalization", "precision", "runtime", "validation_report")


class ModelIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=60)
    channel: str
    manifest: dict


class ModelAction(BaseModel):
    expected_version: int
    status: str | None = None
    note: str | None = Field(default=None, max_length=2000)
    stage: str | None = None
    camera_id: uuid.UUID | None = None
    reason: str | None = Field(default=None, max_length=2000)


def model_out(r: dict) -> dict:
    out = clean(r)
    out.pop("org_id", None)
    out["version_row"] = out.pop("version")
    out["version"] = out.pop("model_version")
    return out


@router.get("/models")
def list_models(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("health.read")
    return {"items": [model_out(r) for r in c.tx.all("SELECT * FROM models ORDER BY created_at DESC")], "next_cursor": None}


@router.post("/models", status_code=201)
def register_model(body: ModelIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("model.manage")
    if body.channel not in ("behavior", "watchlist", "checkout", "person", "pose", "tracker"):
        raise invalid("channel")
    missing = [k for k in MANIFEST_REQUIRED if k not in body.manifest or body.manifest[k] in (None, "")]
    if missing:
        raise ApiError(422, "manifest_incomplete", "The manifest must come from the actual exported model",
                       field_errors={f"manifest.{k}": "required" for k in missing})
    sha = str(body.manifest["sha256"]).lower()
    if len(sha) != 64 or any(ch not in "0123456789abcdef" for ch in sha):
        raise invalid("manifest.sha256", "sha256_hex_required")
    if len(json.dumps(body.manifest)) > 100_000:
        raise invalid("manifest", "too_large")
    if c.tx.one("SELECT 1 FROM models WHERE name=%s AND model_version=%s", (body.name, body.version)):
        raise ApiError(409, "duplicate_model", "This model version is already registered")
    mid = uuid.uuid4()
    c.tx.run("""INSERT INTO models (id, org_id, name, model_version, channel, manifest, sha256, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
             (mid, c.actor.org_id, body.name, body.version, body.channel, J(body.manifest), sha, c.actor.user_id))
    audit(c.tx, c.actor.org_id, "model.registered", "model", mid, actor=c.actor,
          detail={"name": body.name, "version": body.version, "sha256": sha})
    return model_out(c.tx.one("SELECT * FROM models WHERE id=%s", (mid,)))


@router.post("/models/{model_id}/{action}")
def model_action(model_id: uuid.UUID, action: str, body: ModelAction, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("model.manage")
    if action not in ("license", "validate", "rollout", "rollback", "retire"):
        raise not_found()
    r = c.tx.one("SELECT * FROM models WHERE id=%s FOR UPDATE", (model_id,))
    check_version(r, body.expected_version)
    detail: dict = {}
    if action == "license":
        if body.status not in ("unverified", "cleared", "restricted", "rejected") or not body.note:
            raise invalid("status" if not body.note else "note", "required")
        c.tx.run("UPDATE models SET license_status=%s, license_note=%s WHERE id=%s", (body.status, body.note, model_id))
        detail = {"license_status": body.status, "note": body.note}
    elif action == "validate":
        if body.status not in ("not_validated", "passed", "failed") or not body.note:
            raise invalid("status" if not body.note else "note", "required")
        c.tx.run("UPDATE models SET validation_status=%s, validation_note=%s WHERE id=%s", (body.status, body.note, model_id))
        detail = {"validation_status": body.status, "note": body.note}
    elif action == "rollout":
        order = {"registered": 0, "shadow": 1, "canary": 2, "active": 3}
        if body.stage not in ("shadow", "canary", "active"):
            raise invalid("stage")
        if r["license_status"] != "cleared":
            raise conflict("license_not_cleared", r["version"], "Commercial rights must be cleared before rollout")
        if body.stage in ("canary", "active") and r["validation_status"] != "passed":
            raise conflict("validation_not_passed", r["version"], "A passed held-out validation is required before canary")
        if order.get(r["rollout_state"], -1) + 1 != order[body.stage]:
            raise conflict("invalid_transition", r["version"], "Roll out in order: shadow → canary → active")
        cam = None
        if body.stage == "canary":
            if not body.camera_id:
                raise invalid("camera_id", "required_for_canary")
            cam = c.tx.one("SELECT * FROM cameras WHERE id=%s", (body.camera_id,))
            if not cam:
                raise invalid("camera_id", "not_found")
            c.actor.require_store(str(cam["store_id"]))
        c.tx.run("UPDATE models SET rollout_state=%s, canary_camera_id=COALESCE(%s, canary_camera_id) WHERE id=%s",
                 (body.stage, body.camera_id, model_id))
        from .edge import queue_command
        targets = c.tx.all("SELECT id, store_id FROM edges WHERE revoked_at IS NULL" +
                           (" AND store_id=%s" if cam else ""), (cam["store_id"],) if cam else None)
        for e in targets:
            queue_command(c.tx, c.actor.org_id, e["store_id"], e["id"], "model_rollout",
                          {"model_id": str(model_id), "name": r["name"], "version": r["model_version"], "sha256": r["sha256"],
                           "stage": body.stage, "camera_id": str(body.camera_id) if body.camera_id else None,
                           "manifest": r["manifest"]}, c.actor.user_id)
        detail = {"stage": body.stage, "edges_notified": len(targets)}
    elif action in ("rollback", "retire"):
        if not body.reason:
            raise invalid("reason", "required")
        state = "rolled_back" if action == "rollback" else "retired"
        c.tx.run("UPDATE models SET rollout_state=%s WHERE id=%s", (state, model_id))
        from .edge import queue_command
        for e in c.tx.all("SELECT id, store_id FROM edges WHERE revoked_at IS NULL"):
            queue_command(c.tx, c.actor.org_id, e["store_id"], e["id"], "model_rollout",
                          {"model_id": str(model_id), "name": r["name"], "version": r["model_version"], "stage": state},
                          c.actor.user_id)
        detail = {"state": state, "reason": body.reason}
    c.tx.run("UPDATE models SET version=version+1 WHERE id=%s", (model_id,))
    audit(c.tx, c.actor.org_id, f"model.{action}", "model", model_id, actor=c.actor, detail=detail)
    return model_out(c.tx.one("SELECT * FROM models WHERE id=%s", (model_id,)))


# ---- audit ----------------------------------------------------------------------------------

@router.get("/audit")
def audit_log(request: Request, cursor: str | None = None, limit: int | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("audit.read")
    a = dict(request.query_params)
    lim = page_limit(limit)
    sql = """SELECT a.*, u.display_name AS actor_name FROM audit a LEFT JOIN app_users u ON u.id=a.actor_id WHERE TRUE"""
    args: list = []
    if not c.actor.all_stores:
        sql += " AND a.store_id = ANY(%s::uuid[])"; args.append(c.actor.store_ids)
    if a.get("store_id"):
        c.actor.require_store(a["store_id"])
        sql += " AND a.store_id::text=%s"; args.append(a["store_id"])
    if a.get("actor_id"):
        sql += " AND a.actor_id::text=%s"; args.append(a["actor_id"])
    if a.get("action"):
        sql += " AND a.action ILIKE %s"; args.append(a["action"][:80] + "%")
    if a.get("result"):
        sql += " AND a.result=%s"; args.append(a["result"])
    if a.get("resource_type"):
        sql += " AND a.resource_type=%s"; args.append(a["resource_type"])
    for key, op in (("from", ">="), ("to", "<")):
        if a.get(key):
            try:
                args.append(datetime.fromisoformat(a[key].replace("Z", "+00:00")))
            except ValueError:
                raise invalid(key)
            sql += f" AND a.created_at {op} %s"
    cur = decode_cursor(cursor, 1)
    if cur:
        sql += " AND a.seq < %s"; args.append(int(cur[0]))
    rows = c.tx.all(sql + " ORDER BY a.seq DESC LIMIT %s", args + [lim + 1])
    items = [{"id": str(r["id"]), "at": iso(r["created_at"]), "actor_kind": r["actor_kind"],
              "actor": {"id": str(r["actor_id"]), "display_name": r["actor_name"]} if r["actor_id"] else None,
              "action": r["action"], "resource_type": r["resource_type"], "resource_id": r["resource_id"],
              "store_id": str(r["store_id"]) if r["store_id"] else None, "result": r["result"],
              "request_id": r["request_id"], "detail": r["detail"], "hash": r["hash"]} for r in rows[:lim]]
    return {"items": items, "next_cursor": encode_cursor(rows[lim - 1]["seq"]) if len(rows) > lim else None}


@router.get("/audit/verify")
def audit_verify(c: Ctx = Depends(ctx)) -> dict:
    """Recompute the organization's audit hash chain."""
    c.actor.require("org.manage")
    prev, checked = None, 0
    for r in c.tx.all("SELECT * FROM audit ORDER BY seq"):
        record = {"org_id": str(r["org_id"]), "actor": str(r["actor_id"]) if r["actor_id"] else None,
                  "actor_kind": r["actor_kind"], "action": r["action"], "resource_type": r["resource_type"],
                  "resource_id": r["resource_id"], "store_id": str(r["store_id"]) if r["store_id"] else None,
                  "result": r["result"], "detail": r["detail"], "request_id": r["request_id"], "at": iso(r["created_at"])}
        digest = hashlib.sha256(((prev or "") + json.dumps(record, sort_keys=True, default=str)).encode()).hexdigest()
        if r["prev_hash"] != prev or r["hash"] != digest:
            return {"valid": False, "checked": checked, "broken_at": str(r["id"])}
        prev, checked = r["hash"], checked + 1
    return {"valid": True, "checked": checked, "head": prev}


# ---- health ---------------------------------------------------------------------------------

@router.get("/health/system")
def system_health(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("health.read")
    from .edge import edge_out
    s = get_settings()
    edges = [edge_out(e) for e in c.tx.all("SELECT * FROM edges WHERE store_id = ANY(%s::uuid[]) ORDER BY name", (c.actor.store_ids,))]
    cams = c.tx.one("""SELECT count(*) AS total, count(*) FILTER (WHERE readiness='ready') AS ready,
                              count(*) FILTER (WHERE readiness IN ('degraded','offline')) AS impaired,
                              count(*) FILTER (WHERE readiness='pending') AS pending,
                              count(*) FILTER (WHERE analysis_state='analyzing') AS analyzing
                       FROM cameras WHERE store_id = ANY(%s::uuid[])""", (c.actor.store_ids,))
    ob = c.tx.one("""SELECT count(*) FILTER (WHERE delivered_at IS NULL AND dead_at IS NULL) AS pending,
                            extract(epoch FROM now() - min(created_at) FILTER (WHERE delivered_at IS NULL AND dead_at IS NULL)) AS oldest,
                            count(*) FILTER (WHERE dead_at IS NOT NULL) AS dead FROM outbox""")
    worker = c.tx.one("SELECT seen_at, detail FROM worker_heartbeat WHERE name='worker'") if c.actor.can("health.read") else None
    pending_evidence = c.tx.scalar("SELECT count(*) FROM incidents WHERE evidence_state='pending' AND store_id = ANY(%s::uuid[])",
                                   (c.actor.store_ids,))
    behavior_models = c.tx.scalar("SELECT count(*) FROM models WHERE channel='behavior' AND rollout_state='active'")
    return {
        "edges": edges, "cameras": cams,
        "outbox": {"pending": ob["pending"], "oldest_pending_age_s": round(ob["oldest"]) if ob["oldest"] else None,
                   "dead_letter": ob["dead"]},
        "worker": {"last_seen_at": iso(worker["seen_at"]) if worker else None,
                   "state": "online" if worker and worker["seen_at"] > now() - timedelta(seconds=90) else "offline"},
        "pending_evidence": pending_evidence,
        "dependencies": {
            "face_sdk": "available" if s.face_sdk_configured else "unconfigured",
            "behavior_model": "available" if behavior_models else "unavailable",
            "apns": "available" if s.apns_configured else "unconfigured",
            "oidc": "available" if s.oidc_enabled else "unconfigured",
            "smtp": "unconfigured",
        },
        "checked_at": iso(now()),
    }


# ---- notifications / push -------------------------------------------------------------------

class ReadIn(BaseModel):
    ids: list[uuid.UUID] | None = None


@router.get("/notifications")
def notifications(c: Ctx = Depends(ctx)) -> dict:
    rows = c.tx.all("""SELECT n.id, n.kind, n.incident_id, n.created_at, n.read_at FROM notifications n
                       WHERE n.user_id=%s ORDER BY n.created_at DESC LIMIT 100""", (c.actor.user_id,))
    return {"items": [clean(r) for r in rows], "next_cursor": None}


@router.post("/notifications/read")
def mark_read(body: ReadIn, c: Ctx = Depends(ctx)) -> dict:
    if body.ids:
        n = c.tx.run("UPDATE notifications SET read_at=now() WHERE user_id=%s AND id = ANY(%s::uuid[]) AND read_at IS NULL",
                     (c.actor.user_id, [str(i) for i in body.ids]))
    else:
        n = c.tx.run("UPDATE notifications SET read_at=now() WHERE user_id=%s AND read_at IS NULL", (c.actor.user_id,))
    return {"updated": n}


class PushIn(BaseModel):
    token: str = Field(min_length=16, max_length=200)
    environment: str
    bundle_id: str = Field(min_length=3, max_length=200)


@router.post("/push/devices", status_code=201)
def register_push(body: PushIn, c: Ctx = Depends(ctx)) -> dict:
    if body.environment not in ("sandbox", "production"):
        raise invalid("environment")
    if not all(ch in "0123456789abcdefABCDEF" for ch in body.token):
        raise invalid("token", "hex_required")
    th = token_hash(body.token.lower())
    existing = c.tx.one("SELECT id FROM push_devices WHERE token_hash=%s", (th,))
    if existing:
        c.tx.run("""UPDATE push_devices SET user_id=%s, session_id=%s, environment=%s, bundle_id=%s, revoked_at=NULL
                    WHERE id=%s""", (c.actor.user_id, c.actor.session_id, body.environment, body.bundle_id, existing["id"]))
        pid = existing["id"]
    else:
        pid = uuid.uuid4()
        c.tx.run("""INSERT INTO push_devices (id, org_id, user_id, session_id, token_hash, token_ciphertext, environment, bundle_id)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                 (pid, c.actor.org_id, c.actor.user_id, c.actor.session_id, th,
                  encrypt_secret(body.token.lower(), "apns"), body.environment, body.bundle_id))
    audit(c.tx, c.actor.org_id, "push.device_registered", "push_device", pid, actor=c.actor,
          detail={"environment": body.environment})
    return {"id": str(pid), "delivery": "available" if get_settings().apns_configured else "push_unconfigured"}


@router.delete("/push/devices/{device_id}")
def unregister_push(device_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    if not c.tx.run("UPDATE push_devices SET revoked_at=now() WHERE id=%s AND user_id=%s", (device_id, c.actor.user_id)):
        raise not_found()
    audit(c.tx, c.actor.org_id, "push.device_revoked", "push_device", device_id, actor=c.actor)
    return {"ok": True}


# ---- support --------------------------------------------------------------------------------

class SupportIn(BaseModel):
    category: str = Field(min_length=1, max_length=60)
    store_id: uuid.UUID | None = None
    consent: bool
    description: str = Field(min_length=1, max_length=4000)


@router.post("/support/bundles", status_code=201)
def support_bundle(body: SupportIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("support.create")
    if not body.consent:
        raise invalid("consent", "required")
    stores = c.actor.scoped_stores(str(body.store_id) if body.store_id else None)
    health = system_health(c)
    bundle = {
        "generated_at": iso(now()), "request_id": c.request.headers.get("x-request-id"),
        "category": body.category, "description": body.description, "org_id": c.actor.org_id,
        "stores": stores, "health": health,
        "cameras": [{"id": str(r["id"]), "readiness": r["readiness"], "analysis_state": r["analysis_state"],
                     "channels": r["channels"], "last_frame_at": iso(r["last_frame_at"]),
                     "readiness_report": r["readiness_report"]}
                    for r in c.tx.all("SELECT * FROM cameras WHERE store_id = ANY(%s::uuid[])", (stores,))],
        "recent_errors": [clean(r) for r in c.tx.all(
            """SELECT created_at, action, resource_type, result FROM audit WHERE result<>'success' ORDER BY seq DESC LIMIT 50""")],
        "redaction": "Excludes camera credentials, face templates, photos, evidence, session/APNs tokens and addresses of people.",
    }
    data = json.dumps(bundle, indent=2, default=str).encode()
    m = media_store.store(c.tx, c.actor.org_id, data, "application/json", "diagnostics", expires_at=now() + timedelta(days=7))
    sid = uuid.uuid4()
    c.tx.run("""INSERT INTO support_requests (id, org_id, store_id, category, description, media_id, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""", (sid, c.actor.org_id, body.store_id, body.category, body.description,
                                                   m["id"], c.actor.user_id))
    audit(c.tx, c.actor.org_id, "support.bundle_created", "support_request", sid, actor=c.actor, store_id=body.store_id)
    return {"id": str(sid), "media_id": str(m["id"]), "download_url": f"/v1/media/{m['id']}",
            "expires_at": iso(m["expires_at"]), "support_contact": get_settings().support_contact}


# ---- media ----------------------------------------------------------------------------------

@router.get("/media/{media_id}")
def get_media(media_id: uuid.UUID, c: Ctx = Depends(ctx)) -> Response:
    m = c.tx.one("SELECT * FROM media WHERE id=%s", (media_id,))
    if not m:
        raise not_found()
    purpose = m["purpose"]
    if purpose in ("profile_photo", "profile_thumb"):
        p = c.tx.one("""SELECT pr.kind, pr.id FROM profile_photos ph JOIN profiles pr ON pr.id=ph.profile_id
                        WHERE ph.media_id=%s OR ph.thumb_media_id=%s""", (media_id, media_id))
        if not p:
            raise not_found()
        c.actor.require("staff.manage" if p["kind"] == "staff" else "photo.read")
        scopes = [str(r["store_id"]) for r in c.tx.all("SELECT store_id FROM profile_scopes WHERE profile_id=%s", (p["id"],))]
        if not (c.actor.all_stores or any(s in c.actor.store_ids for s in scopes)):
            raise not_found()
    elif purpose == "evidence":
        inc = c.tx.one("""SELECT i.store_id FROM incident_evidence ie JOIN incidents i ON i.id=ie.incident_id WHERE ie.media_id=%s""",
                       (media_id,))
        if not inc:
            raise not_found()
        c.actor.require("incident.read", str(inc["store_id"]))
        audit(c.tx, c.actor.org_id, "evidence.viewed", "media", media_id, actor=c.actor, store_id=inc["store_id"])
    elif purpose == "snapshot":
        c.actor.require("camera.read", str(m["store_id"]))
    elif purpose == "diagnostics":
        req = c.tx.one("SELECT created_by FROM support_requests WHERE media_id=%s", (media_id,))
        if not req or (str(req["created_by"]) != c.actor.user_id and not c.actor.can("org.manage")):
            raise not_found()
    else:
        raise not_found()
    if m["expires_at"] and m["expires_at"] < now() and not m["hold_reason"]:
        raise ApiError(410, "media_expired", "This file expired under the retention policy")
    data = media_store.read(m)
    headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
               "Content-Security-Policy": "default-src 'none'; sandbox"}
    if purpose == "diagnostics":
        headers["Content-Disposition"] = f'attachment; filename="retailguard-diagnostics-{media_id}.json"'
    return Response(data, media_type=m["mime"], headers=headers)
