import base64
import hashlib
import json

import httpx
import pytest
from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

from retailguard_edge.client import EdgeAPIError, EdgeClient, backoff_delay, canonical_string, sign_request


def test_canonical_string_exact():
    body = b'{"a":1}'
    got = canonical_string("post", "/v1/edge/commands/abc/ack?x=1&y=2", "1760000000", "n" * 20, body)
    expected = ("POST\n/v1/edge/commands/abc/ack?x=1&y=2\n1760000000\n" + "n" * 20 + "\n"
                + hashlib.sha256(body).hexdigest()).encode()
    assert got == expected


def test_canonical_string_empty_body_hash():
    got = canonical_string("GET", "/v1/edge/commands", "1", "abcdefghijklmnop", b"")
    assert got.endswith(b"\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")


def test_signature_verifies_with_public_key():
    key = SigningKey.generate()
    headers = sign_request(key, "edge-1", "POST", "/v1/edge/heartbeat", b"{}", timestamp=1760000000,
                           nonce="0123456789abcdef0123")
    assert headers["X-Edge-Id"] == "edge-1"
    assert headers["X-Edge-Timestamp"] == "1760000000"
    msg = canonical_string("POST", "/v1/edge/heartbeat", "1760000000", "0123456789abcdef0123", b"{}")
    VerifyKey(bytes(key.verify_key)).verify(msg, base64.b64decode(headers["X-Edge-Signature"]))
    with pytest.raises(BadSignatureError):
        VerifyKey(bytes(key.verify_key)).verify(msg + b"x", base64.b64decode(headers["X-Edge-Signature"]))


def test_short_nonce_rejected():
    with pytest.raises(ValueError):
        sign_request(SigningKey.generate(), "e", "GET", "/", b"", nonce="short")


def _verify(req: httpx.Request, vk: VerifyKey) -> None:
    path = req.url.raw_path.decode()
    msg = canonical_string(req.method, path, req.headers["X-Edge-Timestamp"], req.headers["X-Edge-Nonce"],
                           req.content)
    vk.verify(msg, base64.b64decode(req.headers["X-Edge-Signature"]))
    assert len(req.headers["X-Edge-Nonce"]) >= 16


def test_client_signs_path_with_query_and_body():
    key = SigningKey.generate()
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        _verify(req, key.verify_key)
        seen.append(req)
        return httpx.Response(200, json={"ok": True, "config_version": 3})

    c = EdgeClient("https://api.example.test", "edge-1", key, transport=httpx.MockTransport(handler))
    c.request("GET", "/v1/edge/commands?limit=10")
    c.heartbeat({"software_version": "0.1.0", "health": {}, "cameras": [], "models": []})
    assert seen[0].url.raw_path == b"/v1/edge/commands?limit=10"
    assert json.loads(seen[1].content)["software_version"] == "0.1.0"


def test_retry_resigns_with_fresh_nonce_and_is_bounded():
    key = SigningKey.generate()
    nonces, sleeps = [], []

    def handler(req):
        _verify(req, key.verify_key)
        nonces.append(req.headers["X-Edge-Nonce"])
        return httpx.Response(503, json={"code": "unavailable", "retriable": True})

    c = EdgeClient("https://api.example.test", "e", key, transport=httpx.MockTransport(handler),
                   max_attempts=4, sleep=sleeps.append, rng=lambda: 1.0, base_delay=0.5, max_delay=1.5)
    with pytest.raises(EdgeAPIError) as ei:
        c.request("POST", "/v1/edge/heartbeat", json={})
    assert ei.value.status == 503 and ei.value.retriable
    assert len(nonces) == 4 and len(set(nonces)) == 4
    assert sleeps == [0.5, 1.0, 1.5]  # exponential, capped


def test_non_retriable_error_not_retried():
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(401, json={"code": "edge_revoked"})

    c = EdgeClient("https://api.example.test", "e", SigningKey.generate(), transport=httpx.MockTransport(handler),
                   sleep=lambda s: None)
    with pytest.raises(EdgeAPIError) as ei:
        c.get_commands()
    assert ei.value.code == "edge_revoked" and len(calls) == 1


def test_backoff_full_jitter_bounds():
    assert backoff_delay(10, 1.0, 30.0, rng=lambda: 1.0) == 30.0
    assert backoff_delay(2, 1.0, 30.0, rng=lambda: 0.5) == 2.0


def test_redirects_not_followed():
    def handler(req):
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/latest"})

    c = EdgeClient("https://api.example.test", "e", SigningKey.generate(), transport=httpx.MockTransport(handler),
                   sleep=lambda s: None)
    with pytest.raises(EdgeAPIError) as ei:
        c.request("GET", "/v1/edge/commands")
    assert ei.value.status == 302
