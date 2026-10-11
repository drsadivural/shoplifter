import pytest

from retailguard_edge.watchdog import CameraHealth


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_state_machine_degraded_10s_offline_30s():
    c = Clock()
    h = CameraHealth("cam", clock=c, wall=lambda: 1.76e9)
    assert h.state == "starting"
    c.t += 5
    h.on_frames(10, fps=15.0)
    assert h.state == "ready" and h.snapshot()["fps"] == 15.0
    c.t += 9.9
    assert h.state == "ready"
    c.t += 0.2
    assert h.state == "degraded"
    c.t += 20
    assert h.state == "offline"
    h.on_frames(20)
    assert h.state == "ready" and h.snapshot()["last_frame_at"] == "2025-10-09T08:53:20Z"


def test_no_frames_ever_goes_degraded_then_offline():
    c = Clock()
    h = CameraHealth("cam", clock=c)
    c.t += 10
    assert h.state == "degraded"
    c.t += 20
    assert h.state == "offline"
    assert h.snapshot()["readiness"] == "offline"


def test_reconnect_backoff_exponential_with_jitter_and_reset():
    c = Clock()
    h = CameraHealth("cam", clock=c, backoff_base_s=1, backoff_max_s=60, rng=lambda: 1.0)
    delays = [h.on_disconnect("unreachable") for _ in range(8)]
    assert delays == [1, 2, 4, 8, 16, 32, 60, 60]
    assert not h.reconnect_due()
    c.t += 60
    assert h.reconnect_due()
    h.on_frames(5)
    assert h.failures == 0
    assert h.on_disconnect("stream_ended") == 1
    h2 = CameraHealth("cam", clock=c, rng=lambda: 0.25, backoff_base_s=4)
    assert h2.on_disconnect("x") == 1.0  # jitter scales the window


def test_invalid_thresholds():
    with pytest.raises(ValueError):
        CameraHealth("c", degraded_after_s=30, offline_after_s=10)
