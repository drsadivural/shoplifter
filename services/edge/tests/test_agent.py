import base64
import json
import logging
import os
import stat

import httpx
import pytest
from nacl.public import SealedBox

from fake_onvif import FakeOnvif
from retailguard_edge.agent import Agent
from retailguard_edge.client import EdgeClient, canonical_string
from retailguard_edge.config import EdgeConfig
from retailguard_edge.identity import IdentityError, PairingState, load_or_create_keys, load_pairing, pair
from retailguard_edge.stream import StreamSource, capture_masked_snapshot, probe_readiness

HEARTBEAT_KEYS = {"software_version", "clock_offset_ms", "health", "cameras", "models"}
HEALTH_KEYS = {"disk_free_bytes", "disk_total_bytes", "gpu_utilization", "decode_latency_ms_p95", "queue_age_s",
               "spool_pending"}
CAMERA_KEYS = {"camera_id", "readiness", "analysis_state", "channels", "last_frame_at", "fps", "width", "height",
               "codec", "error"}


class FakeAPI:
    def __init__(self, vk):
        self.vk, self.acks, self.commands, self.heartbeats, self.snapshots = vk, [], [], [], []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        msg = canonical_string(req.method, req.url.raw_path.decode(), req.headers["X-Edge-Timestamp"],
                               req.headers["X-Edge-Nonce"], req.content)
        self.vk.verify(msg, base64.b64decode(req.headers["X-Edge-Signature"]))
        path = req.url.path
        if path == "/v1/edge/commands":
            items, self.commands = self.commands, []
            return httpx.Response(200, json={"items": items})
        if path.startswith("/v1/edge/commands/") and path.endswith("/ack"):
            self.acks.append((path.split("/")[4], json.loads(req.content)))
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/edge/heartbeat":
            self.heartbeats.append(json.loads(req.content))
            return httpx.Response(200, json={"ok": True, "config_version": 1},
                                  headers={"Date": "Sat, 11 Oct 2026 01:42:18 GMT"})
        if path.startswith("/v1/edge/cameras/") and path.endswith("/snapshot"):
            assert req.headers["Content-Type"] == "image/jpeg"
            self.snapshots.append((path.split("/")[4], req.content))
            return httpx.Response(204)
        return httpx.Response(404, json={"code": "not_found"})


def make_agent(state_dir, subnets, **kw):
    keys = load_or_create_keys(state_dir)
    pairing = PairingState("edge-1", "org-1", "store-1", "Asia/Tokyo", subnets, "https://api.test", 1, 0.0)
    api = FakeAPI(keys.signing_key.verify_key)
    client = EdgeClient("https://api.test", "edge-1", keys.signing_key, transport=httpx.MockTransport(api),
                        sleep=lambda s: None)
    cfg = EdgeConfig(state_dir=state_dir, monitor_streams=False, sample_seconds=10, required_decoded_seconds=10)
    return Agent(cfg, keys, pairing, client, **kw), api, keys


def ready_camera(agent, cid="cam-1"):
    agent.store.put_camera({"camera_id": cid, "address": "192.168.10.20", "readiness": "ready",
                            "stream_uri": "rtsp://192.168.10.20/s", "report": {"codec": "h264", "width": 640,
                                                                               "height": 360, "fps": 15.0},
                            "zones": [], "analysis_state": "unavailable",
                            "channels": {c: {"state": "not_requested"} for c in ("behavior", "watchlist", "checkout")}})


def test_activate_camera_without_models_reports_unavailable(state_dir):
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"])
    ready_camera(agent)
    api.commands = [{"id": "cmd-1", "kind": "activate_camera", "created_at": "2026-10-11T00:00:00Z",
                     "payload": {"camera_id": "cam-1", "channels": ["behavior", "watchlist", "checkout"],
                                 "zones": [{"id": "z", "type": "shelf", "label": "A",
                                            "points": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5]]}],
                                 "policy": {"local_hours": "09:00-21:00"}}}]
    agent.poll_commands()
    [(cid, ack)] = api.acks
    assert cid == "cmd-1" and ack["status"] == "succeeded"
    assert ack["result"]["channels"] == {
        "behavior": {"state": "unavailable", "reason": "model_not_installed"},
        "watchlist": {"state": "unavailable", "reason": "face_sdk_unavailable"},
        "checkout": {"state": "unavailable", "reason": "pos_unconfigured"},
    }
    assert ack["result"]["analysis_state"] == "unavailable"  # never "analyzing" without a model
    cam = agent.store.camera("cam-1")
    assert cam["analysis_state"] == "unavailable" and len(cam["zones"]) == 1


def test_activate_not_ready_camera_fails(state_dir):
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"])
    agent.store.put_camera({"camera_id": "cam-2", "readiness": "degraded", "zones": []})
    status, result, error = agent.execute("activate_camera", {"camera_id": "cam-2", "channels": ["behavior"]})
    assert (status, error) == ("failed", "camera_not_ready")
    assert result["channels"]["behavior"] == {"state": "unavailable", "reason": "camera_not_ready"}
    assert agent.execute("activate_camera", {"camera_id": "nope", "channels": []})[2] == "camera_unknown"


def test_gallery_update_and_model_rollout_are_honest(state_dir, caplog):
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"])
    caplog.set_level(logging.DEBUG)
    status, result, error = agent.execute("gallery_update", {"profile_id": "p", "template": "SECRET-TEMPLATE"})
    assert (status, error) == ("failed", "face_sdk_unavailable")
    assert result == {"state": "unavailable", "reason": "face_sdk_unavailable"}
    assert "SECRET-TEMPLATE" not in caplog.text
    status, result, error = agent.execute("model_rollout", {"name": "shopformer", "version": "1"})
    assert (status, error) == ("failed", "model_not_installed")
    assert result["state"] == "unavailable"
    assert agent.execute("self_destruct", {})[2] == "unsupported_command"


def test_pause_and_update_zones(state_dir):
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"])
    ready_camera(agent)
    st, res, _ = agent.execute("update_zones", {"camera_id": "cam-1", "zones_version": 4, "zones": [
        {"id": "m", "type": "privacy_mask", "label": "office", "points": [[0, 0], [0.2, 0], [0.2, 0.2]]}]})
    assert st == "succeeded" and res == {"zones_version": 4}
    assert agent.execute("update_zones", {"camera_id": "cam-1", "zones_version": 5,
                                          "zones": [{"type": "privacy_mask", "points": [[0, 0], [2, 2], [1, 0]]}]})[2] \
        == "invalid_zones"
    st, res, _ = agent.execute("pause_camera", {"camera_id": "cam-1"})
    assert st == "succeeded" and res["analysis_state"] == "paused"


def test_provision_forbidden_target_never_probed(state_dir):
    called = []
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"],
                               probe_fn=lambda *a, **k: called.append(1))
    for addr in ("169.254.169.254", "127.0.0.1", "8.8.8.8", "192.168.99.5", "http://192.168.10.5@evil.example/"):
        status, result, error = agent.execute("provision_camera", {"camera_id": "c", "address": addr,
                                                                  "stream_profile": "substream"})
        assert (status, error) == ("failed", "target_not_permitted"), addr
        assert result["readiness"] == "offline"
    assert called == []


def test_redelivered_command_not_reexecuted(state_dir):
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"])
    ready_camera(agent)
    calls = []
    orig = agent.handlers["pause_camera"]
    agent.handlers["pause_camera"] = lambda p: (calls.append(1), orig(p))[1]
    cmd = {"id": "cmd-9", "kind": "pause_camera", "payload": {"camera_id": "cam-1"}}
    agent.process_command(cmd)
    agent.process_command(cmd)
    assert calls == [1] and len(api.acks) == 2 and api.acks[0] == api.acks[1]


def test_heartbeat_matches_contract(state_dir):
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"])
    ready_camera(agent)
    agent.heartbeat()  # first call learns the server Date for the clock offset
    agent.heartbeat()
    hb = api.heartbeats[-1]
    assert set(hb) <= HEARTBEAT_KEYS and set(hb["health"]) <= HEALTH_KEYS
    assert hb["health"]["disk_free_bytes"] > 0 and hb["health"]["spool_pending"] == 0
    assert isinstance(hb["clock_offset_ms"], int)
    assert hb["models"] == []
    [cam] = hb["cameras"]
    assert set(cam) <= CAMERA_KEYS and cam["readiness"] == "ready" and cam["analysis_state"] == "unavailable"
    status = json.loads((state_dir / "status.json").read_text())
    assert status["outbox"]["pending"] == 0
    assert stat.S_IMODE(os.stat(state_dir / "status.json").st_mode) == 0o600


def test_provision_end_to_end_with_fake_onvif(state_dir, private_ip, video_12s):
    """ONVIF auth+profile+URI against the in-test device; readiness/snapshot decode the real test video
    (the RTSP leg itself is covered by test_rtsp_mediamtx.py)."""
    seen = {}

    def probe(source: StreamSource, **kw):
        seen["url"], seen["creds"] = source.url, source.credentials
        return probe_readiness(StreamSource(str(video_12s)), **kw)

    def snap(source, zones, **kw):
        return capture_masked_snapshot(StreamSource(str(video_12s)), zones)

    agent, api, keys = make_agent(state_dir, [f"{private_ip}/32"], probe_fn=probe, snapshot_fn=snap)
    sealed = base64.b64encode(SealedBox(keys.box_key.public_key).encrypt(
        json.dumps({"username": "viewer", "password": "pa55:w@rd"}).encode())).decode()
    with FakeOnvif(private_ip) as dev:
        status, result, error = agent.execute("provision_camera", {
            "camera_id": "cam-7", "address": f"{private_ip}:{dev.port}", "stream_profile": "substream",
            "credential_sealed": sealed})
    assert (status, error) == ("succeeded", None), result
    assert result["readiness"] == "ready"
    rep = result["report"]
    assert rep["codec"] == "h264" and rep["decoded_seconds"] >= 10 and rep["snapshot"] == "uploaded"
    assert rep["onvif"]["device"]["manufacturer"] == "TestVendor" and rep["conformance"] == "onvif_profile_query_ok"
    assert seen["url"] == f"rtsp://{private_ip}:8554/test" and seen["creds"].username == "viewer"
    assert api.snapshots and api.snapshots[0][0] == "cam-7"
    blob = json.dumps(result)
    assert "pa55" not in blob and sealed not in blob
    assert "pa55" not in (state_dir / "edge.db").read_bytes().decode("latin-1")


def test_provision_bad_password_reports_auth_failed(state_dir, private_ip):
    agent, api, keys = make_agent(state_dir, [f"{private_ip}/32"], probe_fn=lambda *a, **k: pytest.fail("probed"))
    sealed = base64.b64encode(SealedBox(keys.box_key.public_key).encrypt(
        json.dumps({"username": "viewer", "password": "wrong"}).encode())).decode()
    with FakeOnvif(private_ip) as dev:
        status, result, error = agent.execute("provision_camera", {
            "camera_id": "cam-8", "address": f"{private_ip}:{dev.port}", "credential_sealed": sealed})
    assert (status, error) == ("failed", "auth_failed")
    assert result["readiness"] == "offline" and result["report"]["errors"] == ["auth_failed"]


def test_pairing_persists_identity(tmp_path, caplog):
    from retailguard_edge.config import ensure_state_dir
    sd = ensure_state_dir(tmp_path / "s")
    seen = {}

    def handler(req):
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json={"edge_id": "e-1", "org_id": "o-1", "store_id": "s-1",
                                         "store_timezone": "Asia/Tokyo", "allowed_subnets": ["192.168.10.0/24"],
                                         "api_version": 1})

    caplog.set_level(logging.DEBUG)
    state = pair("https://api.test", "PAIR-CODE-123", "Store 1 edge", sd, transport=httpx.MockTransport(handler))
    assert state.edge_id == "e-1" and load_pairing(sd).allowed_subnets == ["192.168.10.0/24"]
    keys = load_or_create_keys(sd)
    assert seen["body"]["sign_public_key"] == keys.sign_public_b64
    assert base64.b64decode(seen["body"]["box_public_key"]) == bytes(keys.box_key.public_key)
    assert seen["body"]["code"] == "PAIR-CODE-123" and seen["body"]["device_name"] == "Store 1 edge"
    assert "PAIR-CODE-123" not in caplog.text and "PAIR-CODE-123" not in (sd / "edge.json").read_text()
    assert stat.S_IMODE(os.stat(sd / "edge.json").st_mode) == 0o600
    with pytest.raises(IdentityError) as ei:
        pair("https://api.test", "x", "y", sd, transport=httpx.MockTransport(handler))
    assert ei.value.code == "already_paired"


def test_pairing_rejects_unsafe_subnets_and_plain_http(tmp_path):
    from retailguard_edge.config import ConfigError, ensure_state_dir
    sd = ensure_state_dir(tmp_path / "s")

    def handler(req):
        return httpx.Response(200, json={"edge_id": "e", "org_id": "o", "store_id": "s",
                                         "allowed_subnets": ["0.0.0.0/0"], "api_version": 1})

    with pytest.raises(IdentityError) as ei:
        pair("https://api.test", "c", "n", sd, transport=httpx.MockTransport(handler))
    assert ei.value.code == "pairing_response_invalid" and load_pairing(sd) is None
    with pytest.raises(ConfigError):
        pair("http://api.example.com", "c", "n", sd)


def test_run_loop_heartbeats_executes_commands_and_flushes_outbox(state_dir):
    import dataclasses
    import threading
    import time as _time

    from retailguard_edge.outbox import make_event_id
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"])
    agent.config = dataclasses.replace(agent.config, heartbeat_interval_s=0.1, command_poll_interval_s=0.1,
                                       outbox_flush_interval_s=0.1)
    ready_camera(agent)
    api.commands = [{"id": "cmd-loop", "kind": "gallery_update", "payload": {}}]
    events = []
    orig = api.__call__

    def with_events(req):
        if req.url.path == "/v1/edge/events":
            events.append(req.headers["Idempotency-Key"])
            return httpx.Response(200, json={"incident_id": "i"})
        return orig(req)

    agent.client._http._transport = httpx.MockTransport(with_events)
    eid = make_event_id("org-1", "cam-1", "t", 1.0, "behavior_candidate")
    agent.outbox.enqueue({"event_id": eid, "org_id": "org-1", "store_id": "store-1", "camera_id": "cam-1",
                          "channel": "behavior_candidate", "captured_at": "2026-10-11T00:00:00Z",
                          "model_version": "m", "preprocessing_version": "p", "gate_reason": "g",
                          "signals": {}, "evidence_state": "unavailable"})
    stop = threading.Event()
    t = threading.Thread(target=agent.run, args=(stop,))
    t.start()
    deadline = _time.time() + 10
    while _time.time() < deadline and (len(api.heartbeats) < 2 or not api.acks or not events):
        _time.sleep(0.05)
    stop.set()
    t.join(timeout=15)
    assert not t.is_alive()
    assert len(api.heartbeats) >= 2
    assert api.acks[0][0] == "cmd-loop" and api.acks[0][1]["error"] == "face_sdk_unavailable"
    assert events == [eid] and agent.outbox.pending_count() == 0
