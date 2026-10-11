import io
import time

import pytest
from PIL import Image

from retailguard_edge.stream import (StreamSource, ZoneError, apply_privacy_masks, capture_frame_jpeg,
                                     capture_masked_snapshot, evaluate_frames, probe_readiness, validate_zones)
from retailguard_edge.watchdog import CameraHealth, StreamMonitor


def test_12s_file_is_ready_with_measured_properties(video_12s):
    r = probe_readiness(StreamSource(str(video_12s)), sample_seconds=10, required_seconds=10)
    assert r.readiness == "ready", r.to_dict()
    assert (r.codec, r.width, r.height) == ("h264", 640, 360)
    assert r.fps == pytest.approx(15.0, abs=0.01) and r.declared_fps == pytest.approx(15.0)
    assert r.decoded_seconds >= 10.0 and r.frames_decoded >= 150
    assert r.monotonic_time is True and r.errors == []


def test_3s_file_is_not_ready(video_3s):
    r = probe_readiness(StreamSource(str(video_3s)), sample_seconds=10, required_seconds=10)
    assert r.readiness == "degraded"
    assert "insufficient_decoded_seconds" in r.errors
    assert 2.9 <= r.decoded_seconds <= 3.1 and r.frames_decoded == 45


def test_missing_file_is_offline(tmp_path, ffmpeg_available):
    r = probe_readiness(StreamSource(str(tmp_path / "nope.mp4")))
    assert r.readiness == "offline" and r.frames_decoded == 0 and r.errors


def test_non_monotonic_and_codec_rules():
    info = {"codec_name": "h264", "width": 640, "height": 360, "avg_frame_rate": "10/1"}
    frames = [{"best_effort_timestamp_time": str(t / 10)} for t in range(120)]
    metrics, errors = evaluate_frames(info, frames, 10)
    assert errors == [] and metrics["monotonic_time"]
    frames[50]["best_effort_timestamp_time"] = "0.1"
    _, errors = evaluate_frames(info, frames, 10)
    assert "non_monotonic_timestamps" in errors
    _, errors = evaluate_frames({**info, "codec_name": "mjpeg"}, frames[:10], 10)
    assert "unsupported_codec" in errors and "insufficient_decoded_seconds" in errors
    _, errors = evaluate_frames(info, [], 10)
    assert errors == ["no_frames_decoded"]
    # untimed frames at stream join are excluded; an untimed frame mid-stream is an error
    frames = [{"best_effort_timestamp_time": str(t / 10)} for t in range(120)]
    metrics, errors = evaluate_frames(info, [{}] + frames, 10)
    assert errors == [] and metrics["timestamp_issues"]["leading_untimed"] == 1 and metrics["frames_decoded"] == 120
    frames[60] = {}
    metrics, errors = evaluate_frames(info, frames, 10)
    assert errors == ["missing_timestamps"] and metrics["timestamp_issues"]["missing_first_index"] == 60
    assert metrics["monotonic_time"] is False
    _, errors = evaluate_frames(info, [{}, {}], 10)
    assert "missing_timestamps" in errors


def test_privacy_mask_blacks_out_region(video_12s):
    raw = capture_frame_jpeg(StreamSource(str(video_12s)))
    zones = validate_zones([
        {"id": "z1", "type": "privacy_mask", "label": "office", "points": [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]},
        {"id": "z2", "type": "shelf", "label": "shelf", "points": [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9]]},
    ])
    masked = capture_masked_snapshot(StreamSource(str(video_12s)), zones)
    before = Image.open(io.BytesIO(raw)).convert("RGB")
    after = Image.open(io.BytesIO(masked)).convert("RGB")
    assert after.size == (640, 360)
    w, h = after.size

    def mean(img, box):
        data = img.crop(box).tobytes()  # RGB bytes
        return sum(data) / len(data)
    inside = (8, 8, w // 2 - 8, h // 2 - 8)
    outside = (w // 2 + 8, 8, w - 8, h // 2 - 8)
    assert mean(before, inside) > 40  # testsrc is colorful there
    assert mean(after, inside) < 4  # masked: black (allowing JPEG noise)
    assert abs(mean(after, outside) - mean(before, outside)) < 8  # unmasked region preserved
    # shelf zones are not masks
    assert mean(after, (int(0.65 * w), int(0.65 * h), int(0.85 * w), int(0.85 * h))) > 20


def test_masked_snapshot_written_0600(tmp_path, video_12s):
    import os
    import stat
    p = tmp_path / "snap.jpg"
    capture_masked_snapshot(StreamSource(str(video_12s)), [], out_path=p)
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert Image.open(p).format == "JPEG"


def test_apply_masks_strips_metadata():
    img = Image.new("RGB", (100, 100), (200, 200, 200))
    buf = io.BytesIO()
    exif = Image.Exif()
    exif[0x010F] = "CameraMaker"
    img.save(buf, format="JPEG", exif=exif)
    out = apply_privacy_masks(buf.getvalue(), [[[0, 0], [1, 0], [1, 1]]])
    assert b"CameraMaker" not in out


@pytest.mark.parametrize("zones", [
    "x", [{"type": "door", "points": [[0, 0], [1, 0], [1, 1]]}],
    [{"type": "privacy_mask", "points": [[0, 0], [1.5, 0], [1, 1]]}],
    [{"type": "privacy_mask", "points": [[0, 0], [1, 0]]}],
    [{"type": "privacy_mask", "points": [[0, 0], [float("nan"), 0], [1, 1]]}],
    [{"type": "exit_line", "points": [[0, 0], [1, 1]], "direction": "sideways"}],
])
def test_invalid_zones_rejected(zones):
    with pytest.raises(ZoneError):
        validate_zones(zones)


def test_stream_monitor_counts_real_frames_then_reports_end(video_3s):
    health = CameraHealth("cam", backoff_base_s=30)  # long backoff: one run only
    mon = StreamMonitor(StreamSource(str(video_3s)), health)
    mon.start()
    deadline = time.time() + 20
    while time.time() < deadline and health.failures == 0:
        time.sleep(0.1)
    mon.stop()
    mon.join(timeout=10)
    assert health.last_frame_wall is not None  # real frames were observed
    assert health.last_error == "stream_ended" and health.failures == 1
