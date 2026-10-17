import base64
import hashlib
import json
import secrets
import time
import uuid

from nacl.public import PrivateKey, SealedBox
from nacl.signing import SigningKey

from conftest import Client


class Edge:
    def __init__(self, app):
        from fastapi.testclient import TestClient
        # Each appliance has its own source address, so pairing rate limits do not leak between tests.
        host = f"10.250.{secrets.randbelow(250)}.{secrets.randbelow(250) + 1}"
        self.c = TestClient(app, base_url="https://retailguard.test", raise_server_exceptions=False,
                            client=(host, 50000))
        self.sign = SigningKey.generate()
        self.box = PrivateKey.generate()
        self.id = None

    def pair(self, code):
        r = self.c.post("/v1/edge/pair", json={
            "code": code, "device_name": "Store appliance", "software_version": "test",
            "sign_public_key": base64.b64encode(bytes(self.sign.verify_key)).decode(),
            "box_public_key": base64.b64encode(bytes(self.box.public_key)).decode()})
        if r.status_code == 201:
            self.id = r.json()["edge_id"]
            self.info = r.json()
        return r

    def req(self, method, path, body=b"", headers=None, nonce=None, ts=None, key=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        ts = str(ts or int(time.time()))
        nonce = nonce or secrets.token_hex(16)
        canonical = f"{method}\n{path}\n{ts}\n{nonce}\n{hashlib.sha256(body).hexdigest()}".encode()
        sig = (key or self.sign).sign(canonical).signature
        h = {"X-Edge-Id": self.id, "X-Edge-Timestamp": ts, "X-Edge-Nonce": nonce,
             "X-Edge-Signature": base64.b64encode(sig).decode(), "Content-Type": "application/json"}
        h.update(headers or {})
        return self.c.request(method, path, content=body, headers=h)


def paired_edge(org):
    admin, store = org["admin"], org["store"]
    code = admin.post(f"/v1/stores/{store['id']}/edge-pairing-codes", json={"device_name": "Edge 1"}).json()["code"]
    edge = Edge(org["app"])
    assert edge.pair(code).status_code == 201
    assert edge.pair(code).status_code == 401  # single use
    assert edge.req("POST", "/v1/edge/heartbeat", {"software_version": "t", "cameras": []}).status_code == 200
    return edge


def test_signed_edge_requests_reject_bad_signature_replay_and_skew(org):
    edge = paired_edge(org)
    assert edge.req("POST", "/v1/edge/heartbeat", {}, key=SigningKey.generate()).json()["code"] == "edge_signature_invalid"
    nonce = secrets.token_hex(16)
    assert edge.req("POST", "/v1/edge/heartbeat", {}, nonce=nonce).status_code == 200
    assert edge.req("POST", "/v1/edge/heartbeat", {}, nonce=nonce).json()["code"] == "edge_replay"
    assert edge.req("POST", "/v1/edge/heartbeat", {}, ts=int(time.time()) - 3600).json()["code"] == "edge_clock_skew"
    # revoked appliances are refused
    admin = org["admin"]
    assert admin.post(f"/v1/edges/{edge.id}/revoke", json={"reason": "stolen"}).status_code == 200
    assert edge.req("POST", "/v1/edge/heartbeat", {}).json()["code"] == "edge_revoked"


def test_camera_ssrf_rejection_credentials_sealed_and_readiness_gate(org):
    admin, store = org["admin"], org["store"]
    for bad in ("169.254.169.254", "127.0.0.1", "8.8.8.8", "10.99.0.5", "camera.local"):
        r = admin.post("/v1/cameras", json={"store_id": store["id"], "name": "x", "address": bad})
        assert r.status_code == 422, bad
    # credentials need a paired appliance (they are sealed to its key)
    r = admin.post("/v1/cameras", json={"store_id": store["id"], "name": "Entrance", "address": "10.20.1.10",
                                        "username": "viewer", "password": "cam-pass"})
    assert r.status_code == 409 and r.json()["code"] == "edge_required"
    edge = paired_edge(org)
    r = admin.post("/v1/cameras", json={"store_id": store["id"], "name": "Entrance", "location": "Door",
                                        "address": "10.20.1.10", "username": "viewer", "password": "cam-pass"})
    cam = r.json()
    assert r.status_code == 201 and cam["readiness"] == "pending" and cam["analysis_state"] == "unavailable"
    assert "cam-pass" not in r.text and cam["has_credentials"] is True
    # activation refused until the edge verifies decoded frames
    r = admin.post(f"/v1/cameras/{cam['id']}/activate", json={"expected_version": cam["version"], "channels": ["behavior"]})
    assert r.status_code == 409 and r.json()["code"] == "camera_not_ready"
    cmds = edge.req("GET", "/v1/edge/commands").json()["items"]
    prov = next(c for c in cmds if c["kind"] == "provision_camera")
    creds = json.loads(SealedBox(edge.box).decrypt(base64.b64decode(prov["payload"]["credential_sealed"])))
    assert creds == {"username": "viewer", "password": "cam-pass"}
    # A handshake without 10 s of decoded frames is not readiness
    edge.req("POST", f"/v1/edge/commands/{prov['id']}/ack",
             {"status": "succeeded", "result": {"readiness": "ready", "report": {"decoded_seconds": 3, "codec": "h264"}}})
    cam = admin.get(f"/v1/cameras/{cam['id']}").json()
    assert cam["readiness"] == "degraded"
    r = admin.post(f"/v1/cameras/{cam['id']}/provision")
    prov2 = next(c for c in edge.req("GET", "/v1/edge/commands").json()["items"] if c["kind"] == "provision_camera")
    edge.req("POST", f"/v1/edge/commands/{prov2['id']}/ack",
             {"status": "succeeded", "result": {"readiness": "ready", "report": {"decoded_seconds": 10.4, "codec": "h264",
                                                                                 "width": 640, "height": 360, "fps": 15}}})
    cam = admin.get(f"/v1/cameras/{cam['id']}").json()
    assert cam["readiness"] == "ready"
    r = admin.post(f"/v1/cameras/{cam['id']}/activate", json={"expected_version": cam["version"], "channels": ["behavior", "watchlist"]})
    assert r.status_code == 202 and r.json()["camera"]["analysis_state"] == "activation_requested"
    act = next(c for c in edge.req("GET", "/v1/edge/commands").json()["items"] if c["kind"] == "activate_camera")
    edge.req("POST", f"/v1/edge/commands/{act['id']}/ack", {"status": "succeeded", "result": {"channels": {
        "behavior": {"state": "unavailable", "reason": "model_not_installed"},
        "watchlist": {"state": "unavailable", "reason": "face_sdk_unavailable"}}}})
    cam = admin.get(f"/v1/cameras/{cam['id']}").json()
    # no model installed → never "analyzing"
    assert cam["analysis_state"] == "unavailable"
    assert cam["channels"]["behavior"]["reason"] == "model_not_installed"


def test_event_ingest_is_idempotent_and_evidence_checksum_verified(org):
    admin, store = org["admin"], org["store"]
    edge = paired_edge(org)
    cam = admin.post("/v1/cameras", json={"store_id": store["id"], "name": "Aisle", "address": "10.20.1.11"}).json()
    clip = b"\x00\x00\x00\x18ftypmp42" + secrets.token_bytes(2048)
    event = {"event_id": "evt-" + uuid.uuid4().hex, "org_id": edge.info["org_id"], "store_id": store["id"],
             "camera_id": cam["id"], "channel": "behavior_candidate", "captured_at": "2026-10-11T01:42:18Z",
             "model_version": "test-model", "preprocessing_version": "p1", "gate_reason": "behavior_candidate_requires_review",
             "signals": {"anomaly": 0.8, "item_interaction": 0.7, "concealment_motion": 0.7, "visibility": 0.9},
             "evidence_state": "pending", "evidence_sha256": hashlib.sha256(clip).hexdigest(), "uncertainty": ["hands occluded 0.4s"]}
    hdr = {"Idempotency-Key": event["event_id"]}
    r1 = edge.req("POST", "/v1/edge/events", event, headers=hdr)
    r2 = edge.req("POST", "/v1/edge/events", event, headers=hdr)
    assert r1.status_code == 200 and r2.json()["duplicate"] is True and r1.json()["incident_id"] == r2.json()["incident_id"]
    bad = dict(event, store_id=org["store_b"]["id"], event_id="evt-x" + uuid.uuid4().hex)
    assert edge.req("POST", "/v1/edge/events", bad, headers={"Idempotency-Key": bad["event_id"]}).status_code == 403
    invalid = dict(event, event_id="evt-y", signals={"anomaly": 3})
    assert edge.req("POST", "/v1/edge/events", invalid, headers={"Idempotency-Key": "evt-y"}).status_code == 422
    inc_id = r1.json()["incident_id"]
    inc = admin.get(f"/v1/incidents/{inc_id}").json()
    assert inc["evidence_state"] == "pending" and inc["delayed"] is True
    # cannot confirm while evidence pending
    claimed = admin.post(f"/v1/incidents/{inc_id}/claim", json={"expected_version": inc["version"]}).json()
    r = admin.post(f"/v1/incidents/{inc_id}/outcome", json={"expected_version": claimed["version"], "outcome": "confirmed", "reason": "x"})
    assert r.json()["code"] == "evidence_pending"
    path = f"/v1/edge/events/{event['event_id']}/evidence"
    assert edge.req("PUT", path, clip, headers={"X-Content-SHA256": "0" * 64, "Content-Type": "video/mp4"}).status_code == 422
    r = edge.req("PUT", path, clip, headers={"X-Content-SHA256": hashlib.sha256(clip).hexdigest(), "Content-Type": "video/mp4"})
    assert r.status_code == 200
    inc = admin.get(f"/v1/incidents/{inc_id}").json()
    assert inc["evidence_state"] == "available" and inc["evidence"][0]["sha256"] == hashlib.sha256(clip).hexdigest()
    media = admin.get(f"/v1/media/{inc['evidence'][0]['media_id']}")
    assert media.status_code == 200 and media.content == clip


def test_discovery_job_round_trip(org):
    admin, store = org["admin"], org["store"]
    r = admin.post("/v1/discovery-jobs", json={"store_id": store["id"], "interface": "10.20.0.2"})
    assert r.status_code == 503 and r.json()["code"] == "edge_unavailable"
    edge = paired_edge(org)
    job = admin.post("/v1/discovery-jobs", json={"store_id": store["id"], "interface": "10.20.0.2", "timeout_s": 3}).json()
    cmd = next(c for c in edge.req("GET", "/v1/edge/commands").json()["items"] if c["kind"] == "discover")
    assert cmd["payload"]["job_id"] == job["id"]
    edge.req("POST", f"/v1/edge/commands/{cmd['id']}/ack", {"status": "succeeded", "result": {"devices": [
        {"endpoint": "urn:uuid:cam-1", "address": "10.20.1.50", "xaddrs": ["http://10.20.1.50/onvif/device_service"],
         "scopes": ["onvif://www.onvif.org/name/TestCam"]}]}})
    job = admin.get(f"/v1/discovery-jobs/{job['id']}").json()
    assert job["status"] == "completed" and job["devices"][0]["address"] == "10.20.1.50"
    r = admin.post(f"/v1/discovery-jobs/{job['id']}/add", json={"endpoint": "urn:uuid:cam-1", "name": "Door"})
    assert r.status_code == 201 and r.json()["readiness"] == "pending"
    assert admin.post(f"/v1/discovery-jobs/{job['id']}/add", json={"endpoint": "urn:uuid:other", "name": "X"}).status_code == 422


def test_csv_import_never_silently_skips(org):
    admin, store = org["admin"], org["store"]
    csv = "name,location,address\nDoor,Entrance,10.20.2.1\nBad,Aisle,8.8.8.8\nDup,Aisle,10.20.2.1\n"
    r = admin.post("/v1/cameras/import", json={"store_id": store["id"], "csv": csv, "dry_run": True}).json()
    assert [x["status"] for x in r["rows"]] == ["valid", "invalid", "invalid"]
    r = admin.post("/v1/cameras/import", json={"store_id": store["id"], "csv": csv, "dry_run": False})
    assert r.status_code == 422
    assert admin.get(f"/v1/cameras?store_id={store['id']}").json()["items"] == []


def test_zones_validation_and_versioning(org):
    admin, store = org["admin"], org["store"]
    cam = admin.post("/v1/cameras", json={"store_id": store["id"], "name": "Aisle", "address": "10.20.3.1"}).json()
    bad = admin.put(f"/v1/cameras/{cam['id']}/zones", json={"expected_version": 0, "zones": [
        {"type": "shelf", "points": [[0, 0], [1.5, 0], [1, 1]]}]})
    assert bad.status_code == 422
    ok = admin.put(f"/v1/cameras/{cam['id']}/zones", json={"expected_version": 0, "zones": [
        {"type": "shelf", "label": "Cosmetics", "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.6]]},
        {"type": "exit_line", "points": [[0, 0.9], [1, 0.9]], "direction": "out"}]})
    assert ok.status_code == 200 and ok.json()["version"] == 1
    assert admin.put(f"/v1/cameras/{cam['id']}/zones", json={"expected_version": 0, "zones": []}).status_code == 409


def test_webhook_signature_and_replay(org):
    import hmac
    admin, store = org["admin"], org["store"]
    integ = admin.post("/v1/integrations", json={"store_id": store["id"], "kind": "pos", "name": "POS lane 1"}).json()
    secret = integ["webhook_secret"]
    anon = Client(org["app"])
    body = json.dumps({"events": [{"kind": "scan", "lane": "1", "transaction_id": "T1", "barcode": "4901234567890",
                                   "occurred_at": "2026-10-11T01:42:00Z"}]}).encode()
    ts, nonce = str(int(time.time())), secrets.token_hex(16)
    sig = hmac.new(secret.encode(), f"{ts}.{nonce}.".encode() + body, hashlib.sha256).hexdigest()
    h = {"X-RG-Timestamp": ts, "X-RG-Nonce": nonce, "X-RG-Signature": sig, "Content-Type": "application/json"}
    url = f"/v1/integrations/{integ['id']}/webhook"
    assert anon.c.post(url, content=body, headers=h).json() == {"accepted": 1}
    assert anon.c.post(url, content=body, headers=h).status_code == 409
    h2 = dict(h, **{"X-RG-Nonce": secrets.token_hex(16)})
    assert anon.c.post(url, content=body, headers=h2).status_code == 401
    assert admin.get("/v1/integrations").json()["items"][0]["status"] == "receiving"


WIN_CAM = r"dshow:@device_pnp_\\?\usb#vid_04f2&pid_b6be&mi_00#6&2e0c5b07&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\global"


def test_discovery_without_interface_lists_usb_cameras_and_adds_them(org):
    admin, store = org["admin"], org["store"]
    edge = paired_edge(org)
    r = admin.post("/v1/discovery-jobs", json={"store_id": store["id"]})
    assert r.status_code == 202, r.text
    job = r.json()
    cmd = next(c for c in edge.req("GET", "/v1/edge/commands").json()["items"] if c["kind"] == "discover")
    assert cmd["payload"]["interface"] is None and cmd["payload"]["include_usb"] is True
    usb = "/dev/v4l/by-id/usb-046d_HD_Pro_Webcam_C920_ABC123-video-index0"
    edge.req("POST", f"/v1/edge/commands/{cmd['id']}/ack", {"status": "succeeded", "result": {
        "devices": [], "usb_devices": [{"device": usb, "node": "/dev/video0", "name": "HD Pro Webcam C920"},
                                       {"device": "/etc/passwd", "name": "bad"},
                                       {"device": WIN_CAM, "name": "Integrated Camera"},
                                       {"device": 'dshow:a" -i x', "name": "bad"},
                                       {"device": "dshow:video=a:audio=b", "name": "bad"}]}})
    job = admin.get(f"/v1/discovery-jobs/{job['id']}").json()
    assert [(d["kind"], d["address"], d["model"]) for d in job["devices"]] == [
        ("usb", usb, "HD Pro Webcam C920"), ("usb", WIN_CAM, "Integrated Camera")]
    r = admin.post(f"/v1/discovery-jobs/{job['id']}/add", json={"endpoint": "usb:" + usb, "name": "Register 1"})
    assert r.status_code == 201, r.text
    cam = r.json()
    assert cam["source_type"] == "usb" and cam["address"] == usb and cam["readiness"] == "pending"
    prov = next(c for c in edge.req("GET", "/v1/edge/commands").json()["items"] if c["kind"] == "provision_camera")
    assert prov["payload"]["source_type"] == "usb" and prov["payload"]["address"] == usb
    assert prov["payload"]["credential_sealed"] is None
    # listed as already added on the next scan
    job2 = admin.post("/v1/discovery-jobs", json={"store_id": store["id"]}).json()
    cmd2 = next(c for c in edge.req("GET", "/v1/edge/commands").json()["items"] if c["kind"] == "discover")
    edge.req("POST", f"/v1/edge/commands/{cmd2['id']}/ack", {"status": "succeeded", "result": {
        "devices": [], "usb_devices": [{"device": usb, "name": "HD Pro Webcam C920"}]}})
    assert admin.get(f"/v1/discovery-jobs/{job2['id']}").json()["devices"][0]["already_added"] is True


def test_add_camera_by_rtsp_url_seals_credentials_and_allows_nvr_channels(org):
    admin, store = org["admin"], org["store"]
    url = "rtsp://viewer:p%40ss%3Aword@10.20.1.60:8554/cam/realmonitor?channel=1&subtype=1"
    r = admin.post("/v1/cameras/rtsp", json={"store_id": store["id"], "name": "NVR ch1", "url": url})
    assert r.status_code == 409 and r.json()["code"] == "edge_required"
    edge = paired_edge(org)
    for bad, code in (("http://10.20.1.60/stream", "rtsp_url_required"), ("rtsp://169.254.169.254/x", "address_not_permitted"),
                      ("rtsp://camera.local/x", "ip_address_required"), ("rtsp://10.20.1.60:99999/x", "rtsp_url_required"),
                      ("rtsp://10.20.1.60/a b", "invalid_rtsp_path")):
        r = admin.post("/v1/cameras/rtsp", json={"store_id": store["id"], "name": "x", "url": bad})
        assert r.status_code == 422 and r.json()["field_errors"] == {"url": code}, bad
    r = admin.post("/v1/cameras/rtsp", json={"store_id": store["id"], "name": "NVR ch1", "location": "Back office", "url": url})
    assert r.status_code == 201, r.text
    cam = r.json()
    assert "p@ss" not in r.text and "word" not in r.text and cam["has_credentials"] is True
    assert (cam["source_type"], cam["address"], cam["rtsp_port"], cam["rtsp_scheme"], cam["rtsp_path"]) == (
        "rtsp", "10.20.1.60", 8554, "rtsp", "/cam/realmonitor?channel=1&subtype=1")
    prov = next(c for c in edge.req("GET", "/v1/edge/commands").json()["items"] if c["kind"] == "provision_camera")
    p = prov["payload"]
    assert (p["source_type"], p["rtsp_port"], p["rtsp_path"]) == ("rtsp", 8554, "/cam/realmonitor?channel=1&subtype=1")
    assert json.loads(SealedBox(edge.box).decrypt(base64.b64decode(p["credential_sealed"]))) == {
        "username": "viewer", "password": "p@ss:word"}
    # same URL again is a duplicate; another channel of the same NVR is a different camera
    r = admin.post("/v1/cameras/rtsp", json={"store_id": store["id"], "name": "dup", "url": url})
    assert r.status_code == 422 and r.json()["field_errors"] == {"url": "duplicate"}
    r = admin.post("/v1/cameras/rtsp", json={"store_id": store["id"], "name": "NVR ch2", "username": "viewer",
                                             "password": "pw2", "url": "rtsp://10.20.1.60:8554/cam/realmonitor?channel=2&subtype=1"})
    assert r.status_code == 201 and r.json()["has_credentials"] is True
    audit = admin.get("/v1/audit?action=camera.created_pending").json()["items"]
    assert "p@ss" not in json.dumps(audit) and "pw2" not in json.dumps(audit)


def test_heartbeat_announces_allowed_camera_subnets(org):
    from retailguard_api.settings import get_settings
    edge = paired_edge(org)
    r = edge.req("POST", "/v1/edge/heartbeat", {"software_version": "t", "cameras": []})
    configured = [str(n) for n in get_settings().edge_allowed_subnets]
    assert r.json()["allowed_subnets"] == (configured or ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"])
    assert edge.info["allowed_subnets"] == r.json()["allowed_subnets"]


def test_unconfigured_subnets_mean_private_ranges(monkeypatch):
    from types import SimpleNamespace
    from retailguard_api.routers import edge as edge_router
    monkeypatch.setattr(edge_router, "get_settings", lambda: SimpleNamespace(edge_allowed_subnets=()))
    assert edge_router.allowed_subnets() == ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
