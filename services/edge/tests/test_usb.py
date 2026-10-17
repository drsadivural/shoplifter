import os

import pytest

from retailguard_edge.stream import StreamError, StreamSource, input_args, probe_readiness
from retailguard_edge.usb import list_v4l2_cameras, parse_dshow_devices
from test_agent import make_agent


needs_symlinks = pytest.mark.skipif(os.name == "nt", reason="sysfs/udev layout is Linux-only")


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


@needs_symlinks
def test_lists_capture_nodes_with_stable_links(tmp_path):
    sys_root, dev_root = _sysfs(tmp_path)
    cams = list_v4l2_cameras(sys_root, dev_root)
    assert [c["device"] for c in cams] == [
        "/dev/v4l/by-id/usb-046d_HD_Pro_Webcam_C920_ABC123-video-index0", "/dev/video2", "/dev/video10"]
    assert cams[0]["name"] == "HD Pro Webcam C920" and cams[0]["node"] == "/dev/video0"
    assert list_v4l2_cameras(str(tmp_path / "missing"), dev_root) == []


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


DSHOW_NEW = r"""[dshow @ 000001c8] "Integrated Camera" (video)
[dshow @ 000001c8]   Alternative name "@device_pnp_\\?\usb#vid_04f2&pid_b6be&mi_00#6&2e0c5b07&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\global"
[dshow @ 000001c8] "OBS Virtual Camera" (none)
[dshow @ 000001c8] "Microphone (Realtek(R) Audio)" (audio)
[dshow @ 000001c8]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\wave_{1}"
dummy: Immediate exit requested
"""

DSHOW_OLD = r"""[dshow @ 0000] DirectShow video devices (some may be both video and audio devices)
[dshow @ 0000]  "USB2.0 HD UVC WebCam"
[dshow @ 0000]     Alternative name "@device_pnp_\\?\usb#vid_0bda&pid_58c2&mi_00#6&1a2b3c&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\global"
[dshow @ 0000] DirectShow audio devices
[dshow @ 0000]  "Microphone Array"
"""


def test_parses_directshow_video_devices_only():
    cams = parse_dshow_devices(DSHOW_NEW)
    assert [c["name"] for c in cams] == ["Integrated Camera"]
    assert cams[0]["device"].startswith("dshow:@device_pnp_") and cams[0]["device"].endswith("\\global")
    old = parse_dshow_devices(DSHOW_OLD)
    assert [c["name"] for c in old] == ["USB2.0 HD UVC WebCam"] and old[0]["device"].startswith("dshow:@device_pnp_")
    assert parse_dshow_devices("") == []


def test_dshow_source_arguments():
    dev = r"dshow:@device_pnp_\\?\usb#vid_04f2&pid_b6be#{65e8773d}\global"
    assert input_args(StreamSource(dev)) == ["-f", "dshow", "-i", "video=" + dev[len("dshow:"):]]
    for bad in ('dshow:cam" -i x', "dshow:video=a:audio=b", "dshow:", "dshow:a\nb"):
        with pytest.raises(StreamError):
            input_args(StreamSource(bad))
