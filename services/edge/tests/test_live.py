import json
import time

import httpx
from PIL import Image

from retailguard_edge.live import LiveRelay, hls_plan, live_dir, read_local_playlist
from retailguard_edge.stream import StreamSource
from retailguard_edge.watchdog import CameraHealth, StreamMonitor
from test_agent import make_agent, ready_camera

MASK = {"id": "m1", "type": "privacy_mask", "label": "Till", "points": [[0.0, 0.0], [0.5, 0.0], [0.5, 0.5], [0.0, 0.5]]}


def cam(**over):
    base = {"camera_id": "cam-1", "stream_uri": "rtsp://192.168.10.20:554/s", "zones": [],
            "report": {"codec": "h264", "width": 640, "height": 360}}
    base.update(over)
    return base


def test_hls_plan_remuxes_h264_and_encodes_usb_hevc_or_masked(tmp_path):
    inputs, out = hls_plan(cam(), tmp_path)
    assert inputs == [] and out[out.index("-c:v") + 1] == "copy" and "-filter_complex" not in out
    assert out[-1] == str(live_dir(tmp_path, "cam-1") / "index.m3u8") and "delete_segments" in out[out.index("-hls_flags") + 1]
    for camera in (cam(report={"codec": "hevc", "width": 1920, "height": 1080}),
                   cam(stream_uri="v4l2:/dev/video0", report={"codec": "mjpeg", "width": 1280, "height": 720})):
        inputs, out = hls_plan(camera, tmp_path)
        assert inputs == [] and out[out.index("-c:v") + 1] == "libx264"
    inputs, out = hls_plan(cam(zones=[MASK]), tmp_path)
    mask = live_dir(tmp_path, "cam-1") / "privacy-mask.png"
    assert inputs == ["-loop", "1", "-framerate", "1", "-i", str(mask)] and "overlay" in out[out.index("-filter_complex") + 1]
    img = Image.open(mask)
    assert img.size == (640, 360) and img.getpixel((10, 10)) == (0, 0, 0, 255) and img.getpixel((600, 300))[3] == 0


def test_read_local_playlist_ignores_paths_and_partial_entries(tmp_path):
    p = tmp_path / "index.m3u8"
    p.write_text("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.000000,\nseg_000001.ts\n#EXTINF:0.960,\n"
                 "../../etc/passwd.ts\n#EXTINF:1.04,\nseg_000002.ts\n#EXTINF:1.0,\n")
    assert read_local_playlist(p) == [("seg_000001.ts", 1.0), ("seg_000002.ts", 1.04)]
    assert read_local_playlist(tmp_path / "missing.m3u8") == []


def test_monitor_writes_real_hls_and_relay_uploads_only_when_watched(tmp_path, video_12s):
    """The camera monitor (same ffmpeg process that measures liveness) produces live segments; the
    relay sends the newest ones while the camera is in demand and nothing otherwise."""
    camera = cam(stream_uri=str(video_12s), report={"codec": "h264", "width": 640, "height": 360}, zones=[MASK])
    inputs, out = hls_plan(camera, tmp_path)
    mon = StreamMonitor(StreamSource(str(video_12s)), CameraHealth("cam-1"), extra_inputs=inputs, extra_output=out)
    assert mon._run_once() == "stream_ended"
    segs = read_local_playlist(live_dir(tmp_path, "cam-1") / "index.m3u8")
    assert 3 <= len(segs) <= 6 and all(0.5 <= d <= 2.5 for _, d in segs)
    uploads = []
    relay = LiveRelay(lambda *a: uploads.append(a), tmp_path, poll_s=0.05)
    time.sleep(0.2)
    assert uploads == []                               # nobody watching: nothing leaves the appliance
    relay.set_demand(["cam-1"])
    for _ in range(40):
        if len(uploads) >= 2:
            break
        time.sleep(0.05)
    relay.stop_all()
    assert len(uploads) == 2                           # only the newest segments (latency over backlog)
    (cid, seq1, data, duration, discontinuity), (_, seq2, _, _, disc2) = uploads
    assert cid == "cam-1" and data[0] == 0x47 and seq2 > seq1 and discontinuity is True and disc2 is False


def test_streaming_only_mode_refuses_analysis_and_follows_the_console(state_dir):
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"], mode="streaming")
    ready_camera(agent)
    status, result, error = agent.execute("activate_camera", {"camera_id": "cam-1", "channels": ["behavior"]})
    assert (status, error) == ("failed", "edge_streaming_only")
    assert result["channels"]["behavior"] == {"state": "unavailable", "reason": "streaming_only"}
    status, result, _ = agent.execute("set_processing_mode", {"mode": "full"})
    assert status == "succeeded" and result == {"processing_mode": "full"}
    assert json.loads((state_dir / "mode.json").read_text()) == {"processing_mode": "full"}
    status, result, _ = agent.execute("activate_camera", {"camera_id": "cam-1", "channels": ["behavior"]})
    assert status == "succeeded" and result["channels"]["behavior"]["reason"] == "model_not_installed"
    assert agent.execute("set_processing_mode", {"mode": "cloud"})[2] == "invalid_payload"
    agent.heartbeat()
    assert api.heartbeats[-1]["processing_mode"] == "full"
    # the console switched it back to streaming only: the heartbeat response is authoritative
    orig = api.__call__

    def streaming(req):
        resp = orig(req)
        if req.url.path == "/v1/edge/heartbeat":
            return httpx.Response(200, json={"ok": True, "processing_mode": "streaming"}, headers=resp.headers)
        return resp
    from retailguard_edge.client import EdgeClient
    agent.client = EdgeClient("https://api.test", "edge-1", agent.keys.signing_key,
                              transport=httpx.MockTransport(streaming), sleep=lambda s: None)
    agent.heartbeat()
    assert agent.mode == "streaming" and agent.store.camera("cam-1")["analysis_state"] == "unavailable"


def test_command_poll_carries_live_demand(state_dir):
    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"])
    calls = []
    agent.live.set_demand = lambda ids: calls.append(list(ids))
    api.live = ["cam-9"]
    agent.poll_commands()
    assert calls == [["cam-9"]]
