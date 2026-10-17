"""Stream readiness probe, snapshot capture and privacy masking.

ffprobe/ffmpeg run as child processes with an argument list (never a shell).
Credentials are injected into the RTSP URL only inside the child's argv and
are redacted from every error string. A camera is "ready" only when at least
`required_seconds` of real frames were decoded with monotonic timestamps and a
supported codec; a handshake without decoded frames is never readiness.

Note: a child's argv is visible via /proc to processes allowed to see it; the
systemd unit runs the service as a dedicated user with ProtectProc=invisible.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import logging
import math
import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence
from urllib.parse import quote, urlsplit, urlunsplit

from PIL import Image, ImageDraw

from .redact import redact_text, redact_url
from .vault import Credentials

log = logging.getLogger(__name__)

SUPPORTED_CODECS = {"h264", "hevc"}
# USB cameras usually deliver MJPEG or raw YUV; the edge decodes them locally.
V4L2_CODECS = SUPPORTED_CODECS | {"mjpeg", "rawvideo"}
V4L2_SCHEME = "v4l2:"
# Linux: stable udev links or a numbered node; nothing else on the filesystem is accepted.
V4L2_DEVICE = re.compile(r"^/dev/(v4l/by-(id|path)/[A-Za-z0-9._:+-]{1,200}|video\d{1,3})$")
# Windows: "dshow:" + DirectShow device (alternative name "@device_pnp_..." or friendly name). No quotes,
# control characters or ":" (which would let a value name a second, audio device).
DSHOW_SCHEME = "dshow:"
DSHOW_DEVICE = re.compile(r'^dshow:[^":\x00-\x1f]{1,300}$')
# A USB camera's address as stored by the API: a Linux device path or a DirectShow device.
USB_DEVICE = re.compile(V4L2_DEVICE.pattern + "|" + DSHOW_DEVICE.pattern)
KEYFRAME_GRACE_S = 4.0
RTSP_IO_TIMEOUT_US = 5_000_000
MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024


class StreamError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class StreamSource:
    """A local file (diagnostics/tests), an RTSP URL without userinfo, or a USB camera
    ("v4l2:/dev/v4l/by-id/...")."""
    url: str
    credentials: Credentials | None = field(default=None, repr=False)

    @property
    def is_rtsp(self) -> bool:
        return urlsplit(self.url).scheme.lower() in ("rtsp", "rtsps")

    @property
    def is_v4l2(self) -> bool:
        return self.url.startswith(V4L2_SCHEME)

    @property
    def is_dshow(self) -> bool:
        return self.url.startswith(DSHOW_SCHEME)

    @property
    def is_usb(self) -> bool:
        return self.is_v4l2 or self.is_dshow

    @property
    def kind(self) -> str:
        return "rtsp" if self.is_rtsp else "v4l2" if self.is_v4l2 else "dshow" if self.is_dshow else "file"

    def dshow_device(self) -> str:
        if not DSHOW_DEVICE.match(self.url):
            raise StreamError("invalid_device", "not a DirectShow device")
        return self.url[len(DSHOW_SCHEME):]

    def v4l2_device(self) -> str:
        path = self.url[len(V4L2_SCHEME):]
        if not V4L2_DEVICE.match(path):
            raise StreamError("invalid_device", "not a V4L2 device path")
        return path

    def argv_url(self) -> str:
        """URL for the child process argv only (credentials injected, percent-encoded)."""
        if not self.is_rtsp or self.credentials is None:
            return self.url
        p = urlsplit(self.url)
        host = p.netloc.rsplit("@", 1)[-1]
        userinfo = f"{quote(self.credentials.username, safe='')}:{quote(self.credentials.password, safe='')}"
        return urlunsplit((p.scheme, f"{userinfo}@{host}", p.path, p.query, p.fragment))

    def secrets(self) -> list[str]:
        out = [self.argv_url()]
        if self.credentials:
            out.extend(self.credentials.secrets())
        return out

    def display(self) -> str:
        return redact_url(self.url)


def input_args(source: StreamSource) -> list[str]:
    if source.is_rtsp:
        return ["-rtsp_transport", "tcp", "-timeout", str(RTSP_IO_TIMEOUT_US),
                "-protocol_whitelist", "rtsp,rtsps,tcp,tls,udp,rtp,srtp", "-i", source.argv_url()]
    if source.is_v4l2:
        return ["-f", "v4l2", "-i", source.v4l2_device()]
    if source.is_dshow:
        return ["-f", "dshow", "-i", f"video={source.dshow_device()}"]
    return ["-protocol_whitelist", "file", "-i", source.url]


def classify_ffmpeg_error(stderr: str) -> str:
    s = stderr.lower()
    if "401 unauthorized" in s or "unauthorized" in s:
        return "auth_failed"
    if "404 not found" in s or "no such file" in s:
        return "stream_not_found"
    if "device or resource busy" in s:
        return "device_busy"
    if "permission denied" in s:
        return "device_permission_denied"
    if "connection refused" in s:
        return "unreachable"
    if "timed out" in s or "timeout" in s:
        return "unreachable"
    if "no route to host" in s or "network is unreachable" in s:
        return "unreachable"
    if "invalid data" in s:
        return "invalid_stream"
    return "probe_failed"


def _parse_rate(rate: str | None) -> float | None:
    if not rate or rate in ("0/0", "N/A"):
        return None
    try:
        if "/" in rate:
            n, d = rate.split("/", 1)
            return float(n) / float(d) if float(d) else None
        return float(rate)
    except ValueError:
        return None


@dataclass
class ReadinessReport:
    readiness: str
    checked_at: str
    source: str
    codec: str | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    declared_fps: float | None = None
    decoded_seconds: float = 0.0
    frames_decoded: int = 0
    monotonic_time: bool = False
    timestamp_issues: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)
    detail: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def evaluate_frames(stream_info: dict[str, Any], frames: list[dict[str, Any]], required_seconds: float,
                    supported_codecs: set[str] = SUPPORTED_CODECS) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    times: list[float] = []
    missing = 0
    leading_untimed = 0
    missing_at: list[int] = []
    for idx, f in enumerate(frames):
        t = f.get("best_effort_timestamp_time", f.get("pts_time"))
        try:
            v = float(t)
            if not math.isfinite(v):
                raise ValueError
            times.append(v)
        except (TypeError, ValueError):
            if not times:
                # Frames decoded at stream join, before the first timestamped frame (e.g. RTSP
                # before timing is established), are excluded rather than treated as gaps.
                leading_untimed += 1
                continue
            missing += 1
            missing_at.append(idx)
    non_increasing = sum(1 for a, b in zip(times, times[1:], strict=False) if b <= a)
    monotonic = bool(times) and missing == 0 and non_increasing == 0
    declared = _parse_rate(stream_info.get("avg_frame_rate")) or _parse_rate(stream_info.get("r_frame_rate"))
    measured = None
    if len(times) >= 2 and times[-1] > times[0]:
        measured = (len(times) - 1) / (times[-1] - times[0])
    frame_dur = 1.0 / (measured or declared) if (measured or declared) else 0.0
    decoded = (times[-1] - times[0] + frame_dur) if times else 0.0
    codec = stream_info.get("codec_name")
    width, height = stream_info.get("width"), stream_info.get("height")
    if not frames:
        errors.append("no_frames_decoded")
    else:
        if missing or not times:
            errors.append("missing_timestamps")
        if non_increasing:
            errors.append("non_monotonic_timestamps")
        if decoded + 1e-6 < required_seconds:
            errors.append("insufficient_decoded_seconds")
        if codec not in supported_codecs:
            errors.append("unsupported_codec")
        if not width or not height:
            errors.append("unknown_resolution")
        if measured is not None and measured < 1.0:
            errors.append("low_frame_rate")
    metrics = {
        "codec": codec, "width": width, "height": height,
        "fps": round(measured, 3) if measured else None,
        "declared_fps": round(declared, 3) if declared else None,
        "decoded_seconds": round(decoded, 3), "frames_decoded": len(times), "monotonic_time": monotonic,
        "timestamp_issues": {"leading_untimed": leading_untimed, "missing": missing,
                             "missing_first_index": missing_at[0] if missing_at else None,
                             "non_increasing": non_increasing},
    }
    return metrics, errors


def probe_readiness(source: StreamSource, *, sample_seconds: float = 10.0, required_seconds: float = 10.0,
                    ffprobe: str = "ffprobe", keyframe_grace_s: float = KEYFRAME_GRACE_S,
                    timeout_s: float | None = None) -> ReadinessReport:
    """Decode a bounded sample and decide readiness from real decoded frames."""
    checked_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    window = sample_seconds + keyframe_grace_s
    argv = [ffprobe, "-v", "error", "-hide_banner",
            "-select_streams", "v:0", "-read_intervals", f"%+{window:g}",
            "-show_entries",
            "stream=codec_name,width,height,avg_frame_rate,r_frame_rate:frame=best_effort_timestamp_time,pts_time",
            "-of", "json"]
    timeout = timeout_s if timeout_s is not None else window * 2 + 20
    secrets = source.secrets()
    report = ReadinessReport(readiness="offline", checked_at=checked_at,
                             source=source.kind)
    try:
        inputs = input_args(source)
    except StreamError as exc:
        report.errors.append(exc.code)
        return report
    argv += inputs
    try:
        proc = subprocess.run(argv, capture_output=True, timeout=timeout, check=False, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        report.errors.append("ffprobe_not_found")
        return report
    except subprocess.TimeoutExpired:
        report.errors.append("probe_timeout")
        return report
    stderr = redact_text(proc.stderr.decode("utf-8", "replace")[-2000:], secrets)
    try:
        data = json.loads(proc.stdout.decode("utf-8", "replace") or "{}")
    except json.JSONDecodeError:
        data = {}
    streams = data.get("streams") or []
    frames = data.get("frames") or []
    if proc.returncode != 0 and not frames:
        report.errors.append(classify_ffmpeg_error(stderr))
        report.detail = stderr.strip()[-500:] or None
        return report
    if not streams:
        report.errors.append("no_video_stream")
        report.detail = stderr.strip()[-500:] or None
        return report
    metrics, errors = evaluate_frames(streams[0], frames, required_seconds,
                                      V4L2_CODECS if source.is_usb else SUPPORTED_CODECS)
    for k, v in metrics.items():
        setattr(report, k, v)
    report.errors = errors
    if not frames:
        report.readiness = "offline"
    elif errors:
        report.readiness = "degraded"
    else:
        report.readiness = "ready"
    if stderr.strip() and errors:
        report.detail = stderr.strip()[-500:]
    return report


def capture_frame_jpeg(source: StreamSource, *, ffmpeg: str = "ffmpeg", timeout_s: float = 20.0) -> bytes:
    """Grab one decoded frame as JPEG bytes (kept in memory, never written unmasked)."""
    # -skip_frame nokey: decode keyframes only, so a mid-GOP join never yields a smeared frame.
    argv = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-skip_frame", "nokey", *input_args(source),
            "-map", "0:v:0", "-frames:v", "1", "-an", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "pipe:1"]
    try:
        proc = subprocess.run(argv, capture_output=True, timeout=timeout_s, check=False, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise StreamError("ffmpeg_not_found") from None
    except subprocess.TimeoutExpired:
        raise StreamError("snapshot_timeout") from None
    if proc.returncode != 0 or not proc.stdout:
        stderr = redact_text(proc.stderr.decode("utf-8", "replace")[-1000:], source.secrets())
        raise StreamError(classify_ffmpeg_error(stderr), stderr.strip()[-300:])
    if len(proc.stdout) > MAX_SNAPSHOT_BYTES:
        raise StreamError("snapshot_too_large")
    return proc.stdout


# ---- zones / privacy masks ----------------------------------------------
ZONE_TYPES = {"shelf", "checkout", "exit_line", "privacy_mask"}


class ZoneError(ValueError):
    pass


def validate_zones(zones: Any) -> list[dict[str, Any]]:
    if not isinstance(zones, list) or len(zones) > 256:
        raise ZoneError("zones must be a list (max 256)")
    out = []
    for z in zones:
        if not isinstance(z, dict) or z.get("type") not in ZONE_TYPES:
            raise ZoneError("invalid zone type")
        pts = z.get("points")
        min_pts = 2 if z["type"] == "exit_line" else 3
        if not isinstance(pts, list) or not min_pts <= len(pts) <= 64:
            raise ZoneError("invalid zone points")
        clean = []
        for p in pts:
            if (not isinstance(p, (list, tuple)) or len(p) != 2
                    or not all(isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c) and 0 <= c <= 1
                               for c in p)):
                raise ZoneError("zone points must be normalized [x, y] in [0, 1]")
            clean.append([float(p[0]), float(p[1])])
        if z.get("direction") not in (None, "in", "out"):
            raise ZoneError("invalid direction")
        out.append({**z, "points": clean})
    return out


def privacy_polygons(zones: Iterable[dict[str, Any]]) -> list[list[list[float]]]:
    return [z["points"] for z in zones if z.get("type") == "privacy_mask"]


def apply_privacy_masks(jpeg: bytes, polygons: Sequence[Sequence[Sequence[float]]], *, quality: int = 85) -> bytes:
    """Fill each normalized polygon black, re-encode JPEG without metadata."""
    with Image.open(io.BytesIO(jpeg)) as im:
        if im.width * im.height > 40_000_000:
            raise StreamError("snapshot_too_large")
        img = im.convert("RGB")
    draw = ImageDraw.Draw(img)
    w, h = img.size
    for poly in polygons:
        pts = [(x * (w - 1), y * (h - 1)) for x, y in poly]
        if len(pts) >= 3:
            draw.polygon(pts, fill=(0, 0, 0), outline=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def capture_masked_snapshot(source: StreamSource, zones: list[dict[str, Any]], *, ffmpeg: str = "ffmpeg",
                            out_path: Path | None = None) -> bytes:
    masked = apply_privacy_masks(capture_frame_jpeg(source, ffmpeg=ffmpeg), privacy_polygons(zones))
    if out_path is not None:
        from .config import write_private_file
        write_private_file(out_path, masked)
    return masked
