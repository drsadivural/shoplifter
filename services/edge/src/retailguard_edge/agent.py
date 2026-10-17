"""Edge agent: heartbeat, command polling/execution/acks, outbox replay, camera supervision.

Command results are honest: a channel without an installed model/SDK/POS
integration is acked as `unavailable` with a reason; a camera is never
reported analyzing because its record exists.
"""
from __future__ import annotations

import json
import logging
import shutil
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable

from . import __version__
from .client import EdgeAPIError, EdgeClient
from .config import EdgeConfig, write_private_file
from .discovery import discover as ws_discover
from .identity import (MODES, EdgeKeys, PairingState, load_mode, save_mode, subnet_policy,
                       update_allowed_subnets)
from .live import LiveRelay, hls_plan
from .netpolicy import TargetNotPermitted
from .onvif import OnvifClient, OnvifError, address_host, device_service_url, probe_device
from .outbox import Outbox
from .pipeline import CHANNELS, ChannelRegistry
from .stream import (DSHOW_SCHEME, USB_DEVICE, V4L2_SCHEME, ReadinessReport, StreamError, StreamSource,
                     ZoneError, capture_masked_snapshot, probe_readiness, validate_zones)
from .usb import list_usb_cameras, usb_device_present
from .vault import CredentialVault, VaultError
from .watchdog import CameraHealth, StreamMonitor

log = logging.getLogger(__name__)

COMMAND_KINDS = ("discover", "provision_camera", "activate_camera", "pause_camera", "update_zones",
                 "model_rollout", "gallery_update", "set_processing_mode")
RTSP_SCHEMES = frozenset({"rtsp", "rtsps"})


class CommandFailed(Exception):
    def __init__(self, code: str, result: dict[str, Any] | None = None):
        super().__init__(code)
        self.code = code
        self.result = result or {}


class EdgeStore:
    """Local SQLite state: provisioned cameras and processed commands."""

    def __init__(self, path: Path):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS cameras (camera_id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, kind TEXT NOT NULL,
                status TEXT NOT NULL, result TEXT NOT NULL, error TEXT, acked INTEGER NOT NULL DEFAULT 0,
                processed_at REAL NOT NULL);
        """)

    def close(self) -> None:
        self._db.close()

    def camera(self, camera_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT data FROM cameras WHERE camera_id=?", (camera_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def cameras(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT data FROM cameras ORDER BY camera_id").fetchall()
        return [json.loads(r[0]) for r in rows]

    def put_camera(self, data: dict[str, Any]) -> None:
        with self._lock:
            self._db.execute("INSERT INTO cameras(camera_id, data) VALUES (?, ?) ON CONFLICT(camera_id) "
                             "DO UPDATE SET data=excluded.data", (data["camera_id"], json.dumps(data, sort_keys=True)))

    def command(self, command_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT kind, status, result, error, acked FROM commands WHERE command_id=?",
                                   (command_id,)).fetchone()
        if not row:
            return None
        return {"kind": row[0], "status": row[1], "result": json.loads(row[2]), "error": row[3], "acked": bool(row[4])}

    def record_command(self, command_id: str, kind: str, status: str, result: dict, error: str | None) -> None:
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO commands(command_id, kind, status, result, error, acked, processed_at) "
                             "VALUES (?,?,?,?,?,0,?)", (command_id, kind, status, json.dumps(result), error, time.time()))

    def mark_acked(self, command_id: str) -> None:
        with self._lock:
            self._db.execute("UPDATE commands SET acked=1 WHERE command_id=?", (command_id,))

    def unacked(self) -> list[tuple[str, str, dict, str | None]]:
        with self._lock:
            rows = self._db.execute("SELECT command_id, status, result, error FROM commands WHERE acked=0 "
                                    "ORDER BY processed_at").fetchall()
        return [(r[0], r[1], json.loads(r[2]), r[3]) for r in rows]


class CameraSupervisor:
    def __init__(self, config: EdgeConfig, vault: CredentialVault | None):
        self.config, self.vault = config, vault
        self._monitors: dict[str, StreamMonitor] = {}
        self._lock = threading.Lock()

    def ensure(self, camera: dict[str, Any]) -> None:
        if not self.config.monitor_streams or camera.get("readiness") != "ready" or not camera.get("stream_uri"):
            return
        cid = camera["camera_id"]
        with self._lock:
            mon = self._monitors.get(cid)
            if mon is not None and mon.is_alive():
                return
            creds = self.vault.get(cid) if self.vault else None
            health = CameraHealth(cid, degraded_after_s=self.config.degraded_after_s,
                                  offline_after_s=self.config.offline_after_s)
            live_in: list[str] = []
            live_out: list[str] = []
            if self.config.live_relay:
                try:
                    live_in, live_out = hls_plan(camera, self.config.state_dir)
                except OSError as exc:
                    log.warning("live view disabled for camera %s: %s", cid, exc)
            mon = StreamMonitor(StreamSource(camera["stream_uri"], creds), health, ffmpeg=self.config.ffmpeg_path,
                                extra_inputs=live_in, extra_output=live_out)
            self._monitors[cid] = mon
            mon.start()

    def restart(self, camera: dict[str, Any]) -> None:
        """Re-create the camera's monitor, e.g. so new privacy masks apply to the live view."""
        self.stop(camera["camera_id"])
        self.ensure(camera)

    def stop(self, camera_id: str) -> None:
        with self._lock:
            mon = self._monitors.pop(camera_id, None)
        if mon:
            mon.stop()

    def stop_all(self) -> None:
        for cid in list(self._monitors):
            self.stop(cid)

    def health(self, camera_id: str) -> dict[str, Any] | None:
        mon = self._monitors.get(camera_id)
        return mon.health.snapshot() if mon else None


def _req_str(payload: dict, key: str, max_len: int = 200) -> str:
    v = payload.get(key)
    if not isinstance(v, str) or not v.strip() or len(v) > max_len:
        raise CommandFailed("invalid_payload", {"field": key})
    return v.strip()


class Agent:
    def __init__(self, config: EdgeConfig, keys: EdgeKeys, pairing: PairingState, client: EdgeClient, *,
                 vault: CredentialVault | None = None, registry: ChannelRegistry | None = None,
                 outbox: Outbox | None = None, store: EdgeStore | None = None,
                 supervisor: CameraSupervisor | None = None,
                 discover_fn: Callable[..., list[dict]] = ws_discover,
                 probe_fn: Callable[..., ReadinessReport] = probe_readiness,
                 snapshot_fn: Callable[..., bytes] = capture_masked_snapshot,
                 onvif_factory: Callable[..., OnvifClient] = OnvifClient,
                 usb_fn: Callable[[], list[dict]] | None = None,
                 device_exists: Callable[[str], bool] | None = None):
        self.config, self.keys, self.pairing, self.client = config, keys, pairing, client
        self.policy = subnet_policy(pairing)
        sd = config.state_dir
        self.vault = vault or CredentialVault(sd, keys.box_key)
        self.registry = registry or ChannelRegistry(model_manifest=config.model_manifest,
                                                    face_sdk_manifest=config.face_sdk_manifest,
                                                    pos_config=config.pos_config)
        self.outbox = outbox or Outbox(sd, config.disk_budget_bytes)
        self.store = store or EdgeStore(sd / "edge.db")
        self.supervisor = supervisor or CameraSupervisor(config, self.vault)
        self.mode = load_mode(sd, config.processing_mode)
        self.live = LiveRelay(lambda *a: self.client.upload_live_segment(*a), sd)
        self._discover, self._probe, self._snapshot, self._onvif = discover_fn, probe_fn, snapshot_fn, onvif_factory
        self._usb = usb_fn or (lambda: list_usb_cameras(config.ffmpeg_path))
        self._device_exists = device_exists or (lambda a: usb_device_present(a, config.ffmpeg_path))
        self.handlers: dict[str, Callable[[dict], dict]] = {
            "discover": self._cmd_discover,
            "provision_camera": self._cmd_provision,
            "activate_camera": self._cmd_activate,
            "pause_camera": self._cmd_pause,
            "update_zones": self._cmd_update_zones,
            "model_rollout": self._cmd_model_rollout,
            "gallery_update": self._cmd_gallery_update,
            "set_processing_mode": self._cmd_set_processing_mode,
        }

    # ---- commands ---------------------------------------------------------
    def execute(self, kind: str, payload: Any) -> tuple[str, dict[str, Any], str | None]:
        handler = self.handlers.get(kind)
        if handler is None:
            return "failed", {}, "unsupported_command"
        if not isinstance(payload, dict):
            return "failed", {}, "invalid_payload"
        try:
            return "succeeded", handler(payload), None
        except CommandFailed as exc:
            return "failed", exc.result, exc.code
        except TargetNotPermitted as exc:
            return "failed", {"detail": exc.reason}, "target_not_permitted"
        except Exception as exc:  # noqa: BLE001 - report, never crash the loop
            log.exception("command %s failed unexpectedly", kind)
            return "failed", {}, f"internal_error:{type(exc).__name__}"

    def process_command(self, cmd: dict[str, Any]) -> None:
        cid, kind = cmd.get("id"), cmd.get("kind")
        if not isinstance(cid, str) or not cid:
            log.warning("ignoring command without id")
            return
        prior = self.store.command(cid)
        if prior is None:
            log.info("executing command %s kind=%s", cid, kind)
            status, result, error = self.execute(str(kind), cmd.get("payload"))
            self.store.record_command(cid, str(kind), status, result, error)
        else:  # re-delivered: re-ack the recorded outcome, do not re-execute
            status, result, error = prior["status"], prior["result"], prior["error"]
        self._ack(cid, status, result, error)

    def _ack(self, cid: str, status: str, result: dict, error: str | None) -> None:
        try:
            self.client.ack_command(cid, status, result, error)
            self.store.mark_acked(cid)
            log.info("acked command %s status=%s%s", cid, status, f" error={error}" if error else "")
        except EdgeAPIError as exc:
            log.warning("ack for %s failed (%s); will retry", cid, exc.code)

    def poll_commands(self) -> int:
        for cid, status, result, error in self.store.unacked():
            self._ack(cid, status, result, error)
        items = self.client.get_commands()
        self.live.set_demand(self.client.live_demand)
        for cmd in items:
            if isinstance(cmd, dict):
                self.process_command(cmd)
        return len(items)

    def _cmd_discover(self, p: dict) -> dict:
        # No interface: probe from every private interface of the appliance.
        interface = p.get("interface") or self.config.discovery_interface or None
        if interface is not None and not isinstance(interface, str):
            raise CommandFailed("invalid_payload", {"field": "interface"})
        timeout = p.get("timeout_s", 5)
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 1 <= timeout <= 30:
            raise CommandFailed("invalid_payload", {"field": "timeout_s"})
        cidr = p.get("cidr")
        if cidr is not None and not isinstance(cidr, str):
            raise CommandFailed("invalid_payload", {"field": "cidr"})
        try:
            devices = self._discover(interface, self.policy, timeout=float(timeout), cidr=cidr or None)
        except ValueError as exc:
            raise CommandFailed("invalid_interface", {"detail": str(exc)[:200]}) from None
        except OSError as exc:
            raise CommandFailed("discovery_socket_error", {"detail": type(exc).__name__}) from None
        result: dict[str, Any] = {"devices": devices}
        if p.get("include_usb"):
            try:
                result["usb_devices"] = self._usb()
            except OSError as exc:
                result["usb_devices"], result["usb_error"] = [], type(exc).__name__
        if isinstance(p.get("job_id"), str):
            result["job_id"] = p["job_id"]
        return result

    def _cmd_provision(self, p: dict) -> dict:
        camera_id = _req_str(p, "camera_id")
        address = _req_str(p, "address", 500)
        source_type = p.get("source_type") or "onvif"
        if source_type not in ("onvif", "rtsp", "usb"):
            raise CommandFailed("invalid_payload", {"field": "source_type"})
        stream_profile = p.get("stream_profile") or "substream"
        if stream_profile not in ("substream", "mainstream"):
            raise CommandFailed("invalid_payload", {"field": "stream_profile"})
        rtsp_path = p.get("rtsp_path")
        if rtsp_path is not None and (not isinstance(rtsp_path, str) or len(rtsp_path) > 500
                                      or any(c in rtsp_path for c in "@\r\n\x00 ")):
            raise CommandFailed("invalid_payload", {"field": "rtsp_path"})

        def offline(code: str, detail: str | None = None) -> CommandFailed:
            report = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "codec": None,
                      "width": None, "height": None, "fps": None, "decoded_seconds": 0.0,
                      "monotonic_time": False, "errors": [code], **({"detail": detail} if detail else {})}
            self._save_camera(camera_id, address=address, readiness="offline", report=report,
                              stream_profile=stream_profile)
            return CommandFailed(code, {"readiness": "offline", "report": report})

        self.supervisor.stop(camera_id)  # re-provisioning replaces any running liveness monitor
        device_url: str | None = None
        onvif_info: dict[str, Any] = {}
        stream_uri: str | None = None
        if source_type == "usb":
            # Local USB camera (V4L2 / DirectShow): no network target, no credentials.
            if not USB_DEVICE.match(address):
                raise offline("invalid_device")
            if not self._device_exists(address):
                raise offline("device_not_found")
            creds = None
            stream_uri = address if address.startswith(DSHOW_SCHEME) else V4L2_SCHEME + address
            conformance = "usb_v4l2"
        elif source_type == "rtsp":
            # RTSP URL entered by the operator: no ONVIF negotiation.
            scheme = p.get("rtsp_scheme") or "rtsp"
            port = p.get("rtsp_port") or (322 if scheme == "rtsps" else 554)
            if scheme not in RTSP_SCHEMES:
                raise CommandFailed("invalid_payload", {"field": "rtsp_scheme"})
            if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
                raise CommandFailed("invalid_payload", {"field": "rtsp_port"})
            host = address_host(address)
            if ":" in host:
                host = f"[{host}]"
            path = rtsp_path or "/"
            path = path if path.startswith("/") else "/" + path
            stream_uri = f"{scheme}://{host}:{port}{path}"
            try:
                self.policy.check_url(stream_uri, RTSP_SCHEMES)
            except TargetNotPermitted as exc:
                raise offline("target_not_permitted", exc.reason) from None
            if p.get("credential_sealed"):
                try:
                    self.vault.store_sealed(camera_id, p["credential_sealed"])
                except VaultError as exc:
                    raise offline(exc.code) from None
            creds = self.vault.get(camera_id)
            conformance = "generic_rtsp"
        else:
            device_url = device_service_url(address)
            try:
                self.policy.check_url(device_url, {"http", "https"})
            except TargetNotPermitted as exc:
                raise offline("target_not_permitted", exc.reason) from None
            if p.get("credential_sealed"):
                try:
                    self.vault.store_sealed(camera_id, p["credential_sealed"])
                except VaultError as exc:
                    raise offline(exc.code) from None
            creds = self.vault.get(camera_id)

            conformance = "unverified"
            try:
                with self._onvif(device_url, self.policy, creds, timeout=self.config.request_timeout_s) as oc:
                    info = probe_device(oc, stream_profile)
                stream_uri = info["stream_uri"]
                conformance = info["conformance"]
                onvif_info = {k: info.get(k) for k in ("device", "time", "media_service", "selected_profile",
                                                        "auth_method", "snapshot_uri")}
            except OnvifError as exc:
                onvif_info = {"error": exc.code, "detail": exc.detail}
                if exc.code in ("auth_failed", "clock_skew", "target_not_permitted") or not rtsp_path:
                    raise offline(exc.code, exc.detail) from None
                host = address_host(address)
                if ":" in host:
                    host = f"[{host}]"
                path = rtsp_path if rtsp_path.startswith("/") else "/" + rtsp_path
                stream_uri = f"rtsp://{host}:554{path}"
                conformance = "unverified_generic_rtsp"
            try:
                self.policy.check_url(stream_uri, RTSP_SCHEMES)
            except TargetNotPermitted as exc:
                raise offline("target_not_permitted", exc.reason) from None

        source = StreamSource(stream_uri, creds)
        report = self._probe(source, sample_seconds=self.config.sample_seconds,
                             required_seconds=self.config.required_decoded_seconds,
                             ffprobe=self.config.ffprobe_path)
        rep = report.to_dict()
        rep.update({"onvif": onvif_info, "conformance": conformance})
        prev = self.store.camera(camera_id) or {}
        zones = prev.get("zones", [])
        snapshot_state = "not_attempted"
        if report.frames_decoded > 0:
            try:
                jpeg = self._snapshot(source, zones, ffmpeg=self.config.ffmpeg_path)
                self.client.upload_snapshot(camera_id, jpeg)
                snapshot_state = "uploaded"
            except StreamError as exc:
                snapshot_state = f"failed:{exc.code}"
            except EdgeAPIError as exc:
                snapshot_state = f"upload_failed:{exc.code}"
        rep["snapshot"] = snapshot_state
        cam = self._save_camera(camera_id, address=address, readiness=report.readiness, report=rep,
                                stream_profile=stream_profile, stream_uri=stream_uri, device_url=device_url)
        result = {"readiness": report.readiness, "report": rep}
        if report.readiness != "ready":
            raise CommandFailed(report.errors[0] if report.errors else "not_ready", result)
        self.supervisor.ensure(cam)
        return result

    def _save_camera(self, camera_id: str, **fields: Any) -> dict[str, Any]:
        cam = self.store.camera(camera_id) or {
            "camera_id": camera_id, "zones": [], "zones_version": None, "analysis_state": "unavailable",
            "channels": {ch: {"state": "not_requested"} for ch in CHANNELS}}
        cam.update({k: v for k, v in fields.items() if v is not None})
        if fields.get("readiness") and fields["readiness"] != "ready":
            cam["analysis_state"] = "unavailable"
        self.store.put_camera(cam)
        return cam

    def _camera_or_fail(self, p: dict) -> dict[str, Any]:
        camera_id = _req_str(p, "camera_id")
        cam = self.store.camera(camera_id)
        if cam is None:
            raise CommandFailed("camera_unknown")
        return cam

    def _cmd_activate(self, p: dict) -> dict:
        cam = self._camera_or_fail(p)
        requested = p.get("channels") or []
        if not isinstance(requested, list) or any(c not in CHANNELS for c in requested):
            raise CommandFailed("invalid_payload", {"field": "channels"})
        policy = p.get("policy") or {}
        if not isinstance(policy, dict):
            raise CommandFailed("invalid_payload", {"field": "policy"})
        try:
            zones = validate_zones(p["zones"]) if "zones" in p and p["zones"] is not None else cam.get("zones", [])
        except ZoneError as exc:
            raise CommandFailed("invalid_zones", {"detail": str(exc)}) from None
        if self.mode != "full":
            channels = {ch: ({"state": "unavailable", "reason": "streaming_only"} if ch in requested
                             else {"state": "not_requested"}) for ch in CHANNELS}
            raise CommandFailed("edge_streaming_only", {"channels": channels, "analysis_state": "unavailable"})
        if cam.get("readiness") != "ready":
            channels = {ch: ({"state": "unavailable", "reason": "camera_not_ready"} if ch in requested
                             else {"state": "not_requested"}) for ch in CHANNELS}
            raise CommandFailed("camera_not_ready", {"channels": channels, "analysis_state": "unavailable"})
        channels = self.registry.activate(cam["camera_id"], requested, zones, policy)
        analysis = "analyzing" if any(c["state"] in ("starting", "running") for c in channels.values()) else "unavailable"
        cam.update({"channels": channels, "analysis_state": analysis, "zones": zones, "policy": policy})
        self.store.put_camera(cam)
        self.supervisor.ensure(cam)
        return {"channels": channels, "analysis_state": analysis}

    def _cmd_pause(self, p: dict) -> dict:
        cam = self._camera_or_fail(p)
        self.registry.deactivate(cam["camera_id"])
        channels = {ch: {"state": "not_requested"} for ch in CHANNELS}
        cam.update({"analysis_state": "paused", "channels": channels})
        self.store.put_camera(cam)
        return {"analysis_state": "paused", "channels": channels}

    def _cmd_update_zones(self, p: dict) -> dict:
        cam = self._camera_or_fail(p)
        version = p.get("zones_version")
        if not isinstance(version, int) or isinstance(version, bool):
            raise CommandFailed("invalid_payload", {"field": "zones_version"})
        try:
            zones = validate_zones(p.get("zones"))
        except ZoneError as exc:
            raise CommandFailed("invalid_zones", {"detail": str(exc)}) from None
        masks_changed = [z for z in cam.get("zones", []) if z.get("type") == "privacy_mask"] != \
            [z for z in zones if z.get("type") == "privacy_mask"]
        cam.update({"zones": zones, "zones_version": version})
        self.store.put_camera(cam)
        if masks_changed:
            self.supervisor.restart(cam)  # the live view burns privacy masks in
        return {"zones_version": version}

    def apply_mode(self, mode: str) -> None:
        """Streaming only: stop every analysis channel; the cameras keep streaming for live view."""
        if mode not in MODES or mode == self.mode:
            return
        save_mode(self.config.state_dir, mode)
        self.mode = mode
        log.info("processing mode is now %s", mode)
        if mode == "streaming":
            for cam in self.store.cameras():
                self.registry.deactivate(cam["camera_id"])
                cam.update({"analysis_state": "unavailable",
                            "channels": {ch: {"state": "not_requested"} for ch in CHANNELS}})
                self.store.put_camera(cam)

    def _cmd_set_processing_mode(self, p: dict) -> dict:
        mode = p.get("mode")
        if mode not in MODES:
            raise CommandFailed("invalid_payload", {"field": "mode"})
        self.apply_mode(mode)
        return {"processing_mode": self.mode}

    def _cmd_model_rollout(self, p: dict) -> dict:
        # The edge never downloads or fabricates a model. It reports whether the
        # requested model is installed locally (manifest + checksum + runtime + adapter).
        name, version = p.get("name"), p.get("version")
        self.registry.refresh()
        for ch in CHANNELS:
            m = self.registry.manifest(ch)
            if m and m.name == name and m.version == version and (not p.get("sha256") or p["sha256"] == m.sha256):
                return {"name": m.name, "version": m.version, "sha256": m.sha256, "channel": ch, "state": "installed"}
        channel = p.get("channel") if p.get("channel") in CHANNELS else "behavior"
        st = self.registry.status(channel)
        raise CommandFailed("model_not_installed", {"name": name, "version": version, "state": "unavailable",
                                                    "reason": st.reason or "model_not_installed"})

    def _cmd_gallery_update(self, p: dict) -> dict:
        # Payload may reference face templates/photos: never logged or persisted here.
        st = self.registry.status("watchlist")
        adapter = self.registry.adapter("watchlist")
        if st.state != "available" or adapter is None:
            raise CommandFailed("face_sdk_unavailable", {"state": "unavailable", "reason": "face_sdk_unavailable"})
        update = getattr(adapter, "update_gallery", None)
        if not callable(update):
            raise CommandFailed("gallery_update_unsupported", {"state": "unavailable",
                                                               "reason": "adapter_lacks_gallery_update"})
        return update(p)

    # ---- heartbeat ---------------------------------------------------------
    def camera_health(self, cam: dict[str, Any]) -> dict[str, Any]:
        report = cam.get("report") or {}
        entry: dict[str, Any] = {
            "camera_id": cam["camera_id"],
            "readiness": cam.get("readiness", "pending"),
            "analysis_state": cam.get("analysis_state", "unavailable"),
            "channels": cam.get("channels", {}),
        }
        for k in ("fps", "width", "height", "codec"):
            if report.get(k) is not None:
                entry[k] = report[k]
        live = self.supervisor.health(cam["camera_id"])
        if live is not None:
            if live["readiness"] != "starting":
                entry["readiness"] = live["readiness"]
            if live.get("last_frame_at"):
                entry["last_frame_at"] = live["last_frame_at"]
            if live.get("fps"):
                entry["fps"] = live["fps"]
            if live.get("error"):
                entry["error"] = live["error"]
        elif report.get("errors"):
            entry["error"] = report["errors"][0]
        if entry["readiness"] != "ready" and entry["analysis_state"] == "analyzing":
            entry["analysis_state"] = "degraded"
        return entry

    def heartbeat_body(self) -> dict[str, Any]:
        usage = shutil.disk_usage(self.config.state_dir)
        health: dict[str, Any] = {
            "disk_free_bytes": usage.free,
            "disk_total_bytes": usage.total,
            "spool_pending": self.outbox.pending_count(),
        }
        age = self.outbox.oldest_pending_age_s()
        if age is not None:
            health["queue_age_s"] = round(age, 1)
        body: dict[str, Any] = {
            "software_version": __version__,
            "health": health,
            "cameras": [self.camera_health(c) for c in self.store.cameras()],
            "models": self.registry.models(),
            "processing_mode": self.mode,
        }
        if self.client.last_clock_offset_ms is not None:
            body["clock_offset_ms"] = self.client.last_clock_offset_ms
        return body

    def heartbeat(self) -> dict[str, Any]:
        body = self.heartbeat_body()
        resp = self.client.heartbeat(body)
        if isinstance(resp, dict) and resp.get("processing_mode") in MODES:
            self.apply_mode(resp["processing_mode"])  # the console's choice wins
        subnets = resp.get("allowed_subnets") if isinstance(resp, dict) else None
        if isinstance(subnets, list) and subnets != self.pairing.allowed_subnets:
            # Camera subnets are managed by the API; changes apply without re-pairing.
            try:
                self.pairing = update_allowed_subnets(self.config.state_dir, self.pairing, subnets)
                self.policy = subnet_policy(self.pairing)
                log.info("allowed camera subnets updated: %s", ", ".join(subnets) or "none")
            except (ValueError, TypeError) as exc:
                log.warning("ignored invalid allowed_subnets from API: %s", exc)
        status = {"at": time.time(), "heartbeat": body, "response": resp,
                  "outbox": {"pending": self.outbox.pending_count(), "dead": self.outbox.dead_count(),
                             "disk_pressure": self.outbox.disk_pressure}}
        write_private_file(self.config.state_dir / "status.json", json.dumps(status, indent=2).encode())
        return resp

    # ---- main loop ---------------------------------------------------------
    def _command_loop(self, stop: threading.Event) -> None:
        while not stop.is_set():
            try:
                self.poll_commands()
            except EdgeAPIError as exc:
                log.warning("command poll failed: %s", exc.code)
            except Exception:  # noqa: BLE001
                log.exception("command loop error")
            stop.wait(self.config.command_poll_interval_s)

    def run(self, stop: threading.Event) -> None:
        for cam in self.store.cameras():
            self.supervisor.ensure(cam)
        worker = threading.Thread(target=self._command_loop, args=(stop,), name="commands", daemon=True)
        worker.start()
        next_hb = next_flush = 0.0
        try:
            while not stop.is_set():
                now = time.monotonic()
                if now >= next_hb:
                    try:
                        self.heartbeat()
                    except EdgeAPIError as exc:
                        if exc.status == 401:
                            log.error("API rejected edge signature (revoked edge or clock outside +/-300 s)")
                        else:
                            log.warning("heartbeat failed: %s", exc.code)
                    except Exception:  # noqa: BLE001
                        log.exception("heartbeat error")
                    next_hb = now + self.config.heartbeat_interval_s
                if now >= next_flush:
                    try:
                        self.outbox.enforce_budget()
                        stats = self.outbox.flush(self.client)
                        if any(stats.values()):
                            log.info("outbox flush %s", stats)
                    except Exception:  # noqa: BLE001
                        log.exception("outbox flush error")
                    next_flush = now + self.config.outbox_flush_interval_s
                stop.wait(max(0.2, min(next_hb, next_flush) - time.monotonic()))
        finally:
            stop.set()
            self.supervisor.stop_all()
            self.live.stop_all()
            worker.join(timeout=10)
