"""Background worker: outbox delivery (in-app notifications, APNs), acknowledgement-deadline
escalation, evidence export bundles and retention. Runs with a dedicated DB role.

Delivery is at-least-once with idempotent effects; failures retry with exponential backoff and
jitter, then move to a dead-letter state that the health page reports."""
from __future__ import annotations

import io
import json
import logging
import random
import signal
import time
import uuid
import zipfile
from datetime import timedelta

import httpx
import jwt

from . import media as media_store
from .authz import audit, iso, now, outbox, request_id_var
from .db import J, Tx, worker_transaction as transaction
from .security import decrypt_secret
from .settings import get_settings

log = logging.getLogger("retailguard.worker")
MAX_ATTEMPTS = 8
CHANNEL_PREF = {"behavior_candidate": "behavior", "watchlist_candidate": "watchlist", "checkout_exception": "checkout",
                "rfid_exception": "rfid", "manual_observation": None}
GENERIC_TEXT = {"en": "A new alert needs review. Open RetailGuard to see details.",
                "ja": "確認が必要な新しいアラートがあります。RetailGuardを開いて確認してください。"}
ESCALATION_TEXT = {"en": "An alert was escalated and needs a responder.",
                   "ja": "対応が必要なアラートがエスカレーションされました。"}
_running = True


class APNs:
    """Token-based APNs provider (HTTP/2). Payload contains only the incident ID and generic text."""

    def __init__(self):
        s = get_settings()
        self.enabled = s.apns_configured
        self._token, self._issued = None, 0.0
        if self.enabled:
            with open(s.apns_private_key_file) as fh:
                self.key = fh.read()
            self.client = httpx.Client(http2=True, timeout=10)

    def _jwt(self) -> str:
        s = get_settings()
        if not self._token or time.time() - self._issued > 50 * 60:
            self._issued = time.time()
            self._token = jwt.encode({"iss": s.apns_team_id, "iat": int(self._issued)}, self.key, algorithm="ES256",
                                     headers={"kid": s.apns_key_id})
        return self._token

    def send(self, token: str, environment: str, bundle_id: str, body: str, incident_id: str, sound: bool) -> str:
        host = "api.sandbox.push.apple.com" if environment == "sandbox" else "api.push.apple.com"
        payload = {"aps": {"alert": {"title": "RetailGuard", "body": body}, **({"sound": "default"} if sound else {}),
                           "thread-id": "alerts"}, "incident_id": incident_id}
        r = self.client.post(f"https://{host}/3/device/{token}", json=payload,
                             headers={"authorization": f"bearer {self._jwt()}", "apns-topic": bundle_id,
                                      "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": "0"})
        if r.status_code == 200:
            return "sent"
        reason = (r.json() if r.content else {}).get("reason", "")
        if r.status_code == 410 or reason in ("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"):
            return "revoke"
        raise RuntimeError(f"apns_{r.status_code}_{reason}")


def _recipients(tx: Tx, store_id, channel: str | None, escalation: bool) -> list[dict]:
    from .routers.org import store_policy
    # The worker role bypasses RLS, so every query here is explicitly scoped to the store's org.
    org_id = tx.scalar("SELECT org_id FROM stores WHERE id=%s", (store_id,))
    users = tx.all("""SELECT u.* FROM app_users u WHERE u.org_id=%s AND u.active AND u.role<>'viewer' AND
                      (u.role='org_admin' OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.store_id=%s))""",
                   (org_id, store_id))
    routing = store_policy(tx, org_id, store_id, "notification_routing")["settings"] if org_id else {}
    pref_key = CHANNEL_PREF.get(channel)
    if pref_key and routing and not routing.get(pref_key, True) and not escalation:
        return []
    if escalation and org_id:
        esc = store_policy(tx, org_id, store_id, "escalation")["settings"]
        ids = set(esc["primary_responder_ids"]) | set(esc["backup_responder_ids"])
        chosen = [u for u in users if str(u["id"]) in ids]
        return chosen or [u for u in users if u["role"] in ("store_admin", "org_admin")]
    out = []
    for u in users:
        prefs = u["notification_prefs"] or {}
        if pref_key and prefs.get(pref_key) is False:
            continue
        if prefs.get("store_ids") and str(store_id) not in prefs["store_ids"]:
            continue
        out.append(u)
    return out


def deliver_incident(tx: Tx, apns: APNs, item: dict) -> str:
    p = item["payload"]
    inc = tx.one("SELECT id, org_id, store_id, channel, status FROM incidents WHERE id=%s", (p["incident_id"],))
    if not inc:
        return "incident_missing"
    escalation = item["topic"] == "incident.escalated"
    users = _recipients(tx, inc["store_id"], inc["channel"], escalation)
    pushed = skipped = 0
    for u in users:
        tx.run("""INSERT INTO notifications (id, org_id, user_id, incident_id, kind) VALUES (%s,%s,%s,%s,%s)""",
               (uuid.uuid4(), inc["org_id"], u["id"], inc["id"], item["topic"]))
        devices = tx.all("SELECT * FROM push_devices WHERE user_id=%s AND revoked_at IS NULL", (u["id"],))
        if not devices:
            continue
        if not apns.enabled:
            skipped += len(devices)
            continue
        lang = u["locale"] or "ja"
        text = (ESCALATION_TEXT if escalation else GENERIC_TEXT)[lang]
        sound = (u["notification_prefs"] or {}).get("sound", True)
        for d in devices:
            result = apns.send(decrypt_secret(d["token_ciphertext"], "apns"), d["environment"], d["bundle_id"], text,
                               str(inc["id"]), sound)
            if result == "revoke":
                tx.run("UPDATE push_devices SET revoked_at=now() WHERE id=%s", (d["id"],))
            else:
                pushed += 1
    return f"notified={len(users)} pushed={pushed} push_unconfigured={skipped}"


def build_export(tx: Tx, item: dict) -> str:
    e = tx.one("SELECT * FROM exports WHERE id=%s FOR UPDATE", (item["payload"]["export_id"],))
    if not e or e["status"] != "queued":
        return "skipped"
    case = tx.one("SELECT * FROM cases WHERE id=%s", (e["case_id"],))
    incidents = tx.all("""SELECT i.* FROM incidents i JOIN case_incidents ci ON ci.incident_id=i.id WHERE ci.case_id=%s
                          ORDER BY i.captured_at""", (e["case_id"],))
    buf = io.BytesIO()
    files = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        def add(name: str, data: bytes) -> None:
            import hashlib
            z.writestr(name, data)
            files.append({"name": name, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)})
        records = []
        for inc in incidents:
            rec = {k: (iso(v) if hasattr(v, "isoformat") else str(v) if isinstance(v, uuid.UUID) else
                       float(v) if type(v).__name__ == "Decimal" else v)
                   for k, v in inc.items() if k not in ("org_id",)}
            records.append(rec)
            for ev in tx.all("""SELECT m.* FROM incident_evidence ie JOIN media m ON m.id=ie.media_id
                                WHERE ie.incident_id=%s AND m.deleted_at IS NULL""", (inc["id"],)):
                ext = "mp4" if ev["mime"] == "video/mp4" else "jpg"
                add(f"evidence/{inc['id']}/{ev['id']}.{ext}", media_store.read(ev))
        add("incidents.json", json.dumps(records, indent=2, ensure_ascii=False).encode())
        manifest = {"export_id": str(e["id"]), "case_id": str(case["id"]), "case_title": case["title"],
                    "generated_at": iso(now()), "recipient": e["recipient"], "reason": e["reason"],
                    "redaction": e["redaction"], "expires_at": iso(e["expires_at"]), "files": list(files)}
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
    m = media_store.store(tx, e["org_id"], buf.getvalue(), "application/zip", "export", store_id=case["store_id"],
                          expires_at=e["expires_at"])
    tx.run("UPDATE exports SET status='ready', manifest=%s, media_id=%s WHERE id=%s",
           (J({"files": files, "bundle_sha256": m["sha256"]}), m["id"], e["id"]))
    audit(tx, str(e["org_id"]), "export.ready", "export", e["id"], actor_kind="system",
          detail={"case_id": str(case["id"]), "files": len(files), "bundle_sha256": m["sha256"]})
    return f"files={len(files)}"


def process_outbox(apns: APNs) -> int:
    handled = 0
    for _ in range(20):
        with transaction() as tx:
            item = tx.one("""SELECT * FROM outbox WHERE delivered_at IS NULL AND dead_at IS NULL AND available_at <= now()
                             ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED""")
            if not item:
                return handled
            tx.set_context(item["org_id"])
            try:
                with tx.conn.transaction():  # savepoint so a failed delivery keeps the retry bookkeeping
                    if item["topic"] in ("incident.created", "incident.review_requested", "incident.escalated"):
                        note = deliver_incident(tx, apns, item)
                    elif item["topic"] == "export.build":
                        note = build_export(tx, item)
                    else:
                        note = "no_action"
                tx.run("UPDATE outbox SET delivered_at=now(), attempts=attempts+1, last_error=%s WHERE id=%s",
                       (note[:500], item["id"]))
            except Exception as exc:  # retry with backoff; never lose the underlying record
                attempts = item["attempts"] + 1
                delay = min(3600, 2 ** attempts * 5) * random.uniform(0.8, 1.2)
                dead = attempts >= MAX_ATTEMPTS
                tx.run("""UPDATE outbox SET attempts=%s, last_error=%s, available_at=now() + make_interval(secs => %s),
                          dead_at=CASE WHEN %s THEN now() ELSE NULL END WHERE id=%s""",
                       (attempts, type(exc).__name__ + ": " + str(exc)[:300], delay, dead, item["id"]))
                if item["topic"] == "export.build" and dead:
                    tx.run("UPDATE exports SET status='failed', error=%s WHERE id=%s",
                           (str(exc)[:300], item["payload"].get("export_id")))
                log.warning("outbox %s failed attempt %s: %s", item["topic"], attempts, exc)
        handled += 1
    return handled


def escalate_overdue() -> int:
    n = 0
    with transaction() as tx:
        rows = tx.all("""SELECT id, org_id, store_id, version FROM incidents WHERE status='new' AND escalated_at IS NULL
                         AND ack_deadline < now() LIMIT 100 FOR UPDATE SKIP LOCKED""")
        for r in rows:
            tx.set_context(r["org_id"])
            tx.run("""UPDATE incidents SET escalated_at=now(), priority=CASE WHEN priority='normal' THEN 'high' ELSE priority END,
                      version=version+1 WHERE id=%s""", (r["id"],))
            audit(tx, str(r["org_id"]), "incident.ack_deadline_missed", "incident", r["id"], actor_kind="system",
                  store_id=r["store_id"])
            outbox(tx, str(r["org_id"]), f"incident:{r['id']}:deadline", "incident.escalated",
                   {"incident_id": str(r["id"]), "store_id": str(r["store_id"]), "backup": True})
            n += 1
    return n


def retention() -> dict:
    stats = {"media_deleted": 0, "profiles_expired": 0}
    with transaction() as tx:
        for m in tx.all("""SELECT id, org_id FROM media WHERE deleted_at IS NULL AND hold_reason IS NULL
                           AND expires_at < now() LIMIT 200 FOR UPDATE SKIP LOCKED"""):
            tx.set_context(m["org_id"])
            media_store.delete(tx, m["id"])
            tx.run("""UPDATE incidents i SET evidence_state='expired' WHERE i.evidence_state='available' AND EXISTS
                      (SELECT 1 FROM incident_evidence ie WHERE ie.incident_id=i.id AND ie.media_id=%s) AND NOT EXISTS
                      (SELECT 1 FROM incident_evidence ie JOIN media mm ON mm.id=ie.media_id
                       WHERE ie.incident_id=i.id AND mm.deleted_at IS NULL)""", (m["id"],))
            stats["media_deleted"] += 1
        for p in tx.all("""SELECT id, org_id FROM profiles WHERE status IN ('draft','pending_review','approved','suspended')
                           AND expires_at < now() LIMIT 200 FOR UPDATE SKIP LOCKED"""):
            tx.set_context(p["org_id"])
            tx.run("UPDATE profiles SET status='expired', gallery_state='not_in_gallery', version=version+1 WHERE id=%s", (p["id"],))
            audit(tx, str(p["org_id"]), "profile.expired", "profile", p["id"], actor_kind="system")
            stats["profiles_expired"] += 1
        tx.set_context(None)
        tx.run("DELETE FROM edge_nonces WHERE seen_at < now() - interval '1 hour'")
        tx.run("DELETE FROM integration_nonces WHERE seen_at < now() - interval '1 hour'")
        tx.run("DELETE FROM login_throttle WHERE window_start < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now())")
    stats["live_dirs_removed"] = prune_live_segments()
    return stats


def prune_live_segments(max_age_s: float = 120.0) -> int:
    """Live-view segments are transient: remove a camera's folder once nobody has been sent new video
    for two minutes (the API keeps only the newest few while it is live)."""
    import shutil
    import time
    from pathlib import Path
    root = Path(get_settings().media_dir) / "live"
    removed = 0
    if not root.is_dir():
        return 0
    for d in root.iterdir():
        try:
            newest = max((p.stat().st_mtime for p in d.iterdir()), default=d.stat().st_mtime)
        except OSError:
            continue
        if time.time() - newest > max_age_s:
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    return removed


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    request_id_var.set("worker")
    apns = APNs()

    def stop(*_):
        global _running
        _running = False
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    last_retention = 0.0
    log.info("worker started apns=%s", "configured" if apns.enabled else "unconfigured")
    while _running:
        try:
            with transaction() as tx:
                tx.run("""INSERT INTO worker_heartbeat (name, seen_at, detail) VALUES ('worker', now(), %s)
                          ON CONFLICT (name) DO UPDATE SET seen_at=now(), detail=EXCLUDED.detail""",
                       (J({"apns": apns.enabled}),))
            escalate_overdue()
            process_outbox(apns)
            if time.time() - last_retention > 300:
                stats = retention()
                last_retention = time.time()
                if any(stats.values()):
                    log.info("retention %s", stats)
        except Exception:
            log.exception("worker loop error")
        for _ in range(10):
            if not _running:
                break
            time.sleep(0.5)
