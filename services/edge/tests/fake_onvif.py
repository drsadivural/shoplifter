"""In-test ONVIF device: canned SOAP responses + real credential verification.

Verifies WS-Security UsernameToken PasswordDigest exactly as a device would
(Base64(SHA1(nonce + created + password)), Created within a window of the
device clock), or RFC 7616 HTTP Digest (MD5, qop=auth) in `digest_only` mode.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import re
import threading
import time
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

S = "http://www.w3.org/2003/05/soap-envelope"
WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"


def env(body: str) -> bytes:
    return (f'<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="{S}" '
            'xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" '
            'xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:ter="http://www.onvif.org/ver10/error">'
            f'<s:Body>{body}</s:Body></s:Envelope>').encode()


NOT_AUTHORIZED = env('<s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:NotAuthorized</s:Value>'
                     '</s:Subcode></s:Code><s:Reason><s:Text xml:lang="en">Sender not authorized</s:Text></s:Reason>'
                     '</s:Fault>')


class FakeOnvif:
    def __init__(self, host: str, *, username: str = "viewer", password: str = "pa55:w@rd",
                 clock_offset_s: float = 0.0, created_window_s: float = 10.0, mode: str = "wsse",
                 stream_uri: str | None = None, reject_all: bool = False):
        self.host, self.username, self.password = host, username, password
        self.clock_offset_s, self.window, self.mode = clock_offset_s, created_window_s, mode
        self.reject_all = reject_all
        self.stream_uri = stream_uri
        self.log: list[dict] = []
        self.realm, self.nonce = "onvif-test", base64.b64encode(b"fixed-nonce-1234").decode()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                fake.handle(self, body)

        self.server = ThreadingHTTPServer((host, 0), Handler)
        self.port = self.server.server_address[1]
        self.base = f"http://{host}:{self.port}"
        if self.stream_uri is None:
            self.stream_uri = f"rtsp://{host}:8554/test"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()

    @property
    def device_url(self) -> str:
        return f"{self.base}/onvif/device_service"

    def device_now(self) -> float:
        return time.time() + self.clock_offset_s

    # ---- auth verification ----
    def check_wsse(self, root: ET.Element) -> tuple[bool, str]:
        tok = root.find(f".//{{{WSSE}}}UsernameToken")
        if tok is None:
            return False, "missing"
        user = tok.findtext(f"{{{WSSE}}}Username")
        pw = tok.find(f"{{{WSSE}}}Password")
        nonce = base64.b64decode(tok.findtext(f"{{{WSSE}}}Nonce") or "")
        created = tok.findtext(f"{{{WSU}}}Created") or ""
        if pw is None or not pw.get("Type", "").endswith("#PasswordDigest"):
            return False, "not_digest"
        expected = base64.b64encode(hashlib.sha1(nonce + created.encode() + self.password.encode()).digest()).decode()
        created_ts = dt.datetime.strptime(created.rstrip("Z").split(".")[0], "%Y-%m-%dT%H:%M:%S").replace(
            tzinfo=dt.timezone.utc).timestamp()
        if abs(created_ts - self.device_now()) > self.window:
            return False, "created_outside_window"
        if user != self.username or pw.text != expected:
            return False, "bad_digest"
        return True, "ok"

    def check_http_digest(self, handler, method: str = "POST") -> bool:
        h = handler.headers.get("Authorization", "")
        if not h.startswith("Digest "):
            return False
        f = dict(re.findall(r'(\w+)="?([^",]+)"?', h[7:]))
        md5 = lambda s: hashlib.md5(s.encode()).hexdigest()  # noqa: E731
        ha1 = md5(f"{f.get('username')}:{self.realm}:{self.password}")
        ha2 = md5(f"{method}:{f.get('uri')}")
        expect = md5(f"{ha1}:{f.get('nonce')}:{f.get('nc')}:{f.get('cnonce')}:{f.get('qop')}:{ha2}")
        return f.get("username") == self.username and f.get("response") == expect and f.get("nonce") == self.nonce

    def send(self, handler, status: int, data: bytes, ctype: str = "application/soap+xml; charset=utf-8",
             extra: dict | None = None):
        handler.send_response(status)
        handler.send_header("Content-Type", ctype)
        handler.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            handler.send_header(k, v)
        handler.end_headers()
        handler.wfile.write(data)

    def handle(self, handler, body: bytes):
        if self.mode == "disabled":
            return self.send(handler, 404, b"<html>Not Found</html>", "text/html")
        if self.mode == "redirect":
            return self.send(handler, 302, b"", "text/plain", {"Location": "http://169.254.169.254/latest/"})
        if self.mode == "dtd":
            evil = (b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>'
                    b'<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>&lol2;</s:Body></s:Envelope>')
            return self.send(handler, 200, evil)
        root = ET.fromstring(body)
        body_el = root.find(f"{{{S}}}Body")
        op = body_el[0].tag.rsplit("}", 1)[-1] if body_el is not None and len(body_el) else ""
        entry = {"op": op, "path": handler.path, "auth": None}
        self.log.append(entry)
        if op != "GetSystemDateAndTime":
            if self.mode == "digest_only":
                if not self.check_http_digest(handler):
                    entry["auth"] = "http_digest_challenge"
                    return self.send(handler, 401, b"", "text/plain", {
                        "WWW-Authenticate": f'Digest realm="{self.realm}", nonce="{self.nonce}", qop="auth", algorithm=MD5'})
                entry["auth"] = "http_digest_ok"
            else:
                ok, why = self.check_wsse(root)
                entry["auth"] = why
                if not ok or self.reject_all:
                    return self.send(handler, 400, NOT_AUTHORIZED)
        return self.send(handler, 200, env(self.response(op, body_el)))

    def response(self, op: str, body_el) -> str:
        if op == "GetSystemDateAndTime":
            t = dt.datetime.fromtimestamp(self.device_now(), dt.timezone.utc)
            return ("<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:DateTimeType>NTP</tt:DateTimeType>"
                    "<tt:DaylightSavings>false</tt:DaylightSavings><tt:UTCDateTime>"
                    f"<tt:Time><tt:Hour>{t.hour}</tt:Hour><tt:Minute>{t.minute}</tt:Minute><tt:Second>{t.second}</tt:Second></tt:Time>"
                    f"<tt:Date><tt:Year>{t.year}</tt:Year><tt:Month>{t.month}</tt:Month><tt:Day>{t.day}</tt:Day></tt:Date>"
                    "</tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>")
        if op == "GetDeviceInformation":
            return ("<tds:GetDeviceInformationResponse><tds:Manufacturer>TestVendor</tds:Manufacturer>"
                    "<tds:Model>TV-100</tds:Model><tds:FirmwareVersion>1.2.3</tds:FirmwareVersion>"
                    "<tds:SerialNumber>SN0001</tds:SerialNumber><tds:HardwareId>HW1</tds:HardwareId>"
                    "</tds:GetDeviceInformationResponse>")
        if op == "GetCapabilities":
            return ("<tds:GetCapabilitiesResponse><tds:Capabilities>"
                    f"<tt:Device><tt:XAddr>{self.base}/onvif/device_service</tt:XAddr></tt:Device>"
                    "<tt:Events><tt:XAddr>http://169.254.169.254/events</tt:XAddr></tt:Events>"
                    f"<tt:Media><tt:XAddr>{self.base}/onvif/media_service</tt:XAddr></tt:Media>"
                    "</tds:Capabilities></tds:GetCapabilitiesResponse>")
        if op == "GetProfiles":
            def prof(token, name, w, h, fps):
                return (f'<trt:Profiles token="{token}" fixed="true"><tt:Name>{name}</tt:Name>'
                        f'<tt:VideoEncoderConfiguration token="vec_{token}"><tt:Name>{name}</tt:Name>'
                        f'<tt:Encoding>H264</tt:Encoding><tt:Resolution><tt:Width>{w}</tt:Width>'
                        f'<tt:Height>{h}</tt:Height></tt:Resolution><tt:RateControl>'
                        f'<tt:FrameRateLimit>{fps}</tt:FrameRateLimit></tt:RateControl>'
                        f'</tt:VideoEncoderConfiguration></trt:Profiles>')
            return ("<trt:GetProfilesResponse>" + prof("Profile_1", "mainStream", 1920, 1080, 25)
                    + prof("Profile_2", "subStream", 640, 360, 15) + "</trt:GetProfilesResponse>")
        if op == "GetStreamUri":
            return (f"<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>{self.stream_uri}</tt:Uri>"
                    "<tt:InvalidAfterConnect>false</tt:InvalidAfterConnect></trt:MediaUri></trt:GetStreamUriResponse>")
        if op == "GetSnapshotUri":
            return (f"<trt:GetSnapshotUriResponse><trt:MediaUri><tt:Uri>{self.base}/snap.jpg</tt:Uri>"
                    "</trt:MediaUri></trt:GetSnapshotUriResponse>")
        return ('<s:Fault><s:Code><s:Value>s:Receiver</s:Value><s:Subcode><s:Value>ter:ActionNotSupported</s:Value>'
                '</s:Subcode></s:Code><s:Reason><s:Text xml:lang="en">unsupported</s:Text></s:Reason></s:Fault>')
