"""Credential vault.

The API seals camera credentials to the edge's X25519 public key
(libsodium SealedBox, base64). The edge decrypts once, then stores them
re-encrypted at rest with a local SecretBox key (0600 file) keyed by camera_id.
Plaintext credentials are only held in memory while building a child-process
argv or an ONVIF request; they are never logged or returned.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

from nacl import exceptions as nacl_exc
from nacl.public import PrivateKey, SealedBox
from nacl.secret import SecretBox
from nacl.utils import random as nacl_random

from .config import write_private_file

MAX_SEALED_BYTES = 8192
MAX_FIELD_LEN = 256


class VaultError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Credentials:
    username: str
    password: str = field(repr=False)

    def __repr__(self) -> str:  # never print the password
        return "Credentials(username=[REDACTED], password=[REDACTED])"

    __str__ = __repr__

    def secrets(self) -> tuple[str, str]:
        return (self.username, self.password)


def parse_credential_plaintext(raw: bytes) -> Credentials:
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise VaultError("credential_malformed") from None
    if not isinstance(obj, dict):
        raise VaultError("credential_malformed")
    user, pwd = obj.get("username"), obj.get("password")
    if not isinstance(user, str) or not isinstance(pwd, str):
        raise VaultError("credential_malformed")
    if not user or len(user) > MAX_FIELD_LEN or len(pwd) > MAX_FIELD_LEN:
        raise VaultError("credential_malformed")
    if any(c in user + pwd for c in "\r\n\x00"):
        raise VaultError("credential_malformed")
    return Credentials(user, pwd)


class CredentialVault:
    def __init__(self, state_dir: Path, box_private_key: PrivateKey):
        self._dir = state_dir
        self._key_path = state_dir / "vault.key"
        self._db_path = state_dir / "vault.json"
        self._box_key = box_private_key
        self._lock = threading.Lock()
        self._secret_box = SecretBox(self._load_or_create_key())

    def _load_or_create_key(self) -> bytes:
        if self._key_path.exists():
            key = self._key_path.read_bytes()
            if len(key) != SecretBox.KEY_SIZE:
                raise VaultError("vault_key_corrupt")
            os.chmod(self._key_path, 0o600)
            return key
        key = nacl_random(SecretBox.KEY_SIZE)
        write_private_file(self._key_path, key, exclusive=True)
        return key

    def _read_db(self) -> dict[str, str]:
        if not self._db_path.exists():
            return {}
        data = json.loads(self._db_path.read_text("utf-8"))
        if not isinstance(data, dict):
            raise VaultError("vault_corrupt")
        return data

    def _write_db(self, data: dict[str, str]) -> None:
        write_private_file(self._db_path, json.dumps(data, sort_keys=True).encode())

    @staticmethod
    def _check_camera_id(camera_id: str) -> None:
        if not isinstance(camera_id, str) or not camera_id or len(camera_id) > 200:
            raise VaultError("invalid_camera_id")

    def open_sealed(self, credential_sealed_b64: str) -> Credentials:
        if not isinstance(credential_sealed_b64, str) or len(credential_sealed_b64) > MAX_SEALED_BYTES:
            raise VaultError("credential_malformed")
        try:
            sealed = base64.b64decode(credential_sealed_b64, validate=True)
        except (binascii.Error, ValueError):
            raise VaultError("credential_malformed") from None
        try:
            plaintext = SealedBox(self._box_key).decrypt(sealed)
        except nacl_exc.CryptoError:
            raise VaultError("credential_decrypt_failed") from None
        return parse_credential_plaintext(plaintext)

    def store_sealed(self, camera_id: str, credential_sealed_b64: str) -> None:
        self.put(camera_id, self.open_sealed(credential_sealed_b64))

    def put(self, camera_id: str, creds: Credentials) -> None:
        self._check_camera_id(camera_id)
        blob = json.dumps({"username": creds.username, "password": creds.password}).encode()
        ct = self._secret_box.encrypt(blob)
        with self._lock:
            db = self._read_db()
            db[camera_id] = base64.b64encode(bytes(ct)).decode()
            self._write_db(db)

    def get(self, camera_id: str) -> Credentials | None:
        self._check_camera_id(camera_id)
        with self._lock:
            entry = self._read_db().get(camera_id)
        if entry is None:
            return None
        try:
            plaintext = self._secret_box.decrypt(base64.b64decode(entry))
        except (nacl_exc.CryptoError, binascii.Error, ValueError):
            raise VaultError("vault_entry_corrupt") from None
        return parse_credential_plaintext(plaintext)

    def has(self, camera_id: str) -> bool:
        with self._lock:
            return camera_id in self._read_db()

    def delete(self, camera_id: str) -> None:
        with self._lock:
            db = self._read_db()
            if db.pop(camera_id, None) is not None:
                self._write_db(db)
