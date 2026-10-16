"""USB (V4L2) camera enumeration on the edge appliance.

Lists video capture nodes from sysfs and prefers the stable udev link (/dev/v4l/by-id/...) so a
camera keeps its identity when /dev/videoN numbering changes after a replug or reboot. Only the
first node of each device (index 0) is listed; the extra nodes UVC drivers create carry metadata.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .stream import V4L2_DEVICE


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None


def list_usb_cameras(sys_root: str = "/sys/class/video4linux", dev_root: str = "/dev") -> list[dict[str, Any]]:
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
    return out[:32]
