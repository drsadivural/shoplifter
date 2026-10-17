from __future__ import annotations

import ipaddress
import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def _ffmpeg_testsrc(path: Path, seconds: int) -> Path:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", "testsrc=size=640x360:rate=15", "-t", str(seconds), "-c:v", "libx264", "-preset", "ultrafast",
         "-pix_fmt", "yuv420p", "-g", "15", str(path)],
        check=True)
    return path


@pytest.fixture(scope="session")
def ffmpeg_available() -> bool:
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        pytest.skip("ffmpeg/ffprobe not installed")
    return True


@pytest.fixture(scope="session")
def video_12s(tmp_path_factory, ffmpeg_available) -> Path:
    return _ffmpeg_testsrc(tmp_path_factory.mktemp("media") / "t12.mp4", 12)


@pytest.fixture(scope="session")
def video_3s(tmp_path_factory, ffmpeg_available) -> Path:
    return _ffmpeg_testsrc(tmp_path_factory.mktemp("media") / "t3.mp4", 3)


@pytest.fixture(scope="session")
def private_ip() -> str:
    """A non-loopback private IPv4 address of this host (cameras must be on private subnets)."""
    try:
        out = subprocess.run(["ip", "-j", "-4", "addr"], capture_output=True, check=True, text=True).stdout
        for iface in json.loads(out):
            for a in iface.get("addr_info", []):
                ip = ipaddress.ip_address(a["local"])
                if ip.is_private and not ip.is_loopback and not ip.is_link_local:
                    return str(ip)
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError):
        pass
    from retailguard_edge.discovery import local_ipv4_addresses  # Windows / no iproute2
    addrs = local_ipv4_addresses()
    if addrs:
        return addrs[0]
    pytest.skip("no private non-loopback IPv4 address on this host")


@pytest.fixture
def state_dir(tmp_path) -> Path:
    from retailguard_edge.config import ensure_state_dir
    return ensure_state_dir(tmp_path / "state")


def has_mode(path, mode: int) -> bool:
    """POSIX permission bits. On Windows they are not meaningful: the installer protects the data
    folder with an ACL (SYSTEM + Administrators), so only Linux checks the bits."""
    import os
    import stat
    return os.name == "nt" or stat.S_IMODE(os.stat(path).st_mode) == mode
