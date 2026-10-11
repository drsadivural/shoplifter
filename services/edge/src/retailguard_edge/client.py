"""Signed HTTP client for the edge-authenticated API.

Every request carries:
  X-Edge-Id, X-Edge-Timestamp (unix seconds), X-Edge-Nonce (random, >=16 chars),
  X-Edge-Signature = base64(Ed25519 sign(
      "{METHOD}\\n{PATH_WITH_QUERY}\\n{timestamp}\\n{nonce}\\n{sha256_hex(body)}"))

Each retry is re-signed with a fresh timestamp and nonce (nonces are single use).
Request/response bodies are never logged.
"""
from __future__ import annotations

import base64
import email.utils
import hashlib
import json as jsonlib
import logging
import random
import secrets
import time
from typing import Any, Callable
from urllib.parse import quote

import httpx
from nacl.signing import SigningKey

from . import __version__

log = logging.getLogger(__name__)

RETRIABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


class EdgeAPIError(Exception):
    def __init__(self, status: int | None, code: str, retriable: bool, message: str = ""):
        super().__init__(f"{code} (HTTP {status})" if status else code)
        self.status = status
        self.code = code
        self.retriable = retriable
        self.message = message


def canonical_string(method: str, path_with_query: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    digest = hashlib.sha256(body or b"").hexdigest()
    return f"{method.upper()}\n{path_with_query}\n{timestamp}\n{nonce}\n{digest}".encode("utf-8")


def make_nonce() -> str:
    return secrets.token_urlsafe(24)  # 32 chars


def sign_request(signing_key: SigningKey, edge_id: str, method: str, path_with_query: str, body: bytes,
                 *, timestamp: int | None = None, nonce: str | None = None) -> dict[str, str]:
    ts = str(int(time.time() if timestamp is None else timestamp))
    nonce = nonce or make_nonce()
    if len(nonce) < 16:
        raise ValueError("nonce must be at least 16 characters")
    sig = signing_key.sign(canonical_string(method, path_with_query, ts, nonce, body)).signature
    return {
        "X-Edge-Id": edge_id,
        "X-Edge-Timestamp": ts,
        "X-Edge-Nonce": nonce,
        "X-Edge-Signature": base64.b64encode(sig).decode(),
    }


def backoff_delay(attempt: int, base: float, cap: float, rng: Callable[[], float] = random.random) -> float:
    """Exponential backoff with full jitter: uniform(0, min(cap, base*2^attempt))."""
    return rng() * min(cap, base * (2 ** attempt))


class EdgeClient:
    def __init__(self, base_url: str, edge_id: str, signing_key: SigningKey, *,
                 transport: httpx.BaseTransport | None = None, timeout: float = 15.0,
                 max_attempts: int = 4, base_delay: float = 0.5, max_delay: float = 20.0,
                 sleep: Callable[[float], None] = time.sleep, rng: Callable[[], float] = random.random):
        if max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")
        self.edge_id = edge_id
        self._key = signing_key
        self._http = httpx.Client(base_url=base_url, transport=transport, timeout=timeout,
                                  follow_redirects=False,
                                  headers={"User-Agent": f"retailguard-edge/{__version__}"})
        self._max_attempts = max_attempts
        self._base_delay = base_delay
        self._max_delay = max_delay
        self._sleep = sleep
        self._rng = rng
        self.last_clock_offset_ms: int | None = None

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "EdgeClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _record_clock(self, resp: httpx.Response, sent: float, received: float) -> None:
        date = resp.headers.get("Date")
        if not date:
            return
        try:
            server = email.utils.parsedate_to_datetime(date).timestamp()
        except (TypeError, ValueError):
            return
        # HTTP Date has 1 s resolution; offset = edge clock - server clock (midpoint).
        self.last_clock_offset_ms = int(round(((sent + received) / 2 - server) * 1000))

    def request(self, method: str, path: str, *, json: Any = None, content: bytes | None = None,
                headers: dict[str, str] | None = None, retry: bool = True) -> httpx.Response:
        if json is not None and content is not None:
            raise ValueError("pass json or content, not both")
        body = content if content is not None else (
            jsonlib.dumps(json, separators=(",", ":"), ensure_ascii=False).encode() if json is not None else b"")
        req_headers = dict(headers or {})
        if json is not None:
            req_headers.setdefault("Content-Type", "application/json")
        attempts = self._max_attempts if retry else 1
        last_exc: EdgeAPIError | None = None
        for attempt in range(attempts):
            req = self._http.build_request(method, path, content=body, headers=req_headers)
            path_q = req.url.raw_path.decode("ascii")
            req.headers.update(sign_request(self._key, self.edge_id, method, path_q, body))
            sent = time.time()
            try:
                resp = self._http.send(req)
            except httpx.TransportError as exc:
                last_exc = EdgeAPIError(None, "api_unreachable", True, type(exc).__name__)
                log.warning("%s %s transport error (%s), attempt %d/%d",
                            method, req.url.path, type(exc).__name__, attempt + 1, attempts)
            else:
                self._record_clock(resp, sent, time.time())
                if resp.status_code < 300:
                    return resp
                code = "http_error"
                try:
                    payload = resp.json()
                    if isinstance(payload, dict) and isinstance(payload.get("code"), str):
                        code = payload["code"]
                except ValueError:
                    pass
                retriable = resp.status_code in RETRIABLE_STATUS
                last_exc = EdgeAPIError(resp.status_code, code, retriable)
                log.warning("%s %s -> HTTP %d code=%s", method, req.url.path, resp.status_code, code)
                if not retriable:
                    raise last_exc
                retry_after = resp.headers.get("Retry-After")
                if retry_after and retry_after.isdigit() and attempt + 1 < attempts:
                    self._sleep(min(float(retry_after), self._max_delay))
                    continue
            if attempt + 1 < attempts:
                self._sleep(backoff_delay(attempt, self._base_delay, self._max_delay, self._rng))
        assert last_exc is not None
        raise last_exc

    # Convenience wrappers for the documented endpoints -------------------
    def heartbeat(self, body: dict) -> dict:
        return self.request("POST", "/v1/edge/heartbeat", json=body).json()

    def get_commands(self) -> list[dict]:
        data = self.request("GET", "/v1/edge/commands").json()
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise EdgeAPIError(200, "commands_response_invalid", False)
        return items

    def ack_command(self, command_id: str, status: str, result: dict, error: str | None = None) -> None:
        if status not in ("succeeded", "failed"):
            raise ValueError("status must be succeeded|failed")
        body: dict[str, Any] = {"status": status, "result": result}
        if error is not None:
            body["error"] = error
        self.request("POST", f"/v1/edge/commands/{quote(command_id, safe='')}/ack", json=body)

    def upload_snapshot(self, camera_id: str, jpeg: bytes) -> None:
        self.request("PUT", f"/v1/edge/cameras/{quote(camera_id, safe='')}/snapshot", content=jpeg,
                     headers={"Content-Type": "image/jpeg"})
