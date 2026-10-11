"""Runtime configuration from environment variables.

Production inputs are listed in docs/CONFIG_AND_INPUTS.md. Optional integrations that are
not configured (OIDC, APNs, face SDK, behavior models, SMTP) are reported as unavailable
rather than replaced by defaults.
"""
from __future__ import annotations

import base64
import ipaddress
import os
from dataclasses import dataclass, field
from functools import lru_cache


class ConfigError(RuntimeError):
    pass


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    return value if value not in ("", None) else default


def _key(name: str, required: bool) -> bytes | None:
    raw = _env(name)
    if raw is None:
        if required:
            raise ConfigError(f"{name} is required")
        return None
    try:
        key = base64.b64decode(raw, validate=True)
    except ValueError as exc:
        raise ConfigError(f"{name} must be base64") from exc
    if len(key) != 32:
        raise ConfigError(f"{name} must decode to 32 bytes")
    return key


@dataclass(frozen=True)
class Settings:
    app_env: str
    web_origin: str
    database_url: str
    media_dir: str
    media_master_key: bytes
    secrets_key: bytes
    session_hours: int = 12
    mobile_session_days: int = 14
    cookie_secure: bool = True
    edge_allowed_subnets: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...] = ()
    oidc_issuer: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    apns_team_id: str | None = None
    apns_key_id: str | None = None
    apns_private_key_file: str | None = None
    apns_bundle_id: str | None = None
    ayonix_sdk_package: str | None = None
    ayonix_license_file: str | None = None
    support_contact: str | None = None
    trusted_proxies: tuple[str, ...] = field(default_factory=tuple)

    @property
    def oidc_enabled(self) -> bool:
        return bool(self.oidc_issuer and self.oidc_client_id)

    @property
    def apns_configured(self) -> bool:
        return bool(self.apns_team_id and self.apns_key_id and self.apns_private_key_file and self.apns_bundle_id)

    @property
    def face_sdk_configured(self) -> bool:
        # The licensed Ayonix SDK is an external input; without a package and license there
        # is no face pipeline. No adapter is invented here (CLAUDE.md).
        return bool(self.ayonix_sdk_package and self.ayonix_license_file)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    env = _env("APP_ENV", "development")
    production = env == "production"
    origin = _env("WEB_ORIGIN", "http://127.0.0.1:5180")
    if production and not origin.startswith("https://"):
        raise ConfigError("WEB_ORIGIN must be https in production")
    db = _env("DATABASE_URL")
    if not db:
        raise ConfigError("DATABASE_URL is required")
    subnets = []
    for item in (_env("EDGE_ALLOWED_SUBNETS", "") or "").split(","):
        item = item.strip()
        if item:
            subnets.append(ipaddress.ip_network(item, strict=False))
    return Settings(
        app_env=env,
        web_origin=origin.rstrip("/"),
        database_url=db,
        media_dir=_env("MEDIA_DIR", "/var/lib/retailguard/media"),
        media_master_key=_key("MEDIA_MASTER_KEY", True),
        secrets_key=_key("SECRETS_KEY", True),
        session_hours=int(_env("SESSION_HOURS", "12")),
        cookie_secure=_env("COOKIE_SECURE", "true" if production else "false") == "true",
        edge_allowed_subnets=tuple(subnets),
        oidc_issuer=_env("OIDC_ISSUER"),
        oidc_client_id=_env("OIDC_CLIENT_ID"),
        oidc_client_secret=_env("OIDC_CLIENT_SECRET"),
        apns_team_id=_env("APNS_TEAM_ID"),
        apns_key_id=_env("APNS_KEY_ID"),
        apns_private_key_file=_env("APNS_PRIVATE_KEY_FILE"),
        apns_bundle_id=_env("APNS_BUNDLE_ID"),
        ayonix_sdk_package=_env("AYONIX_SDK_PACKAGE"),
        ayonix_license_file=_env("AYONIX_LICENSE_FILE"),
        support_contact=_env("SUPPORT_CONTACT"),
    )
