import os

import pytest

from retailguard_edge.stream import StreamError, StreamSource, input_args, probe_readiness
from retailguard_edge.usb import list_usb_cameras
from test_agent import make_agent


def _sysfs(tmp_path):
    sys_root, dev_root = tmp_path / "sys", tmp_path / "dev"
    for node, name, index in (("video0", "HD Pro Webcam C920", "0"), ("video1", "HD Pro Webcam C920", "1"),
                              ("video2", "USB2.0 PC CAMERA", "0"), ("video10", "bcm2835-codec-decode", "0")):
        d = sys_root / node
        d.mkdir(parents=True)
        (d / "name").write_text(name + "\n")
        (d / "index").write_text(index + "\n")
        (dev_root / node).parent.mkdir(parents=True, exist_ok=True)
        (dev_root / node).write_text("")
    by_id = dev_root / "v4l" / "by-id"
    by_id.mkdir(parents=True)
    os.symlink(dev_root / "video0", by_id / "usb-046d_HD_Pro_Webcam_C920_ABC123-video-index0")
    os.symlink(dev_root / "video1", by_id / "usb-046d_HD_Pro_Webcam_C920_ABC123-video-index1")
    return str(sys_root), str(dev_root)


def test_lists_capture_nodes_with_stable_links(tmp_path):
    sys_root, dev_root = _sysfs(tmp_path)
    cams = list_usb_cameras(sys_root, dev_root)
    assert [c["device"] for c in cams] == [
        "/dev/v4l/by-id/usb-046d_HD_Pro_Webcam_C920_ABC123-video-index0", "/dev/video2", "/dev/video10"]
    assert cams[0]["name"] == "HD Pro Webcam C920" and cams[0]["node"] == "/dev/video0"
    assert list_usb_cameras(str(tmp_path / "missing"), dev_root) == []


def test_v4l2_source_arguments_are_restricted_to_device_paths():
    assert input_args(StreamSource("v4l2:/dev/video0")) == ["-f", "v4l2", "-i", "/dev/video0"]
    assert input_args(StreamSource("v4l2:/dev/v4l/by-id/usb-x-video-index0"))[-1] == "/dev/v4l/by-id/usb-x-video-index0"
    for bad in ("v4l2:/etc/passwd", "v4l2:/dev/../etc/shadow", "v4l2:/dev/video0;rm", "v4l2:-i"):
        with pytest.raises(StreamError):
            input_args(StreamSource(bad))
    rep = probe_readiness(StreamSource("v4l2:/etc/passwd"))
    assert rep.readiness == "offline" and rep.errors == ["invalid_device"] and rep.source == "v4l2"


def test_agent_discover_reports_usb_cameras_and_probes_all_interfaces(state_dir):
    seen = {}

    def fake_discover(interface, policy, **kw):
        seen["interface"] = interface
        return []

    usb = [{"device": "/dev/video0", "node": "/dev/video0", "name": "Webcam"}]
    agent, _, _ = make_agent(state_dir, ["192.168.10.0/24"], discover_fn=fake_discover, usb_fn=lambda: usb)
    status, result, error = agent.execute("discover", {"job_id": "j1", "timeout_s": 5, "include_usb": True})
    assert (status, error) == ("succeeded", None)
    assert seen["interface"] is None and result["usb_devices"] == usb and result["devices"] == []


def test_agent_provisions_usb_camera(state_dir, video_12s):
    seen = {}

    def probe(source, **kw):
        seen["url"] = source.url
        return probe_readiness(StreamSource(str(video_12s)), **kw)

    agent, api, _ = make_agent(state_dir, ["192.168.10.0/24"], probe_fn=probe,
                               snapshot_fn=lambda *a, **k: b"\xff\xd8jpeg", device_exists=lambda p: p == "/dev/video0",
                               onvif_factory=lambda *a, **k: pytest.fail("ONVIF used for USB"))
    status, result, error = agent.execute("provision_camera", {"camera_id": "usb-1", "address": "/dev/video0",
                                                               "source_type": "usb"})
    assert (status, error) == ("succeeded", None), result
    assert seen["url"] == "v4l2:/dev/video0" and result["report"]["conformance"] == "usb_v4l2"
    status, result, error = agent.execute("provision_camera", {"camera_id": "usb-2", "address": "/dev/video7",
                                                               "source_type": "usb"})
    assert (status, error) == ("failed", "device_not_found") and result["readiness"] == "offline"
    status, _, error = agent.execute("provision_camera", {"camera_id": "usb-3", "address": "/etc/passwd",
                                                          "source_type": "usb"})
    assert (status, error) == ("failed", "invalid_device")
