"""Edge identity: Ed25519 request-signing key, X25519 box key, pairing state.

Files in the state dir (all 0600, dir 0700):
  sign.key   32-byte Ed25519 seed
  box.key    32-byte X25519 private key (credential SealedBox recipient)
  edge.json  {edge_id, org_id, store_id, store_timezone, allowed_subnets, api_base_url, api_version, paired_at}
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import httpx
from nacl.public import PrivateKey
from nacl.signing import SigningKey

from . import __version__
from .config import ensure_state_dir, validate_api_url, write_private_file
from .netpolicy import SubnetPolicy, parse_allowed_subnets

log = logging.getLogger(__name__)


class IdentityError(Exception):
    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code


@dataclass(frozen=True)
class PairingState:
    edge_id: str
    org_id: str
    store_id: str
    store_timezone: str | None
    allowed_subnets: list[str]
    api_base_url: str
    api_version: int
    paired_at: float


class EdgeKeys:
    def __init__(self, signing_key: SigningKey, box_key: PrivateKey):
        self.signing_key = signing_key
        self.box_key = box_key

    @property
    def sign_public_b64(self) -> str:
        return base64.b64encode(bytes(self.signing_key.verify_key)).decode()

    @property
    def box_public_b64(self) -> str:
        return base64.b64encode(bytes(self.box_key.public_key)).decode()

    @property
    def fingerprint(self) -> str:
        """SHA-256 of the raw Ed25519 public key (hex). Safe to display."""
        return hashlib.sha256(bytes(self.signing_key.verify_key)).hexdigest()


def _load_or_create(path: Path, factory) -> bytes:
    if path.exists():
        data = path.read_bytes()
        if len(data) != 32:
            raise IdentityError("key_corrupt", f"{path.name} has unexpected length")
        path.chmod(0o600)
        return data
    seed = factory()
    write_private_file(path, seed, exclusive=True)
    return seed


def load_or_create_keys(state_dir: Path) -> EdgeKeys:
    ensure_state_dir(state_dir)
    sign_seed = _load_or_create(state_dir / "sign.key", lambda: bytes(SigningKey.generate()))
    box_raw = _load_or_create(state_dir / "box.key", lambda: bytes(PrivateKey.generate()))
    return EdgeKeys(SigningKey(sign_seed), PrivateKey(box_raw))


def load_pairing(state_dir: Path) -> PairingState | None:
    path = state_dir / "edge.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text("utf-8"))
    return PairingState(**data)


def update_allowed_subnets(state_dir: Path, pairing: PairingState, cidrs: list[str]) -> PairingState:
    """Apply camera subnets announced by the API (heartbeat response). Every range must be private;
    otherwise ValueError and nothing changes."""
    parse_allowed_subnets(cidrs)
    state = replace(pairing, allowed_subnets=list(cidrs))
    write_private_file(state_dir / "edge.json", json.dumps(asdict(state), indent=2).encode())
    return state


def subnet_policy(pairing: PairingState | None) -> SubnetPolicy:
    return SubnetPolicy.from_cidrs(pairing.allowed_subnets if pairing else [])


def _require_str(obj: dict, key: str) -> str:
    val = obj.get(key)
    if not isinstance(val, str) or not val or len(val) > 200:
        raise IdentityError("pairing_response_invalid", f"missing or invalid {key}")
    return val


def pair(api_base_url: str, code: str, device_name: str, state_dir: Path,
         *, transport: httpx.BaseTransport | None = None, timeout: float = 15.0) -> PairingState:
    """POST /v1/edge/pair and persist the resulting identity binding.

    The pairing code is single-use; it is never logged or persisted.
    """
    api_base_url = validate_api_url(api_base_url)
    if not isinstance(code, str) or not code.strip() or len(code) > 128:
        raise IdentityError("invalid_code")
    if not isinstance(device_name, str) or not device_name.strip() or len(device_name) > 200:
        raise IdentityError("invalid_device_name")
    if load_pairing(state_dir) is not None:
        raise IdentityError("already_paired", "edge is already paired; remove edge.json deliberately to re-pair")
    keys = load_or_create_keys(state_dir)
    body = {
        "code": code.strip(),
        "device_name": device_name.strip(),
        "sign_public_key": keys.sign_public_b64,
        "box_public_key": keys.box_public_b64,
        "software_version": __version__,
    }
    try:
        with httpx.Client(base_url=api_base_url, transport=transport, timeout=timeout,
                          follow_redirects=False) as client:
            resp = client.post("/v1/edge/pair", json=body)
    except httpx.HTTPError as exc:
        raise IdentityError("api_unreachable", type(exc).__name__) from None
    if resp.status_code not in (200, 201):
        code_str = "pairing_failed"
        try:
            code_str = resp.json().get("code") or code_str
        except ValueError:
            pass
        raise IdentityError(code_str, f"pairing rejected (HTTP {resp.status_code})")
    try:
        data = resp.json()
    except ValueError:
        raise IdentityError("pairing_response_invalid") from None
    if not isinstance(data, dict):
        raise IdentityError("pairing_response_invalid")
    subnets = data.get("allowed_subnets")
    try:
        parse_allowed_subnets(subnets)  # type: ignore[arg-type]
    except (ValueError, TypeError) as exc:
        raise IdentityError("pairing_response_invalid", f"allowed_subnets rejected: {exc}") from None
    api_version = data.get("api_version")
    if api_version != 1:
        raise IdentityError("unsupported_api_version", f"server api_version={api_version!r}")
    tz = data.get("store_timezone")
    state = PairingState(
        edge_id=_require_str(data, "edge_id"),
        org_id=_require_str(data, "org_id"),
        store_id=_require_str(data, "store_id"),
        store_timezone=tz if isinstance(tz, str) else None,
        allowed_subnets=list(subnets),  # type: ignore[arg-type]
        api_base_url=api_base_url,
        api_version=1,
        paired_at=time.time(),
    )
    write_private_file(state_dir / "edge.json", json.dumps(asdict(state), indent=2).encode())
    log.info("paired edge_id=%s store_id=%s fingerprint=%s", state.edge_id, state.store_id, keys.fingerprint)
    return state
