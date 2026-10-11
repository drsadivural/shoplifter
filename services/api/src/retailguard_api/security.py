"""Password hashing, tokens, TOTP and envelope encryption helpers."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .settings import get_settings

_hasher = PasswordHasher()
# Hash of a random password; verifying against it equalizes timing for unknown emails.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> bool:
    try:
        return _hasher.verify(stored or _DUMMY_HASH, password) and stored is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_problem(password: str) -> str | None:
    if not isinstance(password, str) or len(password) < 12:
        return "too_short"
    if len(password) > 256:
        return "too_long"
    if len(set(password)) < 6:
        return "too_simple"
    return None


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def constant_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# ---- symmetric encryption (AES-256-GCM) ------------------------------------------------

def _seal(key: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def _open(key: bytes, blob: bytes, aad: bytes = b"") -> bytes:
    return AESGCM(key).decrypt(blob[:12], blob[12:], aad)


def encrypt_secret(plaintext: str, purpose: str) -> str:
    """Encrypt small secrets (MFA seeds, webhook secrets, push tokens) at rest."""
    return base64.b64encode(_seal(get_settings().secrets_key, plaintext.encode(), purpose.encode())).decode()


def decrypt_secret(ciphertext: str, purpose: str) -> str:
    return _open(get_settings().secrets_key, base64.b64decode(ciphertext), purpose.encode()).decode()


def wrap_data_key(data_key: bytes, media_id: str) -> str:
    return base64.b64encode(_seal(get_settings().media_master_key, data_key, media_id.encode())).decode()


def unwrap_data_key(wrapped: str, media_id: str) -> bytes:
    return _open(get_settings().media_master_key, base64.b64decode(wrapped), media_id.encode())


def encrypt_blob(data_key: bytes, data: bytes, media_id: str) -> bytes:
    return _seal(data_key, data, media_id.encode())


def decrypt_blob(data_key: bytes, blob: bytes, media_id: str) -> bytes:
    return _open(data_key, blob, media_id.encode())


# ---- TOTP ------------------------------------------------------------------------------

def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Ayonix RetailGuard")


def verify_totp(secret: str, code: str) -> bool:
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def new_recovery_codes(n: int = 10) -> list[str]:
    return ["-".join(secrets.token_hex(2) for _ in range(3)) for _ in range(n)]
