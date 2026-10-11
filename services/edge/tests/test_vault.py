import base64
import io
import json
import logging
import os
import stat

import pytest
from nacl.public import PrivateKey, SealedBox

from retailguard_edge.identity import load_or_create_keys
from retailguard_edge.redact import RedactingFilter, redact_text, redact_url
from retailguard_edge.stream import StreamSource, probe_readiness
from retailguard_edge.vault import Credentials, CredentialVault, VaultError

PASSWORD = "S3cr3t:p@ss/w%rd"


def _seal(pub, obj) -> str:
    return base64.b64encode(SealedBox(pub).encrypt(json.dumps(obj).encode())).decode()


def test_sealedbox_round_trip_and_at_rest_encryption(state_dir):
    keys = load_or_create_keys(state_dir)
    vault = CredentialVault(state_dir, keys.box_key)
    vault.store_sealed("cam-1", _seal(keys.box_key.public_key, {"username": "viewer", "password": PASSWORD}))
    creds = vault.get("cam-1")
    assert creds == Credentials("viewer", PASSWORD)
    raw = (state_dir / "vault.json").read_bytes()
    assert PASSWORD.encode() not in raw and b"viewer" not in raw
    for name in ("vault.json", "vault.key", "sign.key", "box.key"):
        assert stat.S_IMODE(os.stat(state_dir / name).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(state_dir).st_mode) == 0o700
    # survives re-instantiation (same local key)
    assert CredentialVault(state_dir, keys.box_key).get("cam-1").password == PASSWORD
    vault.delete("cam-1")
    assert vault.get("cam-1") is None


def test_wrong_recipient_and_malformed_rejected(state_dir):
    keys = load_or_create_keys(state_dir)
    vault = CredentialVault(state_dir, keys.box_key)
    other = PrivateKey.generate()
    with pytest.raises(VaultError) as ei:
        vault.store_sealed("cam", _seal(other.public_key, {"username": "u", "password": "p"}))
    assert ei.value.code == "credential_decrypt_failed"
    with pytest.raises(VaultError) as ei:
        vault.store_sealed("cam", _seal(keys.box_key.public_key, {"username": "u"}))
    assert ei.value.code == "credential_malformed"
    with pytest.raises(VaultError):
        vault.store_sealed("cam", "not base64!!")


def test_credentials_never_in_repr_or_redacted_strings():
    c = Credentials("admin", PASSWORD)
    assert PASSWORD not in repr(c) and PASSWORD not in str(c) and "admin" not in repr(c)
    src = StreamSource("rtsp://192.168.1.20:554/Streaming/101", c)
    argv_url = src.argv_url()
    assert argv_url.startswith("rtsp://admin:S3cr3t%3Ap%40ss%2Fw%25rd@192.168.1.20:554/")
    assert PASSWORD not in repr(src)
    assert redact_url(argv_url) == "rtsp://192.168.1.20:554/Streaming/101"
    msg = f"failed to open {argv_url}: password={PASSWORD} 401"
    red = redact_text(msg, c.secrets())
    assert PASSWORD not in red and "S3cr3t" not in red and "%40ss" not in red
    assert redact_url("http://x/snap?user=a&password=b&channel=1") == \
        "http://x/snap?user=[REDACTED]&password=[REDACTED]&channel=1"


def test_logging_filter_redacts_userinfo_and_passwords():
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.addFilter(RedactingFilter())
    logger = logging.getLogger("test.redact")
    logger.addHandler(handler)
    logger.propagate = False
    logger.warning("connect %s password=%s", "rtsp://admin:hunter2@10.0.0.5/live", "hunter2")
    out = buf.getvalue()
    assert "hunter2" not in out and "rtsp://10.0.0.5/live" in out


def test_probe_error_output_is_redacted(ffmpeg_available):
    # Nothing listens on port 9 locally: ffprobe fails; the error must not leak credentials.
    src = StreamSource("rtsp://127.0.0.1:9/stream", Credentials("admin", PASSWORD))
    report = probe_readiness(src, sample_seconds=1, required_seconds=1, timeout_s=20)
    blob = json.dumps(report.to_dict())
    assert report.readiness == "offline" and report.errors
    assert PASSWORD not in blob and "S3cr3t" not in blob and "admin:" not in blob
