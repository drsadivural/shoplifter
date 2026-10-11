"""Edge configuration from a TOML file and environment variables.

Precedence (highest first): explicit overrides passed by the CLI, environment
variables, the TOML file, built-in defaults.

Environment variables:
  RETAILGUARD_EDGE_CONFIG          path to a TOML file (default /etc/retailguard-edge/config.toml)
  RETAILGUARD_EDGE_API             API base URL (https://...; http only for loopback)
  RETAILGUARD_EDGE_STATE_DIR       state directory (default /var/lib/retailguard-edge)
  RETAILGUARD_EDGE_INTERFACE       default local IPv4 address for WS-Discovery
  RETAILGUARD_EDGE_DISK_BUDGET     spool disk budget in bytes
  RETAILGUARD_EDGE_MODEL_MANIFEST  behavior model manifest JSON path
  RETAILGUARD_EDGE_FACE_MANIFEST   face SDK manifest JSON path
  RETAILGUARD_EDGE_POS_CONFIG      checkout/POS integration config JSON path
"""
from __future__ import annotations

import ipaddress
import os
import tomllib
from dataclasses import dataclass, fields, replace
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

DEFAULT_CONFIG_PATH = Path("/etc/retailguard-edge/config.toml")
DEFAULT_STATE_DIR = Path("/var/lib/retailguard-edge")


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class EdgeConfig:
    api_base_url: str | None = None
    state_dir: Path = DEFAULT_STATE_DIR
    discovery_interface: str | None = None
    disk_budget_bytes: int = 20 * 1024**3
    heartbeat_interval_s: float = 15.0
    command_poll_interval_s: float = 5.0
    outbox_flush_interval_s: float = 10.0
    request_timeout_s: float = 15.0
    sample_seconds: float = 10.0
    required_decoded_seconds: float = 10.0
    monitor_streams: bool = True
    degraded_after_s: float = 10.0
    offline_after_s: float = 30.0
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    model_manifest: Path | None = None
    face_sdk_manifest: Path | None = None
    pos_config: Path | None = None
    log_level: str = "INFO"

    def with_overrides(self, **kw: Any) -> "EdgeConfig":
        clean = {k: v for k, v in kw.items() if v is not None}
        return _validate(replace(self, **_coerce(clean)))


_PATH_FIELDS = {"state_dir", "model_manifest", "face_sdk_manifest", "pos_config"}
_INT_FIELDS = {"disk_budget_bytes"}
_FLOAT_FIELDS = {
    "heartbeat_interval_s", "command_poll_interval_s", "outbox_flush_interval_s",
    "request_timeout_s", "sample_seconds", "required_decoded_seconds",
    "degraded_after_s", "offline_after_s",
}
_BOOL_FIELDS = {"monitor_streams"}

_ENV = {
    "RETAILGUARD_EDGE_API": "api_base_url",
    "RETAILGUARD_EDGE_STATE_DIR": "state_dir",
    "RETAILGUARD_EDGE_INTERFACE": "discovery_interface",
    "RETAILGUARD_EDGE_DISK_BUDGET": "disk_budget_bytes",
    "RETAILGUARD_EDGE_MODEL_MANIFEST": "model_manifest",
    "RETAILGUARD_EDGE_FACE_MANIFEST": "face_sdk_manifest",
    "RETAILGUARD_EDGE_POS_CONFIG": "pos_config",
    "RETAILGUARD_EDGE_LOG_LEVEL": "log_level",
}


def _coerce(values: dict[str, Any]) -> dict[str, Any]:
    known = {f.name for f in fields(EdgeConfig)}
    out: dict[str, Any] = {}
    for key, value in values.items():
        if key not in known:
            raise ConfigError(f"unknown config key: {key}")
        if value is None or value == "":
            if key == "state_dir":
                out[key] = DEFAULT_STATE_DIR
            elif key in _PATH_FIELDS or key in {"api_base_url", "discovery_interface"}:
                out[key] = None
            # other keys keep their default
            continue
        try:
            if key in _PATH_FIELDS:
                out[key] = Path(value)
            elif key in _INT_FIELDS:
                out[key] = int(value)
            elif key in _FLOAT_FIELDS:
                out[key] = float(value)
            elif key in _BOOL_FIELDS:
                out[key] = value if isinstance(value, bool) else str(value).lower() in {"1", "true", "yes"}
            else:
                out[key] = str(value)
        except (TypeError, ValueError) as exc:
            raise ConfigError(f"invalid value for {key}") from exc
    return out


def validate_api_url(url: str) -> str:
    """Only HTTPS is allowed, except plain HTTP to a loopback host (local testing)."""
    parts = urlsplit(url)
    if parts.username or parts.password:
        raise ConfigError("API URL must not contain credentials")
    if parts.query or parts.fragment:
        raise ConfigError("API URL must not contain a query or fragment")
    host = parts.hostname or ""
    if parts.scheme == "https" and host:
        return url.rstrip("/")
    if parts.scheme == "http" and host:
        try:
            if ipaddress.ip_address(host).is_loopback:
                return url.rstrip("/")
        except ValueError:
            if host == "localhost":
                return url.rstrip("/")
    raise ConfigError("API URL must be https:// (http:// is accepted only for loopback testing)")


def _validate(cfg: EdgeConfig) -> EdgeConfig:
    if cfg.api_base_url:
        cfg = replace(cfg, api_base_url=validate_api_url(cfg.api_base_url))
    if cfg.disk_budget_bytes < 64 * 1024**2:
        raise ConfigError("disk_budget_bytes must be at least 64 MiB")
    for name in _FLOAT_FIELDS:
        if getattr(cfg, name) <= 0:
            raise ConfigError(f"{name} must be positive")
    if cfg.offline_after_s <= cfg.degraded_after_s:
        raise ConfigError("offline_after_s must exceed degraded_after_s")
    if cfg.discovery_interface:
        try:
            ipaddress.IPv4Address(cfg.discovery_interface)
        except ValueError as exc:
            raise ConfigError("discovery_interface must be a local IPv4 address") from exc
    return cfg


def load_config(path: Path | None = None, env: dict[str, str] | None = None) -> EdgeConfig:
    env = dict(os.environ if env is None else env)
    values: dict[str, Any] = {}
    cfg_path = path or Path(env.get("RETAILGUARD_EDGE_CONFIG", DEFAULT_CONFIG_PATH))
    if cfg_path.is_file():
        with cfg_path.open("rb") as fh:
            data = tomllib.load(fh)
        values.update(data.get("edge", data))
    elif path is not None:
        raise ConfigError(f"config file not found: {cfg_path}")
    for env_key, field_name in _ENV.items():
        if env.get(env_key):
            values[field_name] = env[env_key]
    return _validate(replace(EdgeConfig(), **_coerce(values)))


def ensure_state_dir(state_dir: Path) -> Path:
    """Create the state directory with mode 0700 and tighten it if it already exists."""
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state_dir, 0o700)
    for sub in ("spool", "spool/evidence", "spool/raw"):
        p = state_dir / sub
        p.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(p, 0o700)
    return state_dir


def write_private_file(path: Path, data: bytes, *, exclusive: bool = False) -> None:
    """Atomically write a 0600 file (tmp + rename)."""
    if exclusive:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        return
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()
    os.chmod(path, 0o600)


__all__ = [
    "ConfigError", "EdgeConfig", "load_config", "ensure_state_dir", "write_private_file",
    "validate_api_url",
]
