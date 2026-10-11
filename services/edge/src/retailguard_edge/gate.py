"""Durable evidence gate (port of reference/domain.py EvidenceGate).

Same decision semantics as the reference kernel, but per-track state
(last/start/emitted) lives in SQLite so a restart cannot re-emit within the
cooldown. The track table is bounded (max_tracks, oldest evicted) and pruned
by TTL. Operates only on already-supplied signals; it computes nothing from
images.
"""
from __future__ import annotations

import math
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Signal:
    camera_id: str
    track_id: str
    timestamp: float
    anomaly: float
    item_interaction: float
    concealment_motion: float
    visibility: float


@dataclass(frozen=True)
class Decision:
    emit: bool
    reason: str
    window_start: float | None = None
    window_end: float | None = None


class DurableEvidenceGate:
    def __init__(self, db_path: Path | str, duration: float = 1.5, max_gap: float = .6, cooldown: float = 30.,
                 ttl: float = 120., max_tracks: int = 4096):
        if any(not math.isfinite(v) or v <= 0 for v in (duration, max_gap, cooldown, ttl)) or max_tracks < 1:
            raise ValueError("Invalid policy")
        if ttl < cooldown:
            raise ValueError("ttl must be >= cooldown so cooldown state is not pruned early")
        self.duration, self.max_gap, self.cooldown, self.ttl, self.max_tracks = duration, max_gap, cooldown, ttl, max_tracks
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS gate_tracks (camera_id TEXT NOT NULL, track_id TEXT NOT NULL, "
            "last REAL NOT NULL, start REAL, emitted REAL, PRIMARY KEY (camera_id, track_id))")
        self._db.execute("CREATE INDEX IF NOT EXISTS gate_tracks_last ON gate_tracks(last)")

    def close(self) -> None:
        self._db.close()

    def track_count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM gate_tracks").fetchone()[0]

    def evaluate(self, s: Signal) -> Decision:
        scores = (s.anomaly, s.item_interaction, s.concealment_motion, s.visibility)
        if (not s.camera_id or not s.track_id or not math.isfinite(s.timestamp)
                or any(not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in scores)):
            raise ValueError("Invalid supplied signal")
        with self._lock:
            db = self._db
            db.execute("BEGIN IMMEDIATE")
            try:
                decision = self._evaluate(db, s)
                db.execute("COMMIT")
                return decision
            except BaseException:
                db.execute("ROLLBACK")
                raise

    def _evaluate(self, db: sqlite3.Connection, s: Signal) -> Decision:
        db.execute("DELETE FROM gate_tracks WHERE ? - last > ?", (s.timestamp, self.ttl))
        key = (s.camera_id, s.track_id)
        row = db.execute("SELECT last, start, emitted FROM gate_tracks WHERE camera_id=? AND track_id=?", key).fetchone()
        if row is None:
            count = db.execute("SELECT COUNT(*) FROM gate_tracks").fetchone()[0]
            if count >= self.max_tracks:
                db.execute("DELETE FROM gate_tracks WHERE rowid IN "
                           "(SELECT rowid FROM gate_tracks ORDER BY last ASC LIMIT ?)", (count - self.max_tracks + 1,))
            last, start, emitted = s.timestamp, None, None
            db.execute("INSERT INTO gate_tracks(camera_id, track_id, last, start, emitted) VALUES (?,?,?,?,?)",
                       (*key, last, None, None))
        else:
            last, start, emitted = row

        def save(start_v: float | None, emitted_v: float | None, last_v: float) -> None:
            db.execute("UPDATE gate_tracks SET last=?, start=?, emitted=? WHERE camera_id=? AND track_id=?",
                       (last_v, start_v, emitted_v, *key))

        if s.timestamp < last:
            return Decision(False, "out_of_order")
        if s.timestamp - last > self.max_gap:
            start = None
        last = s.timestamp
        if s.visibility < .6:
            save(None, emitted, last)
            return Decision(False, "insufficient_evidence")
        if not (s.anomaly >= .75 and s.item_interaction >= .6 and s.concealment_motion >= .6):
            save(None, emitted, last)
            return Decision(False, "uncorroborated")
        if emitted is not None and s.timestamp - emitted < self.cooldown:
            save(start, emitted, last)
            return Decision(False, "cooldown")
        if start is None:
            start = s.timestamp
        if s.timestamp - start < self.duration:
            save(start, emitted, last)
            return Decision(False, "collecting_evidence")
        save(None, s.timestamp, last)
        return Decision(True, "behavior_candidate_requires_review", window_start=start, window_end=s.timestamp)
