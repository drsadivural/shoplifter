"""Minimal ONVIF SOAP client (Device + Media/Media2) over httpx.

Implements only standard ONVIF operations: GetSystemDateAndTime,
GetDeviceInformation, GetCapabilities, GetServices, Media GetProfiles,
GetStreamUri, GetSnapshotUri (Media ver10 and Media2 ver20).

Authentication: WS-Security UsernameToken with PasswordDigest
  Digest = Base64(SHA1(nonce_bytes + created_utf8 + password_utf8))
with Created adjusted by the measured device clock offset; on an HTTP 401
Digest challenge it falls back to RFC 7616 HTTP Digest (httpx.DigestAuth).

Every XAddr and URI returned by the device is untrusted: it is validated
against the allowed subnets and scheme before use, redirects are never
followed, response size and XML depth are bounded and DTDs are rejected.

Error codes (OnvifError.code):
  auth_failed, clock_skew, onvif_disabled, unreachable, target_not_permitted,
  invalid_response, action_not_supported, no_media_profiles, no_stream_uri
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import logging
import os
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

import httpx

from .netpolicy import SubnetPolicy, TargetNotPermitted
from .redact import redact_url
from .vault import Credentials
from .xmlsafe import UnsafeXML, child_text, find_local, findall_local, local, safe_fromstring

log = logging.getLogger(__name__)

NS_SOAP = "http://www.w3.org/2003/05/soap-envelope"
NS_TDS = "http://www.onvif.org/ver10/device/wsdl"
NS_TRT = "http://www.onvif.org/ver10/media/wsdl"
NS_TR2 = "http://www.onvif.org/ver20/media/wsdl"
NS_TT = "http://www.onvif.org/ver10/schema"
NS_WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
NS_WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
PASSWORD_DIGEST = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest"
BASE64_BINARY = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"

HTTP_SCHEMES = frozenset({"http", "https"})
RTSP_SCHEMES = frozenset({"rtsp", "rtsps"})
AUTH_FAULT_SUBCODES = {"NotAuthorized", "FailedAuthentication", "InvalidSecurity", "InvalidSecurityToken",
                       "FailedCheck", "SecurityTokenUnavailable", "MessageExpired"}


class OnvifError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def password_digest(nonce: bytes, created: str, password: str) -> str:
    return base64.b64encode(hashlib.sha1(nonce + created.encode("utf-8") + password.encode("utf-8")).digest()).decode()


def format_created(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{int((ts % 1) * 1000):03d}Z"


def security_header(creds: Credentials, created_ts: float, nonce: bytes | None = None) -> str:
    nonce = nonce if nonce is not None else os.urandom(16)
    created = format_created(created_ts)
    digest = password_digest(nonce, created, creds.password)
    return (
        f'<wsse:Security s:mustUnderstand="1" xmlns:wsse="{NS_WSSE}" xmlns:wsu="{NS_WSU}">'
        f'<wsse:UsernameToken><wsse:Username>{escape(creds.username)}</wsse:Username>'
        f'<wsse:Password Type="{PASSWORD_DIGEST}">{digest}</wsse:Password>'
        f'<wsse:Nonce EncodingType="{BASE64_BINARY}">{base64.b64encode(nonce).decode()}</wsse:Nonce>'
        f'<wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security>'
    )


def envelope(body: str, header: str = "") -> bytes:
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="{NS_SOAP}" '
        f'xmlns:tds="{NS_TDS}" xmlns:trt="{NS_TRT}" xmlns:tr2="{NS_TR2}" xmlns:tt="{NS_TT}">'
        f'<s:Header>{header}</s:Header><s:Body>{body}</s:Body></s:Envelope>'
    ).encode("utf-8")


@dataclass
class _Fault:
    subcodes: list[str]
    reason: str


def _parse_fault(root: ET.Element) -> _Fault | None:
    fault = find_local(root, "Fault")
    if fault is None:
        return None
    subcodes = []
    for v in findall_local(fault, "Value"):
        text = (v.text or "").strip()
        subcodes.append(text.split(":")[-1])
    reason_el = find_local(fault, "Text")
    if reason_el is None:
        reason_el = find_local(fault, "faultstring")
    return _Fault(subcodes, ((reason_el.text or "") if reason_el is not None else "")[:200])


class _AuthRejected(Exception):
    def __init__(self, http_status: int, digest_challenge: bool):
        self.http_status = http_status
        self.digest_challenge = digest_challenge


def _int(text: str | None) -> int | None:
    try:
        return int(text) if text not in (None, "") else None
    except ValueError:
        return None


def _float(text: str | None) -> float | None:
    try:
        return float(text) if text not in (None, "") else None
    except ValueError:
        return None


class OnvifClient:
    def __init__(self, device_xaddr: str, policy: SubnetPolicy, credentials: Credentials | None = None, *,
                 transport: httpx.BaseTransport | None = None, timeout: float = 5.0,
                 clock: Callable[[], float] = time.time, max_bytes: int = 1024 * 1024,
                 skew_threshold_s: float = 120.0):
        self.policy = policy
        self.device_xaddr = policy.check_url(device_xaddr, HTTP_SCHEMES)
        self.creds = credentials
        self._clock = clock
        self._max_bytes = max_bytes
        self._skew_threshold = skew_threshold_s
        self._http = httpx.Client(transport=transport, timeout=timeout, follow_redirects=False, trust_env=False,
                                  verify=False)  # cameras use self-signed certs; target is subnet-pinned
        self.clock_offset_s: float | None = None  # device clock minus edge clock
        self.auth_method: str | None = None  # "ws_usernametoken_digest" | "http_digest"
        self._compensate_clock = True

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "OnvifClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ---- transport -------------------------------------------------------
    def _send(self, url: str, action: str, body: str, *, wsse: bool, http_digest: bool) -> ET.Element:
        try:
            self.policy.check_url(url, HTTP_SCHEMES)
        except TargetNotPermitted as exc:
            raise OnvifError("target_not_permitted", exc.reason) from None
        header = ""
        if wsse and self.creds is not None:
            offset = (self.clock_offset_s or 0.0) if self._compensate_clock else 0.0
            header = security_header(self.creds, self._clock() + offset)
        auth = httpx.DigestAuth(self.creds.username, self.creds.password) if (http_digest and self.creds) else None
        headers = {"Content-Type": f'application/soap+xml; charset=utf-8; action="{action}"'}
        try:
            with self._http.stream("POST", url, content=envelope(body, header), headers=headers,
                                   auth=auth) as resp:
                data = bytearray()
                for chunk in resp.iter_bytes():
                    data += chunk
                    if len(data) > self._max_bytes:
                        raise OnvifError("invalid_response", "response_too_large")
                status = resp.status_code
                www_auth = resp.headers.get("WWW-Authenticate", "")
                ctype = resp.headers.get("Content-Type", "")
        except httpx.TimeoutException:
            raise OnvifError("unreachable", "timeout") from None
        except httpx.ConnectError:
            raise OnvifError("unreachable", "connect_failed") from None
        except httpx.TransportError as exc:
            raise OnvifError("unreachable", type(exc).__name__) from None
        if 300 <= status < 400:
            raise OnvifError("target_not_permitted", "redirect_rejected")
        if status == 401:
            raise _AuthRejected(401, "digest" in www_auth.lower())
        if status in (404, 405, 501) and b"Envelope" not in data:
            raise OnvifError("onvif_disabled", f"http_{status}")
        if not data or ("xml" not in ctype.lower() and not data.lstrip().startswith(b"<")):
            raise OnvifError("onvif_disabled", f"non_soap_response_http_{status}")
        try:
            root = safe_fromstring(bytes(data), max_bytes=self._max_bytes)
        except UnsafeXML as exc:
            raise OnvifError("invalid_response", str(exc)) from None
        fault = _parse_fault(root)
        if fault is not None:
            if AUTH_FAULT_SUBCODES & set(fault.subcodes):
                raise _AuthRejected(status, "digest" in www_auth.lower())
            if "ActionNotSupported" in fault.subcodes:
                raise OnvifError("action_not_supported", action.rsplit("/", 1)[-1])
            raise OnvifError("soap_fault", ",".join(fault.subcodes)[:200])
        if status >= 400:
            raise OnvifError("invalid_response", f"http_{status}")
        if local(root.tag) != "Envelope":
            raise OnvifError("invalid_response", "not_a_soap_envelope")
        return root

    def call(self, url: str, action: str, body: str, *, authenticated: bool = True) -> ET.Element:
        if not authenticated or self.creds is None:
            try:
                return self._send(url, action, body, wsse=False, http_digest=False)
            except _AuthRejected:
                raise OnvifError("auth_failed", "credentials_required") from None
        if self.auth_method == "http_digest":
            try:
                return self._send(url, action, body, wsse=False, http_digest=True)
            except _AuthRejected:
                raise OnvifError("auth_failed", "http_digest_rejected") from None
        try:
            root = self._send(url, action, body, wsse=True, http_digest=False)
            self.auth_method = "ws_usernametoken_digest"
            return root
        except _AuthRejected as rej:
            first = rej
        if first.http_status == 401 and first.digest_challenge:
            try:
                root = self._send(url, action, body, wsse=False, http_digest=True)
                self.auth_method = "http_digest"
                return root
            except _AuthRejected:
                pass
        if self.clock_offset_s is not None and abs(self.clock_offset_s) > self._skew_threshold:
            # Retry once with the edge's own clock in case the device mis-reports its UTC time.
            self._compensate_clock = False
            try:
                root = self._send(url, action, body, wsse=True, http_digest=False)
                self.auth_method = "ws_usernametoken_digest"
                return root
            except _AuthRejected:
                raise OnvifError("clock_skew", f"device clock differs by {self.clock_offset_s:.0f}s; "
                                 "authentication failed with and without compensation; fix camera NTP/time "
                                 "then retry") from None
            finally:
                self._compensate_clock = True
        raise OnvifError("auth_failed", "invalid_username_or_password")

    # ---- device service --------------------------------------------------
    def get_system_date_and_time(self) -> dict[str, Any]:
        t0 = self._clock()
        root = self.call(self.device_xaddr, f"{NS_TDS}/GetSystemDateAndTime",
                         "<tds:GetSystemDateAndTime/>", authenticated=False)
        t1 = self._clock()
        utc = find_local(root, "UTCDateTime")
        out: dict[str, Any] = {"date_time_type": child_text(find_local(root, "SystemDateAndTime"), "DateTimeType"),
                               "device_utc": None, "clock_offset_s": None}
        if utc is not None:
            t, d = find_local(utc, "Time"), find_local(utc, "Date")
            try:
                device = dt.datetime(
                    _int(child_text(d, "Year")) or 0, _int(child_text(d, "Month")) or 0,
                    _int(child_text(d, "Day")) or 0, _int(child_text(t, "Hour")) or 0,
                    _int(child_text(t, "Minute")) or 0, _int(child_text(t, "Second")) or 0,
                    tzinfo=dt.timezone.utc)
            except (TypeError, ValueError):
                device = None
            if device is not None:
                self.clock_offset_s = device.timestamp() - (t0 + t1) / 2
                out["device_utc"] = device.isoformat().replace("+00:00", "Z")
                out["clock_offset_s"] = round(self.clock_offset_s, 3)
        return out

    def get_device_information(self) -> dict[str, str | None]:
        root = self.call(self.device_xaddr, f"{NS_TDS}/GetDeviceInformation", "<tds:GetDeviceInformation/>")
        resp = find_local(root, "GetDeviceInformationResponse")
        if resp is None:
            raise OnvifError("invalid_response", "GetDeviceInformationResponse missing")
        return {
            "manufacturer": child_text(resp, "Manufacturer"),
            "model": child_text(resp, "Model"),
            "firmware_version": child_text(resp, "FirmwareVersion"),
            "serial_number": child_text(resp, "SerialNumber"),
            "hardware_id": child_text(resp, "HardwareId"),
        }

    def _validated_xaddr(self, url: str | None) -> str | None:
        if not url:
            return None
        try:
            return self.policy.check_url(url.strip(), HTTP_SCHEMES)
        except TargetNotPermitted as exc:
            log.warning("ignoring device-advertised XAddr %s (%s)", redact_url(url), exc.reason)
            return None

    def get_capabilities(self) -> dict[str, str | None]:
        root = self.call(self.device_xaddr, f"{NS_TDS}/GetCapabilities",
                         "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>")
        caps = find_local(root, "Capabilities")
        out: dict[str, str | None] = {"media": None, "device": None, "events": None}
        if caps is not None:
            for child in caps:
                name = local(child.tag).lower()
                if name in out:
                    out[name] = self._validated_xaddr(child_text(child, "XAddr"))
        return out

    def get_services(self) -> dict[str, str]:
        root = self.call(self.device_xaddr, f"{NS_TDS}/GetServices",
                         "<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>")
        out: dict[str, str] = {}
        for svc in findall_local(root, "Service"):
            ns, xaddr = child_text(svc, "Namespace"), self._validated_xaddr(child_text(svc, "XAddr"))
            if ns and xaddr:
                out[ns] = xaddr
        return out

    # ---- media -----------------------------------------------------------
    @staticmethod
    def _profile_from(el: ET.Element) -> dict[str, Any]:
        enc = find_local(el, "VideoEncoderConfiguration")
        if enc is None:
            enc = find_local(el, "VideoEncoder")
        res = find_local(enc, "Resolution") if enc is not None else None
        rate = find_local(enc, "RateControl") if enc is not None else None
        fps = None
        if rate is not None:
            fps = _float(child_text(rate, "FrameRateLimit")) or _float(rate.get("FrameRateLimit"))
        encoding = None
        if enc is not None:
            encoding = child_text(enc, "Encoding") or enc.get("Encoding")
        return {
            "token": el.get("token"),
            "name": child_text(el, "Name"),
            "encoding": (encoding or "").upper() or None,
            "width": _int(child_text(res, "Width")) if res is not None else None,
            "height": _int(child_text(res, "Height")) if res is not None else None,
            "fps_limit": fps,
        }

    def get_profiles(self, media_xaddr: str, media2: bool = False) -> list[dict[str, Any]]:
        if media2:
            root = self.call(media_xaddr, f"{NS_TR2}/GetProfiles",
                             "<tr2:GetProfiles><tr2:Type>All</tr2:Type></tr2:GetProfiles>")
        else:
            root = self.call(media_xaddr, f"{NS_TRT}/GetProfiles", "<trt:GetProfiles/>")
        profiles = [self._profile_from(p) for p in findall_local(root, "Profiles") if p.get("token")]
        return profiles

    def _uri(self, root: ET.Element, schemes: frozenset[str]) -> str | None:
        uri_el = find_local(root, "Uri")
        uri = (uri_el.text or "").strip() if uri_el is not None else ""
        if not uri:
            return None
        try:
            return self.policy.check_url(uri, schemes)
        except TargetNotPermitted as exc:
            raise OnvifError("target_not_permitted", f"device-provided URI rejected ({exc.reason})") from None

    def get_stream_uri(self, media_xaddr: str, token: str, media2: bool = False) -> str:
        t = escape(token)
        if media2:
            root = self.call(media_xaddr, f"{NS_TR2}/GetStreamUri",
                             f"<tr2:GetStreamUri><tr2:Protocol>RTSP</tr2:Protocol>"
                             f"<tr2:ProfileToken>{t}</tr2:ProfileToken></tr2:GetStreamUri>")
        else:
            root = self.call(media_xaddr, f"{NS_TRT}/GetStreamUri",
                             "<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream>"
                             "<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup>"
                             f"<trt:ProfileToken>{t}</trt:ProfileToken></trt:GetStreamUri>")
        uri = self._uri(root, RTSP_SCHEMES)
        if not uri:
            raise OnvifError("no_stream_uri")
        return uri

    def get_snapshot_uri(self, media_xaddr: str, token: str, media2: bool = False) -> str | None:
        t = escape(token)
        ns = "tr2" if media2 else "trt"
        try:
            root = self.call(media_xaddr, f"{NS_TR2 if media2 else NS_TRT}/GetSnapshotUri",
                             f"<{ns}:GetSnapshotUri><{ns}:ProfileToken>{t}</{ns}:ProfileToken></{ns}:GetSnapshotUri>")
        except OnvifError as exc:
            if exc.code in ("action_not_supported", "soap_fault"):
                return None
            raise
        return self._uri(root, HTTP_SCHEMES)


def select_profile(profiles: list[dict[str, Any]], stream_profile: str) -> dict[str, Any] | None:
    """substream -> smallest H.264/H.265 profile; mainstream -> largest."""
    usable = [p for p in profiles if p.get("encoding") in ("H264", "H265", "HEVC") and p.get("width") and p.get("height")]
    if not usable:
        usable = [p for p in profiles if p.get("token")]
    if not usable:
        return None
    key = lambda p: (p.get("width") or 0) * (p.get("height") or 0)  # noqa: E731
    return min(usable, key=key) if stream_profile == "substream" else max(usable, key=key)


def probe_device(client: OnvifClient, stream_profile: str = "substream") -> dict[str, Any]:
    """Full authenticated ONVIF probe. Raises OnvifError with a distinct code on failure."""
    report: dict[str, Any] = {"device_xaddr": client.device_xaddr}
    report["time"] = client.get_system_date_and_time()
    report["device"] = client.get_device_information()
    report["auth_method"] = client.auth_method
    media_xaddr, media2 = None, False
    try:
        caps = client.get_capabilities()
        media_xaddr = caps.get("media")
    except OnvifError as exc:
        if exc.code not in ("action_not_supported", "soap_fault", "invalid_response"):
            raise
    if media_xaddr is None:
        services = client.get_services()
        if NS_TRT in services:
            media_xaddr = services[NS_TRT]
        elif NS_TR2 in services:
            media_xaddr, media2 = services[NS_TR2], True
    if media_xaddr is None:
        raise OnvifError("no_media_profiles", "no permitted Media service XAddr")
    report["media_service"] = "media2" if media2 else "media1"
    profiles = client.get_profiles(media_xaddr, media2)
    report["profiles"] = profiles
    chosen = select_profile(profiles, stream_profile)
    if chosen is None:
        raise OnvifError("no_media_profiles")
    report["selected_profile"] = chosen
    report["stream_uri"] = client.get_stream_uri(media_xaddr, chosen["token"], media2)
    report["snapshot_uri"] = client.get_snapshot_uri(media_xaddr, chosen["token"], media2)
    report["conformance"] = "onvif_profile_query_ok"
    return report


def device_service_url(address: str) -> str:
    """Accept 'IP', 'IP:port' or a full http(s) device-service URL."""
    address = address.strip()
    if "://" in address:
        return address
    host = address
    if host.count(":") > 1 and not host.startswith("["):  # bare IPv6
        host = f"[{host}]"
    return f"http://{host}/onvif/device_service"


def address_host(address: str) -> str:
    return urlsplit(device_service_url(address)).hostname or ""
