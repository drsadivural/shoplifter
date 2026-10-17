"""Per-camera health state machine and stream supervisor.

States: "starting" -> "ready" on frames; "degraded" after `degraded_after_s`
without a frame; "offline" after `offline_after_s`. Reconnects use
exponential backoff with full jitter, reset when frames flow again.
The clock and RNG are injectable for deterministic tests.
"""
from __future__ import annotations

import datetime as dt
import logging
import random
import subprocess
import threading
import time
from typing import Callable

from .redact import redact_text
from .stream import StreamSource, classify_ffmpeg_error, input_args

log = logging.getLogger(__name__)


class CameraHealth:
    def __init__(self, camera_id: str, *, clock: Callable[[], float] = time.monotonic,
                 wall: Callable[[], float] = time.time, degraded_after_s: float = 10.0,
                 offline_after_s: float = 30.0, backoff_base_s: float = 1.0, backoff_max_s: float = 60.0,
                 rng: Callable[[], float] = random.random):
        if not 0 < degraded_after_s < offline_after_s:
            raise ValueError("require 0 < degraded_after_s < offline_after_s")
        self.camera_id = camera_id
        self._clock, self._wall, self._rng = clock, wall, rng
        self.degraded_after_s, self.offline_after_s = degraded_after_s, offline_after_s
        self.backoff_base_s, self.backoff_max_s = backoff_base_s, backoff_max_s
        self._lock = threading.Lock()
        self._started = clock()
        self._last_frame: float | None = None
        self.last_frame_wall: float | None = None
        self.frames = 0
        self.failures = 0
        self.last_error: str | None = None
        self.next_attempt_at: float = self._started
        self.fps: float | None = None

    def on_frames(self, total_frames: int, fps: float | None = None) -> None:
        with self._lock:
            if total_frames > self.frames or (total_frames < self.frames and total_frames > 0):
                self._last_frame = self._clock()
                self.last_frame_wall = self._wall()
                self.failures = 0
                self.last_error = None
            self.frames = total_frames
            if fps is not None and fps > 0:
                self.fps = fps

    def on_frame(self) -> None:
        self.on_frames(self.frames + 1)

    def on_disconnect(self, error: str) -> float:
        """Record a failure and return the delay before the next reconnect attempt."""
        with self._lock:
            self.last_error = error
            delay = self._rng() * min(self.backoff_max_s, self.backoff_base_s * (2 ** self.failures))
            self.failures += 1
            self.frames = 0
            self.next_attempt_at = self._clock() + delay
            return delay

    def reconnect_due(self) -> bool:
        return self._clock() >= self.next_attempt_at

    @property
    def state(self) -> str:
        with self._lock:
            now = self._clock()
            ref = self._last_frame if self._last_frame is not None else self._started
            silent = now - ref
            if self._last_frame is None and silent < self.degraded_after_s:
                return "starting"
            if silent >= self.offline_after_s:
                return "offline"
            if silent >= self.degraded_after_s:
                return "degraded"
            return "ready" if self._last_frame is not None else "starting"

    def snapshot(self) -> dict:
        state = self.state
        last = (dt.datetime.fromtimestamp(self.last_frame_wall, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if self.last_frame_wall else None)
        return {"readiness": state, "last_frame_at": last, "fps": self.fps,
                "error": self.last_error if state != "ready" else None}


class StreamMonitor(threading.Thread):
    """Keeps one ffmpeg decoder per camera (-f null, -progress) feeding CameraHealth.

    The decoder runs only to measure liveness; frames are discarded. Analysis
    channels attach their own consumers when a real model is installed.
    """

    def __init__(self, source: StreamSource, health: CameraHealth, *, ffmpeg: str = "ffmpeg",
                 stop_event: threading.Event | None = None, extra_inputs: list[str] | None = None,
                 extra_output: list[str] | None = None):
        super().__init__(name=f"monitor-{health.camera_id}", daemon=True)
        self.source, self.health, self.ffmpeg = source, health, ffmpeg
        # e.g. the live view's HLS output (live.hls_plan): same decoder, no second camera connection.
        self.extra_inputs, self.extra_output = list(extra_inputs or []), list(extra_output or [])
        self.stop_event = stop_event or threading.Event()
        self._proc: subprocess.Popen[bytes] | None = None

    def argv(self) -> list[str]:
        return [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-progress", "pipe:1",
                "-stats_period", "1", *input_args(self.source), *self.extra_inputs,
                "-map", "0:v:0", "-an", "-f", "null", "-", *self.extra_output]

    def stop(self) -> None:
        self.stop_event.set()
        proc = self._proc
        if proc and proc.poll() is None:
            proc.terminate()

    def _run_once(self) -> str:
        try:
            self._proc = subprocess.Popen(self.argv(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                          stdin=subprocess.DEVNULL)
        except FileNotFoundError:
            return "ffmpeg_not_found"
        proc = self._proc
        assert proc.stdout is not None and proc.stderr is not None
        fps = None
        for raw in proc.stdout:
            if self.stop_event.is_set():
                proc.terminate()
                break
            line = raw.decode("utf-8", "replace").strip()
            key, _, val = line.partition("=")
            if key == "fps":
                try:
                    fps = float(val)
                except ValueError:
                    fps = None
            elif key == "frame":
                try:
                    self.health.on_frames(int(val), fps)
                except ValueError:
                    pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        stderr = redact_text(proc.stderr.read().decode("utf-8", "replace")[-1000:], self.source.secrets())
        return classify_ffmpeg_error(stderr) if proc.returncode else "stream_ended"

    def run(self) -> None:
        while not self.stop_event.is_set():
            if not self.health.reconnect_due():
                self.stop_event.wait(0.5)
                continue
            error = self._run_once()
            if self.stop_event.is_set():
                break
            delay = self.health.on_disconnect(error)
            log.info("camera %s stream ended (%s); reconnect in %.1fs", self.health.camera_id, error, delay)
