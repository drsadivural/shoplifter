import io
import os
from pathlib import Path

from PIL import Image

from conftest import invite_and_login

ASSETS = Path(__file__).resolve().parents[3] / "assets"


def jpeg_with_gps() -> bytes:
    img = Image.open(ASSETS / "portrait-1.jpg").convert("RGB")
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    exif[0x8825] = {1: "N", 2: (35.0, 41.0, 0.0)}  # GPS IFD
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


def upload(cl, pid, data, name="p.jpg"):
    return cl.c.post(f"/v1/profiles/{pid}/photos", files={"file": (name, data, "image/jpeg")},
                     data={"provenance": "Captured at enrollment desk with consent notice"},
                     headers={"X-CSRF-Token": cl.c.cookies.get("rg_csrf")})


def test_watchlist_enrollment_requires_confirmed_incident_photo_and_second_approver(org):
    app, admin, store = org["app"], org["admin"], org["store"]
    store_admin, _ = invite_and_login(app, admin, "store_admin", [store["id"]])
    inc = admin.post("/v1/incidents", json={"store_id": store["id"], "description": "Observed concealment"}).json()
    base = {"kind": "watchlist", "reference": "WL-0001", "basis": "Confirmed concealment incident reviewed on footage",
            "store_ids": [store["id"]], "expires_at": "2027-06-30T00:00:00Z"}
    # future "last seen" is rejected
    assert store_admin.post("/v1/profiles", json=dict(base, reference="WL-F", last_seen_at="2099-01-01T00:00:00Z")).status_code == 422
    p = store_admin.post("/v1/profiles", json=dict(base, source_incident_id=inc["id"], display_name="Yamada Taro",
                                                   last_seen_at="2026-10-10T05:30:00Z")).json()
    assert p["display_name"] == "Yamada Taro" and p["last_seen_at"] == "2026-10-10T05:30:00Z"
    assert p["status"] == "draft"
    act = lambda cl, a, prof, reason="ok": cl.post(f"/v1/profiles/{prof['id']}/{a}", json={"expected_version": prof["version"], "reason": reason})
    assert act(store_admin, "submit", p).json()["code"] == "photo_required"
    r = upload(store_admin, p["id"], jpeg_with_gps())
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["quality"]["face"]["status"] == "unavailable"
    stored = admin.get(f"/v1/media/{photo['media_id']}").content
    assert b"SecretCameraMaker" not in stored and not Image.open(io.BytesIO(stored)).getexif()
    assert upload(store_admin, p["id"], jpeg_with_gps()).status_code in (201, 409)
    assert upload(store_admin, p["id"], b"GIF89a....").status_code == 422
    p = store_admin.get(f"/v1/profiles/{p['id']}").json()
    p = act(store_admin, "submit", p).json()
    assert p["status"] == "pending_review"
    # photo approval then profile approval: creator cannot approve their own enrollment
    assert store_admin.post(f"/v1/profiles/{p['id']}/photos/{photo['id']}/review",
                            json={"decision": "approved", "reason": "clear, single face"}).status_code == 200
    p = store_admin.get(f"/v1/profiles/{p['id']}").json()
    assert act(store_admin, "approve", p).json()["code"] == "separation_of_duties"
    # source incident is not confirmed yet → refused
    assert act(admin, "approve", p).json()["code"] == "source_incident_not_confirmed"
    claimed = admin.post(f"/v1/incidents/{inc['id']}/claim", json={"expected_version": inc["version"]}).json()
    admin.post(f"/v1/incidents/{inc['id']}/outcome", json={"expected_version": claimed["version"], "outcome": "confirmed",
                                                           "reason": "Verified on footage"})
    p = act(admin, "approve", p, "Evidence reviewed").json()
    assert p["status"] == "approved" and p["gallery_state"] == "face_sdk_unavailable"
    # material change resets approval
    upd = store_admin.patch(f"/v1/profiles/{p['id']}", json={"expected_version": p["version"], "basis": "Updated basis text for record"})
    assert upd.json()["status"] == "pending_review"
    # responder can read watchlist but not manage
    resp, _ = invite_and_login(app, admin, "responder", [store["id"]])
    assert resp.get(f"/v1/profiles/{p['id']}").status_code == 200
    assert resp.post("/v1/profiles", json=dict(base, reference="WL-2", source_incident_id=inc["id"])).status_code == 403


def test_photo_delete_removes_encrypted_file_and_staff_photos_are_restricted(org):
    app, admin, store = org["app"], org["admin"], org["store"]
    p = admin.post("/v1/profiles", json={"kind": "staff", "reference": "EMP-77", "display_name": "Sato",
                                         "store_ids": [store["id"]], "expires_at": "2027-01-01T00:00:00Z",
                                         "notice_recorded": True}).json()
    photo = upload(admin, p["id"], (ASSETS / "portrait-2.jpg").read_bytes()).json()
    media_dir = Path(os.environ["MEDIA_DIR"])
    files_before = {f for f in media_dir.rglob("*") if f.is_file()}
    # files at rest are encrypted (original JPEG magic not present)
    assert all(not f.read_bytes().startswith(b"\xff\xd8\xff") for f in files_before)
    resp, _ = invite_and_login(app, admin, "responder", [store["id"]])
    assert resp.get(f"/v1/media/{photo['media_id']}").status_code == 403
    assert admin.delete(f"/v1/profiles/{p['id']}/photos/{photo['id']}").status_code == 200
    assert admin.get(f"/v1/media/{photo['media_id']}").status_code == 410
    files_after = {f for f in media_dir.rglob("*") if f.is_file()}
    assert len(files_before - files_after) == 2  # original + thumbnail


def test_staff_requires_notice_and_expiry_limits(org):
    admin, store = org["admin"], org["store"]
    base = {"kind": "staff", "reference": "EMP-1", "display_name": "Ito", "store_ids": [store["id"]],
            "expires_at": "2027-01-01T00:00:00Z"}
    assert admin.post("/v1/profiles", json=base).json()["field_errors"] == {"notice_recorded": "photo_notice_required"}
    assert admin.post("/v1/profiles", json=dict(base, notice_recorded=True, expires_at="2020-01-01T00:00:00Z")).status_code == 422
    assert admin.post("/v1/profiles", json=dict(base, notice_recorded=True, expires_at="2040-01-01T00:00:00Z")).status_code == 422
    assert admin.post("/v1/profiles", json=dict(base, notice_recorded=True)).status_code == 201


def test_watchlist_without_linked_incident_or_reason_can_be_approved_by_second_reviewer(org):
    app, admin, store = org["app"], org["admin"], org["store"]
    store_admin, _ = invite_and_login(app, admin, "store_admin", [store["id"]])
    p = store_admin.post("/v1/profiles", json={"kind": "watchlist", "reference": "WL-NOINC", "display_name": "Suzuki Ichiro",
                                               "last_seen_at": "2026-10-09T12:00:00Z", "store_ids": [store["id"]],
                                               "expires_at": "2027-03-31T00:00:00Z"})
    assert p.status_code == 201, p.text
    p = p.json()
    assert p["source_incident_id"] is None and p["basis"] == ""
    photo = upload(store_admin, p["id"], jpeg_with_gps()).json()
    p = store_admin.get(f"/v1/profiles/{p['id']}").json()
    p = store_admin.post(f"/v1/profiles/{p['id']}/submit", json={"expected_version": p["version"], "reason": "ready"}).json()
    admin.post(f"/v1/profiles/{p['id']}/photos/{photo['id']}/review", json={"decision": "approved", "reason": "clear"})
    p = admin.get(f"/v1/profiles/{p['id']}").json()
    # still needs a different approver than the creator
    assert store_admin.post(f"/v1/profiles/{p['id']}/approve", json={"expected_version": p["version"], "reason": "x"}).status_code == 403
    r = admin.post(f"/v1/profiles/{p['id']}/approve", json={"expected_version": p["version"], "reason": "Reviewed photos"})
    assert r.status_code == 200 and r.json()["status"] == "approved"
