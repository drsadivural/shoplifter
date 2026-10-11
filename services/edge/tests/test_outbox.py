import hashlib
import json
import os

import httpx
import pytest
from nacl.signing import SigningKey

from retailguard_edge.client import EdgeClient, canonical_string
from retailguard_edge.outbox import EvidenceInput, Outbox, load_event_schema, make_event_id
from conftest import REPO_ROOT


class FakeAPI:
    """Signed-request verifying fake for /v1/edge/events (+evidence), deduping by Idempotency-Key."""

    def __init__(self, key: SigningKey):
        self.vk = key.verify_key
        self.fail_post = 0
        self.fail_put = 0
        self.post_status = None
        self.incidents = {}
        self.posts = []
        self.puts = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        import base64
        msg = canonical_string(req.method, req.url.raw_path.decode(), req.headers["X-Edge-Timestamp"],
                               req.headers["X-Edge-Nonce"], req.content)
        self.vk.verify(msg, base64.b64decode(req.headers["X-Edge-Signature"]))
        if req.method == "POST" and req.url.path == "/v1/edge/events":
            if self.post_status:
                return httpx.Response(self.post_status, json={"code": "validation_failed"})
            if self.fail_post:
                self.fail_post -= 1
                return httpx.Response(503, json={"code": "unavailable"})
            key = req.headers["Idempotency-Key"]
            body = json.loads(req.content)
            assert key == body["event_id"]
            self.posts.append(key)
            inc = self.incidents.setdefault(key, f"inc-{len(self.incidents) + 1}")
            return httpx.Response(200, json={"incident_id": inc})
        if req.method == "PUT" and req.url.path.endswith("/evidence"):
            if self.fail_put:
                self.fail_put -= 1
                raise httpx.ConnectError("connection reset")
            assert hashlib.sha256(req.content).hexdigest() == req.headers["X-Content-SHA256"]
            self.puts.append((req.url.path, req.headers["Content-Type"], len(req.content)))
            return httpx.Response(204)
        return httpx.Response(404)


class Clock:
    def __init__(self):
        self.t = 1_760_000_000.0

    def __call__(self):
        return self.t


def event(eid=None, **over):
    e = {"event_id": eid or make_event_id("org", "cam-1", "trk-7", 1234.5, "behavior_candidate"),
         "org_id": "org", "store_id": "store", "camera_id": "cam-1", "channel": "behavior_candidate",
         "captured_at": "2026-10-11T01:42:18Z", "model_version": "m1", "preprocessing_version": "p1",
         "gate_reason": "behavior_candidate_requires_review", "signals": {"anomaly": 0.8},
         "evidence_state": "unavailable"}
    e.update(over)
    return e


@pytest.fixture
def setup(state_dir):
    key = SigningKey.generate()
    api = FakeAPI(key)
    client = EdgeClient("https://api.test", "edge-1", key, transport=httpx.MockTransport(api), sleep=lambda s: None)
    clock = Clock()
    ob = Outbox(state_dir, 10 * 1024**2, clock=clock)
    return api, client, ob, clock, state_dir


def test_schema_copy_matches_contract():
    assert load_event_schema() == json.loads((REPO_ROOT / "contracts/event.schema.json").read_text())


def test_event_id_deterministic():
    a = make_event_id("o", "c", "t", 10.0, "behavior_candidate")
    assert a == make_event_id("o", "c", "t", 10.0, "behavior_candidate")
    assert a != make_event_id("o", "c", "t", 10.5, "behavior_candidate")


def test_invalid_event_rejected(setup):
    _, _, ob, _, _ = setup
    with pytest.raises(ValueError):
        ob.enqueue(event(channel="theft"))
    with pytest.raises(ValueError):
        ob.enqueue(event(captured_at="yesterday"))
    with pytest.raises(ValueError):
        ob.enqueue(event(signals={"anomaly": 1.2}))


def test_success_removes_item_and_uploads_evidence(setup, tmp_path):
    api, client, ob, clock, sd = setup
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(os.urandom(4096))
    assert ob.enqueue(event(), [EvidenceInput(clip, "video/mp4")])
    eid = event()["event_id"]
    stored = ob.get(eid)
    assert stored["payload"]["evidence_state"] == "pending"
    assert stored["payload"]["evidence_sha256"] == hashlib.sha256(clip.read_bytes()).hexdigest()
    assert ob.flush(client) == {"sent": 1, "failed": 0, "dead": 0}
    assert ob.pending_count() == 0 and ob.get(eid) is None
    assert api.posts == [eid] and api.puts == [(f"/v1/edge/events/{eid}/evidence", "video/mp4", 4096)]
    assert not (sd / "spool/evidence" / eid).exists()


def test_failed_post_keeps_item_and_survives_restart(setup):
    api, client, ob, clock, sd = setup
    api.fail_post = 1
    ob.enqueue(event())
    assert ob.flush(client) == {"sent": 0, "failed": 1, "dead": 0}
    assert ob.pending_count() == 1 and ob.get(event()["event_id"])["attempts"] == 1
    ob.close()
    ob2 = Outbox(sd, 10 * 1024**2, clock=clock)  # restart
    assert ob2.pending_count() == 1
    assert ob2.flush(client)["sent"] == 0  # still in backoff
    clock.t += 3600
    assert ob2.flush(client) == {"sent": 1, "failed": 0, "dead": 0}
    assert ob2.pending_count() == 0


def test_idempotent_replay(setup, tmp_path):
    api, client, ob, clock, _ = setup
    jpg = tmp_path / "f.jpg"
    jpg.write_bytes(b"\xff\xd8jpeg\xff\xd9")
    assert ob.enqueue(event(), [EvidenceInput(jpg, "image/jpeg", "frame")]) is True
    assert ob.enqueue(event()) is False  # same deterministic event_id: not duplicated
    api.fail_put = 1
    assert ob.flush(client)["failed"] == 1  # POST ok, evidence PUT failed -> kept
    assert ob.pending_count() == 1 and ob.get(event()["event_id"])["posted"] is True
    clock.t += 3600
    assert ob.flush(client)["sent"] == 1
    assert len(api.posts) == 1 and len(api.incidents) == 1 and len(api.puts) == 1
    # A replay after a crash between POST and local bookkeeping re-sends the same key -> same incident.
    ob.enqueue(event())
    ob.flush(client)
    assert len(api.posts) == 2 and len(api.incidents) == 1


def test_non_retriable_rejection_dead_letters(setup):
    api, client, ob, _, _ = setup
    api.post_status = 422
    ob.enqueue(event())
    assert ob.flush(client)["dead"] == 1
    assert ob.pending_count() == 0 and ob.dead_count() == 1


def test_disk_budget_expires_oldest_raw_first(state_dir, tmp_path):
    ob = Outbox(state_dir, 64 * 1024**2)
    raw = ob.raw_dir
    for i in range(5):
        p = raw / f"seg{i}.ts"
        p.write_bytes(b"\0" * (15 * 1024**2))
        os.utime(p, (1000 + i, 1000 + i))
    assert ob.enforce_budget() is True
    remaining = sorted(p.name for p in raw.iterdir())
    assert remaining == ["seg1.ts", "seg2.ts", "seg3.ts", "seg4.ts"]  # 75 MiB > 64 MiB: only the oldest expired
    # evidence that cannot fit even after expiring raw buffers is refused honestly
    big = tmp_path / "big.mp4"
    big.write_bytes(b"\0" * (70 * 1024**2))
    ob.enqueue(event(), [EvidenceInput(big, "video/mp4")])
    stored = ob.get(event()["event_id"])["payload"]
    assert stored["evidence_state"] == "unavailable" and "evidence_dropped_disk_budget" in stored["uncertainty"]
    assert ob.disk_pressure is True
    assert list(raw.iterdir()) == []  # all raw buffers expired before refusing


def test_tampered_evidence_not_uploaded(setup, tmp_path):
    api, client, ob, _, sd = setup
    clip = tmp_path / "c.mp4"
    clip.write_bytes(b"original")
    ob.enqueue(event(), [EvidenceInput(clip, "video/mp4")])
    eid = event()["event_id"]
    (sd / "spool/evidence" / eid / "0.mp4").write_bytes(b"tampered")
    ob.flush(client)
    assert api.puts == []
