"""Live view relay.

The camera's stream monitor (the one ffmpeg process that reads the camera, see watchdog.py) also
writes a short rolling HLS playlist into the state directory. H.264 cameras without privacy masks
are remuxed (no re-encoding); USB, H.265 and masked cameras are encoded to H.264, with privacy-mask
zones burned in so live video never shows what snapshots hide.

Segments leave the appliance only while someone is watching: the API lists the cameras with recent
viewer demand in its command-poll response and LiveRelay uploads the newest segments of those
cameras (signed requests). Nothing is uploaded otherwise.
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterable

from PIL import Image, ImageDraw

from .stream import privacy_polygons

log = logging.getLogger(__name__)

SEGMENT_S = 1
LIST_SIZE = 6
MAX_WIDTH = 960
TRANSCODE_FPS = 15
MAX_BEHIND = 2  # after a gap, only the newest segments are sent (latency over completeness)


def live_dir(state_dir: Path, camera_id: str) -> Path:
    return state_dir / "live" / camera_id


def write_privacy_mask(zones: Iterable[dict[str, Any]], width: int, height: int, path: Path) -> bool:
    """Opaque black privacy polygons on a transparent canvas of the camera's resolution."""
    polys = privacy_polygons(zones)
    if not polys:
        return False
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for poly in polys:
        draw.polygon([(x * width, y * height) for x, y in poly], fill=(0, 0, 0, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    return True


def hls_plan(camera: dict[str, Any], state_dir: Path) -> tuple[list[str], list[str]]:
    """(extra ffmpeg inputs, HLS output arguments) for a camera's monitor process."""
    out = live_dir(state_dir, camera["camera_id"])
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*"):
        if old.suffix in (".ts", ".m3u8", ".tmp"):
            old.unlink(missing_ok=True)
    report = camera.get("report") or {}
    width, height = report.get("width"), report.get("height")
    mask = out / "privacy-mask.png"
    masked = bool(width and height) and write_privacy_mask(camera.get("zones") or [], int(width), int(height), mask)
    if not masked:
        mask.unlink(missing_ok=True)
    uri = str(camera.get("stream_uri") or "")
    copy = report.get("codec") == "h264" and not masked and uri.startswith(("rtsp://", "rtsps://"))
    inputs: list[str] = []
    if copy:
        video = ["-map", "0:v:0", "-c:v", "copy"]
    else:
        scale = f"scale='min({MAX_WIDTH},iw)':-2,fps={TRANSCODE_FPS},format=yuv420p"
        if masked:
            inputs = ["-loop", "1", "-framerate", "1", "-i", str(mask)]
            graph = f"[0:v:0][1:v]overlay=0:0:shortest=1[m];[m]{scale}[live]"  # ends with the camera stream
        else:
            graph = f"[0:v:0]{scale}[live]"
        g = str(TRANSCODE_FPS * SEGMENT_S)
        video = ["-filter_complex", graph, "-map", "[live]", "-c:v", "libx264", "-preset", "veryfast",
                 "-tune", "zerolatency", "-g", g, "-keyint_min", g, "-sc_threshold", "0",
                 "-b:v", "1200k", "-maxrate", "1500k", "-bufsize", "3000k"]
    output = [*video, "-an", "-f", "hls", "-hls_time", str(SEGMENT_S), "-hls_list_size", str(LIST_SIZE),
              "-hls_flags", "delete_segments+independent_segments+temp_file",
              "-hls_segment_filename", str(out / "seg_%06d.ts"), str(out / "index.m3u8")]
    return inputs, output


def read_local_playlist(path: Path) -> list[tuple[str, float]]:
    """[(segment file name, duration)] from ffmpeg's rolling playlist; [] when absent/partial."""
    try:
        text = path.read_text("utf-8")
    except OSError:
        return []
    out, duration = [], None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF:"):
            try:
                duration = float(line[8:].split(",", 1)[0])
            except ValueError:
                duration = None
        elif line and not line.startswith("#") and duration is not None:
            if "/" not in line and "\\" not in line and line.endswith(".ts"):
                out.append((line, duration))
            duration = None
    return out


class _Uploader(threading.Thread):
    def __init__(self, relay: "LiveRelay", camera_id: str):
        super().__init__(name=f"live-{camera_id}", daemon=True)
        self.relay, self.camera_id = relay, camera_id
        self.stop_event = threading.Event()
        self.sent: set[tuple[str, int]] = set()
        self.last_number: int | None = None
        self.discontinuity = True

    def run(self) -> None:
        directory = live_dir(self.relay.state_dir, self.camera_id)
        while not self.stop_event.is_set():
            try:
                self.tick(directory)
            except Exception:  # noqa: BLE001 - keep relaying; the next tick retries
                log.exception("live upload for camera %s failed", self.camera_id)
            self.stop_event.wait(self.relay.poll_s)

    def tick(self, directory: Path) -> int:
        segments = read_local_playlist(directory / "index.m3u8")
        fresh = []
        for name, duration in segments:
            p = directory / name
            try:
                stat = p.stat()
            except OSError:
                continue
            key = (name, int(stat.st_mtime_ns))
            if key not in self.sent:
                fresh.append((name, duration, p, key))
        sent = 0
        for name, duration, p, key in fresh[-MAX_BEHIND:]:
            number = int("".join(ch for ch in name if ch.isdigit()) or 0)
            if self.last_number is not None and number <= self.last_number:
                self.discontinuity = True  # ffmpeg restarted and numbering began again
            try:
                data = p.read_bytes()
            except OSError:
                continue
            self.relay.upload(self.camera_id, self.relay.next_seq(), data, duration, self.discontinuity)
            self.sent.add(key)
            self.last_number, self.discontinuity = number, False
            sent += 1
        for name, duration, p, key in fresh[:-MAX_BEHIND]:
            self.sent.add(key)  # skipped to stay close to real time
        if len(self.sent) > 200:
            self.sent = set(list(self.sent)[-100:])
        return sent


class LiveRelay:
    """Uploads live segments for the cameras the API says are being watched."""

    def __init__(self, upload: Callable[[str, int, bytes, float, bool], Any], state_dir: Path, *,
                 poll_s: float = 0.5, clock: Callable[[], float] = time.time):
        self.upload, self.state_dir, self.poll_s, self.clock = upload, state_dir, poll_s, clock
        self._uploaders: dict[str, _Uploader] = {}
        self._lock = threading.Lock()
        self._last_seq = 0

    def next_seq(self) -> int:
        with self._lock:
            # Increasing across restarts of the agent (the API drops anything not newer).
            self._last_seq = max(self._last_seq + 1, int(self.clock() * 1000))
            return self._last_seq

    def set_demand(self, camera_ids: Iterable[str]) -> None:
        wanted = {c for c in camera_ids if isinstance(c, str) and c}
        with self._lock:
            for cid in list(self._uploaders):
                if cid not in wanted:
                    self._uploaders.pop(cid).stop_event.set()
            for cid in wanted:
                u = self._uploaders.get(cid)
                if u is None or not u.is_alive():
                    u = _Uploader(self, cid)
                    self._uploaders[cid] = u
                    u.start()

    def active(self) -> list[str]:
        with self._lock:
            return sorted(self._uploaders)

    def stop_all(self) -> None:
        self.set_demand([])
