"""Analysis channel adapters and availability registry.

No model, SDK or POS integration ships with this package. Each channel
reports `unavailable` with an explicit reason unless a manifest is configured,
its artifact checksum verifies, its declared runtime module is importable and
its declared adapter class (supplied by the model/SDK integrator) loads and
implements `ChannelAdapter`. Nothing here produces scores or detections.

Manifest JSON (behavior model or face SDK):
  {
    "name": "...", "version": "...", "channel": "behavior" | "watchlist" | "checkout",
    "runtime": "<python module providing inference, e.g. the vendor runtime>",
    "adapter": "<python.module:ClassName implementing ChannelAdapter>",
    "artifact": "<path to weights/SDK library>", "sha256": "<hex>",
    "preprocessing_version": "...", "license_status": "..."
  }
"""
from __future__ import annotations

import abc
import hashlib
import importlib
import importlib.util
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

CHANNELS = ("behavior", "watchlist", "checkout")
NOT_INSTALLED_REASON = {
    "behavior": "model_not_installed",
    "watchlist": "face_sdk_unavailable",
    "checkout": "pos_unconfigured",
}


class ChannelAdapter(abc.ABC):
    """Interface an integrator implements for a real, licensed model/SDK.

    Implementations must fail closed: raise or report `unavailable`, never
    return a default/zero score or a fabricated detection.
    """

    channel: str

    @abc.abstractmethod
    def start(self, camera_id: str, zones: list[dict[str, Any]], policy: dict[str, Any]) -> None: ...

    @abc.abstractmethod
    def stop(self, camera_id: str) -> None: ...

    @abc.abstractmethod
    def health(self, camera_id: str) -> dict[str, Any]:
        """Return {"state": "starting"|"running"|"degraded"|"unavailable", "reason"?: str}."""


@dataclass(frozen=True)
class ChannelStatus:
    state: str
    reason: str | None = None

    def to_dict(self) -> dict[str, str]:
        return {"state": self.state, **({"reason": self.reason} if self.reason else {})}


@dataclass(frozen=True)
class Manifest:
    name: str
    version: str
    channel: str
    runtime: str
    adapter: str
    artifact: Path
    sha256: str
    preprocessing_version: str | None = None
    license_status: str | None = None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(path: Path) -> Manifest:
    data = json.loads(path.read_text("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("manifest must be an object")
    for key in ("name", "version", "channel", "runtime", "adapter", "artifact", "sha256"):
        if not isinstance(data.get(key), str) or not data[key]:
            raise ValueError(f"manifest field {key} missing")
    if data["channel"] not in CHANNELS:
        raise ValueError("manifest channel invalid")
    artifact = Path(data["artifact"])
    if not artifact.is_absolute():
        artifact = path.parent / artifact
    return Manifest(name=data["name"], version=data["version"], channel=data["channel"],
                    runtime=data["runtime"], adapter=data["adapter"], artifact=artifact,
                    sha256=data["sha256"].lower(), preprocessing_version=data.get("preprocessing_version"),
                    license_status=data.get("license_status"))


def module_importable(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


class ChannelRegistry:
    def __init__(self, *, model_manifest: Path | None = None, face_sdk_manifest: Path | None = None,
                 pos_config: Path | None = None):
        self._paths = {"behavior": model_manifest, "watchlist": face_sdk_manifest}
        self._pos_config = pos_config
        self._adapters: dict[str, ChannelAdapter] = {}
        self._manifests: dict[str, Manifest] = {}
        self._status: dict[str, ChannelStatus] = {}
        self.refresh()

    def _resolve(self, channel: str, path: Path | None) -> ChannelStatus:
        if path is None or not path.is_file():
            return ChannelStatus("unavailable", NOT_INSTALLED_REASON[channel])
        try:
            m = load_manifest(path)
        except (ValueError, OSError, json.JSONDecodeError) as exc:
            log.warning("%s manifest rejected: %s", channel, exc)
            return ChannelStatus("unavailable", "manifest_invalid")
        if m.channel != channel:
            return ChannelStatus("unavailable", "manifest_channel_mismatch")
        if not m.artifact.is_file():
            return ChannelStatus("unavailable", NOT_INSTALLED_REASON[channel])
        if sha256_file(m.artifact) != m.sha256:
            return ChannelStatus("unavailable", "artifact_checksum_mismatch")
        if not module_importable(m.runtime):
            return ChannelStatus("unavailable", "runtime_unavailable")
        mod_name, _, cls_name = m.adapter.partition(":")
        try:
            cls = getattr(importlib.import_module(mod_name), cls_name)
            if not (isinstance(cls, type) and issubclass(cls, ChannelAdapter)):
                raise TypeError("adapter does not implement ChannelAdapter")
            adapter = cls(m)  # integrator adapters take their manifest
        except Exception as exc:  # noqa: BLE001 - any adapter load failure => unavailable
            log.warning("%s adapter %s failed to load: %s", channel, m.adapter, type(exc).__name__)
            return ChannelStatus("unavailable", "adapter_unavailable")
        self._adapters[channel] = adapter
        self._manifests[channel] = m
        return ChannelStatus("available")

    def refresh(self) -> None:
        self._adapters.clear()
        self._manifests.clear()
        self._status = {ch: self._resolve(ch, self._paths.get(ch)) for ch in ("behavior", "watchlist")}
        # Checkout needs a POS lane integration AND a visual checkout model; neither ships here.
        if self._pos_config is None or not self._pos_config.is_file():
            self._status["checkout"] = ChannelStatus("unavailable", "pos_unconfigured")
        else:
            self._status["checkout"] = ChannelStatus("unavailable", "model_not_installed")

    def status(self, channel: str) -> ChannelStatus:
        if channel not in CHANNELS:
            return ChannelStatus("unavailable", "unknown_channel")
        return self._status[channel]

    def adapter(self, channel: str) -> ChannelAdapter | None:
        return self._adapters.get(channel)

    def models(self) -> list[dict[str, str]]:
        return [{"name": m.name, "version": m.version, "sha256": m.sha256} for m in self._manifests.values()]

    def manifest(self, channel: str) -> Manifest | None:
        return self._manifests.get(channel)

    def activate(self, camera_id: str, requested: list[str], zones: list[dict[str, Any]],
                 policy: dict[str, Any]) -> dict[str, dict[str, str]]:
        """Start each requested channel that is genuinely available; report the rest honestly."""
        result: dict[str, dict[str, str]] = {}
        for ch in CHANNELS:
            if ch not in requested:
                result[ch] = {"state": "not_requested"}
                continue
            st = self.status(ch)
            adapter = self._adapters.get(ch)
            if st.state != "available" or adapter is None:
                result[ch] = ChannelStatus("unavailable", st.reason or NOT_INSTALLED_REASON[ch]).to_dict()
                continue
            try:
                adapter.start(camera_id, zones, policy)
                health = adapter.health(camera_id)
                state = health.get("state")
                if state not in ("starting", "running", "degraded", "unavailable"):
                    state, reason = "unavailable", "adapter_health_invalid"
                else:
                    reason = health.get("reason")
                result[ch] = ChannelStatus(state, reason).to_dict()
            except Exception as exc:  # noqa: BLE001
                log.warning("channel %s failed to start on %s: %s", ch, camera_id, type(exc).__name__)
                result[ch] = ChannelStatus("unavailable", "adapter_start_failed").to_dict()
        return result

    def deactivate(self, camera_id: str) -> None:
        for adapter in self._adapters.values():
            try:
                adapter.stop(camera_id)
            except Exception:  # noqa: BLE001
                log.warning("adapter stop failed for %s", camera_id)


def coco17_to_model_layout(keypoints: Any) -> Any:
    """Pose-layout adapter placeholder.

    Requires upstream contract: the target model's keypoint order, neck
    construction, coordinate normalization and tensor layout must be read from
    the pinned upstream source and packaged with the model's preprocessing
    manifest (docs/ALGORITHMS.md step 3). It is deliberately not guessed here.
    """
    raise NotImplementedError(
        "COCO17 -> model keypoint mapping requires the upstream model's preprocessing contract "
        "(keypoint order, neck construction, normalization); not provided")
