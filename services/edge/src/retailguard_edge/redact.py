"""Redaction helpers: never let credentials, pairing codes or URL secrets reach logs."""
from __future__ import annotations

import logging
import re
from typing import Iterable
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

REDACTED = "[REDACTED]"
_SENSITIVE_KEYS = re.compile(r"(pass(word)?|pwd|secret|token|auth|sig(nature)?|key|code|credential|user(name)?)", re.I)
# scheme://userinfo@host  -> scheme://host
_USERINFO_RE = re.compile(r"(?P<scheme>\b[a-zA-Z][a-zA-Z0-9+.\-]*://)(?P<userinfo>[^/\s@]*@)")
# key=value pairs that look sensitive (query strings, ffmpeg messages, JSON-ish)
_KV_RE = re.compile(
    r"(?P<k>\b(?:password|passwd|pwd|secret|token|credential_sealed|credential|authorization|code)\b[\"']?\s*[:=]\s*[\"']?)(?P<v>[^\s&\"',;}]+)",
    re.I,
)


def redact_url(url: str) -> str:
    """Strip userinfo and blank sensitive query parameter values."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return _USERINFO_RE.sub(lambda m: m.group("scheme"), url)
    netloc = parts.netloc.rsplit("@", 1)[-1]
    query = parts.query
    if query:
        pairs = parse_qsl(query, keep_blank_values=True)
        query = urlencode([(k, REDACTED if _SENSITIVE_KEYS.search(k) else v) for k, v in pairs], safe="[]")
    return urlunsplit((parts.scheme, netloc, parts.path, query, parts.fragment))


def redact_text(text: str, secrets: Iterable[str | None] = ()) -> str:
    """Remove URL userinfo, sensitive key=value pairs and any explicitly known secret strings."""
    if not text:
        return text
    out = _USERINFO_RE.sub(lambda m: m.group("scheme"), text)
    out = _KV_RE.sub(lambda m: m.group("k") + REDACTED, out)
    for secret in secrets:
        if secret and len(secret) >= 1:
            out = out.replace(secret, REDACTED)
            # also the percent-encoded form used inside URLs
            enc = quote(secret, safe="")
            if enc != secret:
                out = out.replace(enc, REDACTED)
    return out


class RedactingFilter(logging.Filter):
    """Logging filter applied to every handler: rewrites the final message."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # pragma: no cover - malformed log call
            return True
        record.msg = redact_text(msg)
        record.args = ()
        if record.exc_text:
            record.exc_text = redact_text(record.exc_text)
        return True


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(RedactingFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # httpx logs full request URLs at INFO; keep it at WARNING.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
