"""Real RTSP: mediamtx (docker) with authentication, ffmpeg publisher, edge readiness probe.

Skipped (not failed) when docker or the bluenviron/mediamtx image is unavailable.
"""
from __future__ import annotations

import base64
import io
import json
import shutil
import socket
import subprocess
import time
import uuid

import pytest
from nacl.public import SealedBox
from PIL import Image

from fake_onvif import FakeOnvif
from retailguard_edge.stream import StreamSource, capture_masked_snapshot, probe_readiness, validate_zones
from retailguard_edge.vault import Credentials
from retailguard_edge.watchdog import CameraHealth, StreamMonitor

IMAGE = "bluenviron/mediamtx:latest"
PORT = 18554
VIEWER = Credentials("viewer", "V!ew@pa$s#1&x")  # needs percent-encoding in the RTSP URL
CONFIG = """
logLevel: warn
rtspAddress: :8554
rtmp: no
hls: no
webrtc: no
srt: no
authInternalUsers:
  - user: publisher
    pass: pubsecret
    ips: []
    permissions:
      - action: publish
  - user: viewer
    pass: "V!ew@pa$s#1&x"
    ips: []
    permissions:
      - action: read
paths:
  all_others:
"""


def _docker_ok() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        subprocess.run(["docker", "image", "inspect", IMAGE], check=True, capture_output=True, timeout=20)
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False


pytestmark = [pytest.mark.docker, pytest.mark.skipif(not _docker_ok(), reason="docker/mediamtx image unavailable")]


def _wait_port(host: str, port: int, timeout: float = 15) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"{host}:{port} not listening")


@pytest.fixture(scope="module")
def rtsp_server(tmp_path_factory, video_12s, private_ip):
    cfg_dir = tmp_path_factory.mktemp("mediamtx")
    cfg_dir.chmod(0o755)
    cfg = cfg_dir / "mediamtx.yml"
    cfg.write_text(CONFIG)
    cfg.chmod(0o644)
    name = f"rgedge-test-mediamtx-{uuid.uuid4().hex[:8]}"
    subprocess.run(["docker", "run", "-d", "--rm", "--name", name,
                    "-p", f"127.0.0.1:{PORT}:8554", "-p", f"{private_ip}:{PORT}:8554",
                    "-v", f"{cfg}:/mediamtx.yml:ro", IMAGE], check=True, capture_output=True, timeout=60)
    publisher = None
    try:
        _wait_port("127.0.0.1", PORT)
        publisher = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-re", "-stream_loop", "-1",
             "-i", str(video_12s), "-c", "copy", "-f", "rtsp", "-rtsp_transport", "tcp",
             f"rtsp://publisher:pubsecret@127.0.0.1:{PORT}/test"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # wait until the path is readable
        deadline = time.time() + 20
        while time.time() < deadline:
            r = subprocess.run(["ffprobe", "-v", "error", "-rtsp_transport", "tcp", "-show_entries",
                                "stream=codec_name", "-of", "json",
                                StreamSource(f"rtsp://127.0.0.1:{PORT}/test", VIEWER).argv_url()],
                               capture_output=True, timeout=15)
            if r.returncode == 0 and b"h264" in r.stdout:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("RTSP stream never became readable")
        yield {"local": f"rtsp://127.0.0.1:{PORT}/test", "private": f"rtsp://{private_ip}:{PORT}/test"}
    finally:
        if publisher is not None:
            publisher.terminate()
            try:
                publisher.wait(timeout=10)
            except subprocess.TimeoutExpired:
                publisher.kill()
        subprocess.run(["docker", "stop", "-t", "2", name], capture_output=True, timeout=60)


def test_rtsp_readiness_ready(rtsp_server):
    r = probe_readiness(StreamSource(rtsp_server["local"], VIEWER), sample_seconds=10, required_seconds=10)
    assert r.readiness == "ready", r.to_dict()
    assert r.source == "rtsp" and (r.codec, r.width, r.height) == ("h264", 640, 360)
    assert r.fps == pytest.approx(15.0, abs=0.2) and r.decoded_seconds >= 10 and r.monotonic_time


def test_rtsp_wrong_password_is_auth_failed_and_redacted(rtsp_server):
    src = StreamSource(rtsp_server["local"], Credentials("viewer", "Wr0ng#Secret"))
    r = probe_readiness(src, sample_seconds=2, required_seconds=2)
    assert r.readiness == "offline" and r.errors == ["auth_failed"]
    assert "Wr0ng" not in json.dumps(r.to_dict())


def test_rtsp_unknown_path_offline(rtsp_server):
    r = probe_readiness(StreamSource(rtsp_server["local"] + "-missing", VIEWER), sample_seconds=2,
                        required_seconds=2)
    assert r.readiness == "offline" and r.frames_decoded == 0


def test_rtsp_snapshot_with_privacy_mask(rtsp_server):
    zones = validate_zones([{"id": "m", "type": "privacy_mask", "label": "till",
                             "points": [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]]}])
    jpeg = capture_masked_snapshot(StreamSource(rtsp_server["local"], VIEWER), zones)
    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    w, h = img.size
    masked = img.crop((w // 2 + 8, h // 2 + 8, w - 8, h - 8)).tobytes()
    open_ = img.crop((8, 8, w // 2 - 8, h // 2 - 8)).tobytes()
    assert sum(masked) / len(masked) < 4 and sum(open_) / len(open_) > 40


def test_rtsp_stream_monitor_marks_ready(rtsp_server):
    health = CameraHealth("cam-rtsp")
    mon = StreamMonitor(StreamSource(rtsp_server["local"], VIEWER), health)
    mon.start()
    seen_ready = False
    deadline = time.time() + 15
    while time.time() < deadline:
        if health.state == "ready":
            seen_ready = True
            break
        time.sleep(0.2)
    snap = health.snapshot()
    mon.stop()
    mon.join(timeout=10)
    assert seen_ready and snap["last_frame_at"] is not None and health.frames > 0


def test_agent_provision_end_to_end_onvif_plus_real_rtsp(rtsp_server, private_ip, state_dir):
    from test_agent import make_agent
    agent, api, keys = make_agent(state_dir, [f"{private_ip}/32"])
    sealed = base64.b64encode(SealedBox(keys.box_key.public_key).encrypt(
        json.dumps({"username": VIEWER.username, "password": VIEWER.password}).encode())).decode()
    with FakeOnvif(private_ip, username=VIEWER.username, password=VIEWER.password,
                   stream_uri=rtsp_server["private"]) as dev:
        status, result, error = agent.execute("provision_camera", {
            "camera_id": "cam-rtsp", "address": f"{private_ip}:{dev.port}", "stream_profile": "substream",
            "credential_sealed": sealed})
    assert (status, error) == ("succeeded", None), json.dumps(result)
    rep = result["report"]
    assert result["readiness"] == "ready" and rep["source"] == "rtsp" and rep["decoded_seconds"] >= 10
    assert rep["snapshot"] == "uploaded" and api.snapshots[0][1][:2] == b"\xff\xd8"
    assert VIEWER.password not in json.dumps(result)
    # activation still honest: no model installed
    st, res, _ = agent.execute("activate_camera", {"camera_id": "cam-rtsp", "channels": ["behavior"]})
    assert st == "succeeded" and res["channels"]["behavior"] == {"state": "unavailable",
                                                                  "reason": "model_not_installed"}
