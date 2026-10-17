"""USB camera enumeration on the edge appliance.

Linux (V4L2): video capture nodes from sysfs, preferring the stable udev link
(/dev/v4l/by-id/...) so a camera keeps its identity when /dev/videoN numbering changes after a
replug or reboot. Only the first node of each device (index 0) is listed; the extra nodes UVC
drivers create carry metadata.

Windows (DirectShow): video devices reported by `ffmpeg -list_devices true -f dshow`. The
device's alternative name ("@device_pnp_...") is used as its identity because friendly names
repeat when two identical cameras are attached.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

from .stream import DSHOW_DEVICE, DSHOW_SCHEME, V4L2_DEVICE

MAX_DEVICES = 32
_DSHOW_DEVICE_LINE = re.compile(r'\]\s+"(?P<name>[^"]+)"(?:\s+\((?P<kind>video|audio|none)\))?\s*$')
_DSHOW_ALT_LINE = re.compile(r'\]\s+Alternative name\s+"(?P<alt>[^"]+)"\s*$')
_DSHOW_SECTION = re.compile(r"DirectShow (?P<kind>video|audio) devices", re.I)


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None


def list_v4l2_cameras(sys_root: str = "/sys/class/video4linux", dev_root: str = "/dev") -> list[dict[str, Any]]:
    sys_dir = Path(sys_root)
    if not sys_dir.is_dir():
        return []
    links: dict[str, str] = {}
    for sub in ("v4l/by-id", "v4l/by-path"):
        d = Path(dev_root) / sub
        if not d.is_dir():
            continue
        for link in sorted(d.iterdir()):
            try:
                target = os.path.realpath(link)
            except OSError:
                continue
            # by-id wins over by-path; the first stable link per node is kept.
            links.setdefault(os.path.basename(target), f"/dev/{sub}/{link.name}")
    out = []
    for node in sorted(sys_dir.iterdir(), key=lambda p: (len(p.name), p.name)):
        if not node.name.startswith("video") or not node.name[5:].isdigit():
            continue
        index = _read(node / "index")
        if index not in (None, "0"):
            continue
        device = links.get(node.name, f"/dev/{node.name}")
        if not V4L2_DEVICE.match(device):
            continue
        name = (_read(node / "name") or node.name)[:100]
        out.append({"device": device, "node": f"/dev/{node.name}", "name": name})
    return out[:MAX_DEVICES]


def parse_dshow_devices(stderr: str) -> list[dict[str, Any]]:
    """Parse `ffmpeg -list_devices true -f dshow -i dummy` output (old and new layouts)."""
    out: list[dict[str, Any]] = []
    section: str | None = None
    current: dict[str, Any] | None = None
    for line in stderr.splitlines():
        m = _DSHOW_SECTION.search(line)
        if m:
            section = m.group("kind").lower()
            continue
        m = _DSHOW_ALT_LINE.search(line)
        if m:
            if current is not None:
                current["alt"] = m.group("alt")
            continue
        m = _DSHOW_DEVICE_LINE.search(line)
        if m:
            kind = m.group("kind") or section
            current = {"name": m.group("name"), "alt": None} if kind == "video" else None
            if current is not None:
                out.append(current)
    cams = []
    for d in out:
        device = DSHOW_SCHEME + (d["alt"] or d["name"])
        if DSHOW_DEVICE.match(device):
            cams.append({"device": device, "node": d["name"], "name": d["name"][:100]})
    return cams[:MAX_DEVICES]


def list_dshow_cameras(ffmpeg: str = "ffmpeg", timeout_s: float = 15.0) -> list[dict[str, Any]]:
    try:
        proc = subprocess.run([ffmpeg, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
                              capture_output=True, timeout=timeout_s, check=False, stdin=subprocess.DEVNULL)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    return parse_dshow_devices(proc.stderr.decode("utf-8", "replace"))


def list_usb_cameras(ffmpeg: str = "ffmpeg") -> list[dict[str, Any]]:
    return list_dshow_cameras(ffmpeg) if os.name == "nt" else list_v4l2_cameras()


def usb_device_present(address: str, ffmpeg: str = "ffmpeg") -> bool:
    if address.startswith(DSHOW_SCHEME):
        return any(c["device"] == address for c in list_dshow_cameras(ffmpeg))
    return os.path.exists(address)
