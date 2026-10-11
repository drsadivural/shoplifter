"""Encrypted media store and image validation.

Each object is encrypted with a random 256-bit data key (AES-GCM); the data key is wrapped by
the deployment master key (MEDIA_MASTER_KEY, held in the secret store; a KMS can replace the
wrap/unwrap functions). Storage keys are random and unrelated to IDs or content.
"""
from __future__ import annotations

import hashlib
import io
import os
import secrets
import uuid
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps, ImageStat, UnidentifiedImageError

from .db import Tx
from .errors import ApiError
from .security import decrypt_blob, encrypt_blob, unwrap_data_key, wrap_data_key
from .settings import get_settings

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 40_000_000
MIN_SIDE = 200
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def _path(storage_key: str) -> Path:
    root = Path(get_settings().media_dir)
    p = (root / storage_key[:2] / storage_key).resolve()
    if not p.is_relative_to(root.resolve()):
        raise ApiError(500, "storage_error", "Storage error")
    return p


def store(tx: Tx, org_id: str, data: bytes, mime: str, purpose: str, *, store_id=None,
          expires_at: datetime | None = None) -> dict:
    media_id = uuid.uuid4()
    key = secrets.token_bytes(32)
    storage_key = secrets.token_hex(24)
    path = _path(storage_key)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "wb") as fh:
        fh.write(encrypt_blob(key, data, str(media_id)))
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    digest = hashlib.sha256(data).hexdigest()
    return tx.one("""INSERT INTO media (id, org_id, store_id, purpose, storage_key, wrapped_key, sha256, mime,
                     size_bytes, expires_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                  (media_id, org_id, store_id, purpose, storage_key, wrap_data_key(key, str(media_id)), digest,
                   mime, len(data), expires_at))


def read(row: dict) -> bytes:
    if row["deleted_at"] is not None:
        raise ApiError(410, "media_deleted", "This file has been deleted under the retention policy")
    try:
        blob = _path(row["storage_key"]).read_bytes()
    except FileNotFoundError:
        raise ApiError(410, "media_missing", "This file is no longer available")
    key = unwrap_data_key(row["wrapped_key"], str(row["id"]))
    data = decrypt_blob(key, blob, str(row["id"]))
    if hashlib.sha256(data).hexdigest() != row["sha256"]:
        raise ApiError(500, "media_integrity_failed", "Stored file failed its integrity check")
    return data


def delete(tx: Tx, media_id) -> None:
    row = tx.one("SELECT * FROM media WHERE id=%s", (media_id,))
    if not row or row["deleted_at"] is not None:
        return
    try:
        _path(row["storage_key"]).unlink()
    except FileNotFoundError:
        pass
    tx.run("UPDATE media SET deleted_at=now() WHERE id=%s", (media_id,))


def sniff(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) > 12 and data[4:8] == b"ftyp":
        return "video/mp4"
    return None


def process_photo(data: bytes) -> dict:
    """Validate actual image bytes, strip metadata (EXIF/GPS) by re-encoding, and compute
    measured image statistics. Face count/quality require the licensed face SDK and are
    reported as unavailable rather than estimated."""
    if not data:
        raise ApiError(422, "validation_failed", "Choose a photo", field_errors={"file": "required"})
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "photo_too_large", "Photos must be 8 MB or smaller")
    if sniff(data) not in ("image/jpeg", "image/png"):
        raise ApiError(422, "validation_failed", "Only JPEG or PNG photos are accepted",
                       field_errors={"file": "jpeg_or_png_required"})
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
        raise ApiError(422, "validation_failed", "The photo could not be decoded", field_errors={"file": "corrupt"})
    if img.width * img.height > MAX_PIXELS:
        raise ApiError(413, "photo_too_large", "Photo dimensions are too large")
    img = ImageOps.exif_transpose(img).convert("RGB")
    if min(img.size) < MIN_SIDE:
        raise ApiError(422, "validation_failed", "Photo must be at least 200×200 pixels",
                       field_errors={"file": "too_small"})
    if max(img.size) > 2048:
        img.thumbnail((2048, 2048))
    gray = img.convert("L")
    brightness = ImageStat.Stat(gray).mean[0] / 255.0
    edges = gray.filter(ImageFilter.FIND_EDGES)
    sharpness = ImageStat.Stat(edges).var[0]
    out = io.BytesIO()
    img.save(out, "JPEG", quality=92, optimize=True)  # re-encode: drops EXIF/GPS/ICC metadata
    thumb = img.copy()
    thumb.thumbnail((320, 320))
    tout = io.BytesIO()
    thumb.save(tout, "JPEG", quality=85)
    problems = []
    if brightness < 0.12:
        problems.append("too_dark")
    if brightness > 0.92:
        problems.append("overexposed")
    if sharpness < 40:
        problems.append("blurry")
    return {
        "jpeg": out.getvalue(), "thumb": tout.getvalue(), "width": img.width, "height": img.height,
        "quality": {
            "image": {"brightness": round(brightness, 3), "sharpness": round(sharpness, 1),
                      "width": img.width, "height": img.height, "problems": problems,
                      "method": "measured_image_statistics"},
            "face": {"status": "unavailable", "reason": "face_sdk_unavailable"},
        },
    }
