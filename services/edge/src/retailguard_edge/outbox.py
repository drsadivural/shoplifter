"""Durable SQLite outbox for candidate events and their evidence files.

- event_id is deterministic (UUIDv5 over org/camera/track/window/channel), so a
  re-detection of the same window after a crash maps to the same event.
- Replay is idempotent: POST /v1/edge/events with `Idempotency-Key: <event_id>`,
  then PUT each evidence file with `X-Content-SHA256`. Only full success
  removes the item; failures stay pending with backoff; non-retriable
  rejections move to a dead-letter state kept for diagnostics.
- Evidence files live under spool/evidence and are referenced by path + sha256.
- Disk budget: raw ring-buffer files (spool/raw) expire oldest-first; pending
  evidence is never deleted to make room. If still over budget, new evidence
  is refused and the event is recorded with evidence_state "unavailable".
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

import jsonschema

from .client import EdgeAPIError, EdgeClient, backoff_delay

log = logging.getLogger(__name__)

EVENT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "urn:retailguard:edge-event:v1")
MAX_EVIDENCE_BYTES = 512 * 1024 * 1024
EVIDENCE_MIME = {"video/mp4": ".mp4", "image/jpeg": ".jpg"}


def load_event_schema() -> dict[str, Any]:
    return json.loads(resources.files("retailguard_edge").joinpath("schemas/event.schema.json").read_text("utf-8"))


_VALIDATOR = jsonschema.Draft202012Validator(load_event_schema())


def make_event_id(org_id: str, camera_id: str, track_id: str, window_start: float, channel: str) -> str:
    return str(uuid.uuid5(EVENT_NAMESPACE, f"{org_id}|{camera_id}|{track_id}|{window_start:.3f}|{channel}"))


def validate_event(event: dict[str, Any]) -> None:
    errors = sorted(_VALIDATOR.iter_errors(event), key=lambda e: list(e.path))
    if errors:
        raise ValueError(f"event_invalid: {errors[0].message[:200]}")
    try:
        parsed = dt.datetime.fromisoformat(event["captured_at"])
    except ValueError:
        raise ValueError("event_invalid: captured_at is not RFC 3339") from None
    if parsed.tzinfo is None:
        raise ValueError("event_invalid: captured_at must carry a UTC offset")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass(frozen=True)
class EvidenceInput:
    path: Path
    mime: str  # video/mp4 | image/jpeg
    kind: str = "clip"  # clip | frame


def _dir_size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += (Path(root) / f).stat().st_size
            except FileNotFoundError:
                pass
    return total


class Outbox:
    def __init__(self, state_dir: Path, disk_budget_bytes: int, *, clock: Callable[[], float] = time.time,
                 backoff_base_s: float = 2.0, backoff_max_s: float = 300.0):
        self.state_dir = state_dir
        self.spool = state_dir / "spool"
        self.evidence_dir = self.spool / "evidence"
        self.raw_dir = self.spool / "raw"
        for d in (self.spool, self.evidence_dir, self.raw_dir):
            d.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.disk_budget_bytes = disk_budget_bytes
        self._clock = clock
        self._backoff = (backoff_base_s, backoff_max_s)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(state_dir / "outbox.db"), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at REAL NOT NULL,
                posted INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at REAL NOT NULL DEFAULT 0, last_error TEXT,
                state TEXT NOT NULL DEFAULT 'pending');
            CREATE TABLE IF NOT EXISTS evidence (
                id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, path TEXT NOT NULL,
                sha256 TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
                uploaded INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS events_pending ON events(state, next_attempt_at, created_at);
        """)
        self.disk_pressure = False

    def close(self) -> None:
        self._db.close()

    # ---- disk budget ----------------------------------------------------
    def spool_bytes(self) -> int:
        return _dir_size(self.spool)

    def enforce_budget(self, incoming: int = 0) -> bool:
        """Expire oldest raw buffers until spool + incoming fits. Returns True if it fits."""
        used = self.spool_bytes()
        if used + incoming <= self.disk_budget_bytes:
            self.disk_pressure = False
            return True
        raws = sorted((p for p in self.raw_dir.rglob("*") if p.is_file()), key=lambda p: p.stat().st_mtime)
        for p in raws:
            if used + incoming <= self.disk_budget_bytes:
                break
            try:
                size = p.stat().st_size
                p.unlink()
                used -= size
                log.info("expired raw buffer to stay within disk budget")
            except FileNotFoundError:
                pass
        fits = used + incoming <= self.disk_budget_bytes
        self.disk_pressure = not fits
        if not fits:
            log.warning("spool over disk budget even after expiring raw buffers (health alarm)")
        return fits

    # ---- enqueue --------------------------------------------------------
    def enqueue(self, event: dict[str, Any], evidence: list[EvidenceInput] | tuple = ()) -> bool:
        """Persist an event (+ evidence) atomically. Returns False if event_id already queued."""
        event = dict(event)
        event_id = event.get("event_id")
        stored: list[tuple[Path, str, str, str, int]] = []
        if evidence:
            total = 0
            for ev in evidence:
                if ev.mime not in EVIDENCE_MIME or ev.kind not in ("clip", "frame"):
                    raise ValueError("evidence_type_invalid")
                total += ev.path.stat().st_size
            if total > MAX_EVIDENCE_BYTES or not self.enforce_budget(total):
                event["evidence_state"] = "unavailable"
                event.setdefault("uncertainty", [])
                event["uncertainty"] = [*event["uncertainty"], "evidence_dropped_disk_budget"][:20]
                evidence = ()
        validate_event(event)
        with self._lock:
            if self._db.execute("SELECT 1 FROM events WHERE event_id=?", (event_id,)).fetchone():
                return False
            if evidence:
                dest_dir = self.evidence_dir / str(event_id)
                dest_dir.mkdir(mode=0o700, exist_ok=True)
                for i, ev in enumerate(evidence):
                    dest = dest_dir / f"{i}{EVIDENCE_MIME[ev.mime]}"
                    shutil.copyfile(ev.path, dest)
                    os.chmod(dest, 0o600)
                    stored.append((dest, sha256_file(dest), ev.mime, ev.kind, dest.stat().st_size))
                event["evidence_state"] = "pending"
                event["evidence_sha256"] = stored[0][1]
                validate_event(event)
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("INSERT INTO events(event_id, payload, created_at) VALUES (?,?,?)",
                                 (event_id, json.dumps(event, sort_keys=True), self._clock()))
                for path, digest, mime, kind, size in stored:
                    self._db.execute("INSERT INTO evidence(event_id, path, sha256, mime, kind, size) VALUES (?,?,?,?,?,?)",
                                     (event_id, str(path), digest, mime, kind, size))
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return True

    # ---- stats ----------------------------------------------------------
    def pending_count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM events WHERE state='pending'").fetchone()[0]

    def dead_count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM events WHERE state='dead'").fetchone()[0]

    def oldest_pending_age_s(self) -> float | None:
        row = self._db.execute("SELECT MIN(created_at) FROM events WHERE state='pending'").fetchone()
        return None if row[0] is None else max(0.0, self._clock() - row[0])

    def get(self, event_id: str) -> dict[str, Any] | None:
        row = self._db.execute("SELECT payload, posted, attempts, state, last_error FROM events WHERE event_id=?",
                               (event_id,)).fetchone()
        if row is None:
            return None
        return {"payload": json.loads(row[0]), "posted": bool(row[1]), "attempts": row[2], "state": row[3],
                "last_error": row[4]}

    # ---- replay ---------------------------------------------------------
    def flush(self, client: EdgeClient, limit: int = 50) -> dict[str, int]:
        stats = {"sent": 0, "failed": 0, "dead": 0}
        now = self._clock()
        rows = self._db.execute(
            "SELECT event_id, payload, posted, attempts FROM events WHERE state='pending' AND next_attempt_at<=? "
            "ORDER BY created_at LIMIT ?", (now, limit)).fetchall()
        for event_id, payload, posted, attempts in rows:
            try:
                if not posted:
                    client.request("POST", "/v1/edge/events", json=json.loads(payload),
                                   headers={"Idempotency-Key": event_id}, retry=False)
                    self._db.execute("UPDATE events SET posted=1 WHERE event_id=?", (event_id,))
                self._upload_evidence(client, event_id)
            except EdgeAPIError as exc:
                if exc.status is not None and not exc.retriable and exc.status not in (401, 403, 404):
                    self._db.execute("UPDATE events SET state='dead', last_error=?, attempts=attempts+1 WHERE event_id=?",
                                     (exc.code, event_id))
                    stats["dead"] += 1
                    log.warning("event %s dead-lettered: %s", event_id, exc.code)
                else:
                    delay = backoff_delay(attempts, *self._backoff)
                    self._db.execute("UPDATE events SET attempts=attempts+1, next_attempt_at=?, last_error=? "
                                     "WHERE event_id=?", (self._clock() + max(delay, 1.0), exc.code, event_id))
                    stats["failed"] += 1
                continue
            self._remove(event_id)
            stats["sent"] += 1
        return stats

    def _upload_evidence(self, client: EdgeClient, event_id: str) -> None:
        rows = self._db.execute("SELECT id, path, sha256, mime FROM evidence WHERE event_id=? AND uploaded=0 ORDER BY id",
                                (event_id,)).fetchall()
        for ev_id, path, digest, mime in rows:
            p = Path(path)
            try:
                data = p.read_bytes()
            except FileNotFoundError:
                data = None
            if data is None or hashlib.sha256(data).hexdigest() != digest:
                # Never upload altered/missing evidence; record it and move on.
                log.warning("evidence for event %s missing or failed checksum; not uploaded", event_id)
                self._db.execute("UPDATE evidence SET uploaded=-1 WHERE id=?", (ev_id,))
                continue
            client.request("PUT", f"/v1/edge/events/{quote(event_id, safe='')}/evidence", content=data,
                           headers={"Content-Type": mime, "X-Content-SHA256": digest}, retry=False)
            self._db.execute("UPDATE evidence SET uploaded=1 WHERE id=?", (ev_id,))

    def _remove(self, event_id: str) -> None:
        paths = [Path(r[0]) for r in self._db.execute("SELECT path FROM evidence WHERE event_id=?", (event_id,))]
        self._db.execute("BEGIN IMMEDIATE")
        self._db.execute("DELETE FROM evidence WHERE event_id=?", (event_id,))
        self._db.execute("DELETE FROM events WHERE event_id=?", (event_id,))
        self._db.execute("COMMIT")
        for p in paths:
            p.unlink(missing_ok=True)
        d = self.evidence_dir / event_id
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
