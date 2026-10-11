"""Staff and watchlist enrollment with photo lifecycle. Enrollment never happens automatically
from a detection; watchlist approval requires a human-confirmed source incident, approved
photos and a second person. Face templates require the licensed Ayonix SDK (not bundled)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field

from .. import media as media_store
from .. import policies
from ..authz import audit, check_version, clean, iso, now
from ..db import Tx
from ..deps import Ctx, ctx
from ..errors import ApiError, conflict, forbidden, invalid, not_found
from ..settings import get_settings

router = APIRouter(prefix="/v1", tags=["profiles"])

ACTIONS = ("submit", "approve", "reject", "suspend", "reinstate", "delete")


class ProfileIn(BaseModel):
    kind: str
    reference: str = Field(min_length=1, max_length=80)
    display_name: str = Field(default="", max_length=120)
    basis: str = Field(default="", max_length=4000)
    source_incident_id: uuid.UUID | None = None
    store_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    expires_at: datetime
    review_at: datetime | None = None
    role_context: str | None = Field(default=None, max_length=200)
    notice_recorded: bool = False


class ProfilePatch(BaseModel):
    expected_version: int
    display_name: str | None = Field(default=None, max_length=120)
    basis: str | None = Field(default=None, max_length=4000)
    source_incident_id: uuid.UUID | None = None
    store_ids: list[uuid.UUID] | None = None
    expires_at: datetime | None = None
    review_at: datetime | None = None
    role_context: str | None = Field(default=None, max_length=200)
    notice_recorded: bool | None = None


class ActionIn(BaseModel):
    expected_version: int
    reason: str = Field(min_length=1, max_length=2000)


class PhotoReviewIn(BaseModel):
    decision: str
    reason: str = Field(min_length=1, max_length=2000)


def manage_perm(kind: str) -> str:
    return "staff.manage" if kind == "staff" else "watchlist.manage"


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def privacy(tx: Tx, org_id: str) -> dict:
    row = tx.one("SELECT settings FROM org_settings WHERE org_id=%s AND kind='privacy'", (org_id,))
    return policies.validate(policies.Privacy, row["settings"] if row else {})


def scopes(tx: Tx, profile_id) -> list[str]:
    return [str(r["store_id"]) for r in tx.all("SELECT store_id FROM profile_scopes WHERE profile_id=%s ORDER BY store_id",
                                                (profile_id,))]


def visible(c: Ctx, store_ids: list[str]) -> bool:
    return c.actor.all_stores or any(s in c.actor.store_ids for s in store_ids)


def profile_out(tx: Tx, r: dict) -> dict:
    out = clean(r)
    out.pop("org_id", None)
    out["store_ids"] = scopes(tx, r["id"])
    counts = tx.one("""SELECT count(*) FILTER (WHERE status<>'deleted') AS total,
                              count(*) FILTER (WHERE status='approved') AS approved
                       FROM profile_photos WHERE profile_id=%s""", (r["id"],))
    out["photo_count"] = counts["total"]
    out["approved_photo_count"] = counts["approved"]
    thumb = tx.one("""SELECT thumb_media_id FROM profile_photos WHERE profile_id=%s AND status IN ('approved','pending')
                      ORDER BY (status='approved') DESC, created_at LIMIT 1""", (r["id"],))
    out["thumb_media_id"] = str(thumb["thumb_media_id"]) if thumb and thumb["thumb_media_id"] else None
    return out


def photo_out(r: dict) -> dict:
    out = clean(r)
    out.pop("org_id", None)
    out.pop("sha256", None)
    return out


def _load(c: Ctx, profile_id, perm: str, lock: bool = False) -> dict:
    r = c.tx.one("SELECT * FROM profiles WHERE id=%s" + (" FOR UPDATE" if lock else ""), (profile_id,))
    if not r or r["status"] == "deleted" and perm != "profile.read":
        raise not_found()
    if not visible(c, scopes(c.tx, r["id"])):
        raise not_found()
    if perm == "profile.read":
        # staff records are visible to staff managers; watchlist records to profile readers
        if r["kind"] == "staff" and not (c.actor.can("staff.manage") or c.actor.can("profile.read")):
            raise forbidden()
        c.actor.require("profile.read")
    else:
        c.actor.require(perm)
    return r


def _validate_common(c: Ctx, kind: str, store_ids, expires_at: datetime, review_at, source_incident_id) -> list[str]:
    ids = sorted({str(s) for s in store_ids})
    for s in ids:
        c.actor.require_store(s)
    if c.tx.scalar("SELECT count(*) FROM stores WHERE id = ANY(%s::uuid[])", (ids,)) != len(ids):
        raise invalid("store_ids", "unknown_store")
    expires_at = _aware(expires_at)
    max_days = privacy(c.tx, c.actor.org_id)["profile_max_expiry_days"]
    if expires_at <= now():
        raise invalid("expires_at", "must_be_future")
    if expires_at > now() + timedelta(days=max_days):
        raise invalid("expires_at", f"max_{max_days}_days")
    if review_at is not None and not now() < _aware(review_at) <= expires_at:
        raise invalid("review_at", "must_be_before_expiry")
    if kind == "watchlist":
        if source_incident_id is None:
            raise invalid("source_incident_id", "required")
        inc = c.tx.one("SELECT store_id FROM incidents WHERE id=%s", (source_incident_id,))
        if not inc:
            raise invalid("source_incident_id", "not_found")
        c.actor.require_store(str(inc["store_id"]))
    return ids


@router.get("/profiles")
def list_profiles(kind: str | None = None, status: str | None = None, q: str | None = None,
                  store_id: uuid.UUID | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("profile.read")
    if kind not in (None, "staff", "watchlist"):
        raise invalid("kind")
    stores = c.actor.scoped_stores(str(store_id) if store_id else None)
    sql = """SELECT p.* FROM profiles p WHERE p.status<>'deleted'
             AND EXISTS (SELECT 1 FROM profile_scopes s WHERE s.profile_id=p.id AND s.store_id = ANY(%s::uuid[]))"""
    args: list = [stores]
    if kind:
        sql += " AND p.kind=%s"; args.append(kind)
    if status:
        sql += " AND p.status=%s"; args.append(status)
    if q:
        sql += " AND (p.reference ILIKE %s OR p.display_name ILIKE %s)"; args += [f"%{q[:80]}%"] * 2
    rows = c.tx.all(sql + " ORDER BY p.created_at DESC, p.id LIMIT 200", args)
    return {"items": [profile_out(c.tx, r) for r in rows], "next_cursor": None}


@router.post("/profiles", status_code=201)
def create_profile(body: ProfileIn, c: Ctx = Depends(ctx)) -> dict:
    if body.kind not in ("staff", "watchlist"):
        raise invalid("kind")
    c.actor.require(manage_perm(body.kind))
    ids = _validate_common(c, body.kind, body.store_ids, body.expires_at, body.review_at, body.source_incident_id)
    if body.kind == "watchlist" and len(body.basis.strip()) < 10:
        raise invalid("basis", "evidence_basis_required")
    if body.kind == "staff":
        if not body.display_name.strip():
            raise invalid("display_name", "required")
        if not body.notice_recorded:
            raise invalid("notice_recorded", "photo_notice_required")
    if c.tx.one("SELECT 1 FROM profiles WHERE kind=%s AND reference=%s", (body.kind, body.reference.strip())):
        raise ApiError(422, "validation_failed", "This reference ID is already used", field_errors={"reference": "duplicate"})
    pid = uuid.uuid4()
    c.tx.run("""INSERT INTO profiles (id, org_id, kind, reference, display_name, basis, role_context, notice_recorded,
                source_incident_id, status, created_by, expires_at, review_at, gallery_state)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'draft',%s,%s,%s,'not_in_gallery')""",
             (pid, c.actor.org_id, body.kind, body.reference.strip(), body.display_name.strip(), body.basis.strip(),
              body.role_context, body.notice_recorded, body.source_incident_id if body.kind == "watchlist" else None,
              c.actor.user_id, _aware(body.expires_at), body.review_at))
    for s in ids:
        c.tx.run("INSERT INTO profile_scopes (org_id, profile_id, store_id) VALUES (%s,%s,%s)", (c.actor.org_id, pid, s))
    audit(c.tx, c.actor.org_id, f"profile.{body.kind}_created", "profile", pid, actor=c.actor,
          detail={"reference": body.reference.strip(), "store_ids": ids})
    return profile_out(c.tx, c.tx.one("SELECT * FROM profiles WHERE id=%s", (pid,)))


@router.get("/profiles/{profile_id}")
def get_profile(profile_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    r = _load(c, profile_id, "profile.read")
    out = profile_out(c.tx, r)
    can_photos = c.actor.can("staff.manage") if r["kind"] == "staff" else c.actor.can("photo.read")
    out["photos"] = [photo_out(p) for p in c.tx.all(
        "SELECT * FROM profile_photos WHERE profile_id=%s AND status<>'deleted' ORDER BY created_at", (profile_id,))] if can_photos else []
    out["linked_incidents"] = [clean(x) for x in c.tx.all(
        """SELECT id, seq, channel, status, outcome, captured_at FROM incidents
           WHERE (id=%s OR profile_id=%s) AND store_id = ANY(%s::uuid[]) ORDER BY captured_at DESC LIMIT 50""",
        (r["source_incident_id"], profile_id, c.actor.store_ids))]
    for x in out["linked_incidents"]:
        x["ref"] = f"INC-{x['captured_at'][:4]}-{x.pop('seq'):06d}"
    out["history"] = [clean(x) for x in c.tx.all(
        """SELECT a.created_at AS at, a.action, a.detail, u.display_name AS actor FROM audit a
           LEFT JOIN app_users u ON u.id=a.actor_id WHERE a.resource_type IN ('profile','profile_photo')
           AND (a.resource_id=%s OR a.detail->>'profile_id'=%s) ORDER BY a.seq DESC LIMIT 50""",
        (str(profile_id), str(profile_id)))]
    out["match_candidates"] = {"available": False, "reason": "face_sdk_unavailable"} \
        if not get_settings().face_sdk_configured else {"available": True}
    return out


MATERIAL = ("basis", "source_incident_id", "store_ids", "expires_at")


@router.patch("/profiles/{profile_id}")
def patch_profile(profile_id: uuid.UUID, body: ProfilePatch, c: Ctx = Depends(ctx)) -> dict:
    r = c.tx.one("SELECT kind FROM profiles WHERE id=%s", (profile_id,))
    if not r:
        raise not_found()
    r = _load(c, profile_id, manage_perm(r["kind"]), lock=True)
    check_version(r, body.expected_version)
    if r["status"] in ("deleted",):
        raise conflict("profile_deleted", r["version"])
    changes = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    ids = None
    if any(k in changes for k in ("store_ids", "expires_at", "review_at", "source_incident_id")):
        ids = _validate_common(c, r["kind"], changes.get("store_ids") or scopes(c.tx, profile_id),
                               changes.get("expires_at") or r["expires_at"], changes.get("review_at", r["review_at"]),
                               changes.get("source_incident_id", r["source_incident_id"]))
    material = any(k in changes for k in MATERIAL)
    cols = {k: v for k, v in changes.items() if k != "store_ids"}
    if cols:
        sets = ", ".join(f"{k}=%s" for k in cols)
        c.tx.run(f"UPDATE profiles SET {sets} WHERE id=%s", (*cols.values(), profile_id))
    if "store_ids" in changes and ids is not None:
        c.tx.run("DELETE FROM profile_scopes WHERE profile_id=%s", (profile_id,))
        for s in ids:
            c.tx.run("INSERT INTO profile_scopes (org_id, profile_id, store_id) VALUES (%s,%s,%s)", (c.actor.org_id, profile_id, s))
    reset = material and r["status"] == "approved"
    c.tx.run("""UPDATE profiles SET version=version+1, status=CASE WHEN %s THEN 'pending_review' ELSE status END,
                approved_by=CASE WHEN %s THEN NULL ELSE approved_by END,
                gallery_state=CASE WHEN %s THEN 'not_in_gallery' ELSE gallery_state END WHERE id=%s""",
             (reset, reset, reset, profile_id))
    audit(c.tx, c.actor.org_id, "profile.updated", "profile", profile_id, actor=c.actor,
          detail={"fields": sorted(changes), "approval_reset": reset})
    return get_profile(profile_id, c)


def _delete_photo(tx: Tx, p: dict) -> None:
    for mid in (p["media_id"], p["thumb_media_id"]):
        if mid:
            media_store.delete(tx, mid)
    tx.run("DELETE FROM face_templates WHERE photo_id=%s", (p["id"],))
    tx.run("UPDATE profile_photos SET status='deleted' WHERE id=%s", (p["id"],))


@router.post("/profiles/{profile_id}/photos", status_code=201)
def upload_photo(profile_id: uuid.UUID, file: UploadFile = File(...), provenance: str = Form(..., max_length=500),
                 c: Ctx = Depends(ctx)) -> dict:
    r = c.tx.one("SELECT kind FROM profiles WHERE id=%s", (profile_id,))
    if not r:
        raise not_found()
    r = _load(c, profile_id, manage_perm(r["kind"]), lock=True)
    if r["status"] in ("deleted",):
        raise conflict("profile_deleted", r["version"])
    if not provenance.strip():
        raise invalid("provenance", "required")
    data = file.file.read(media_store.MAX_UPLOAD_BYTES + 1)
    processed = media_store.process_photo(data)
    import hashlib
    digest = hashlib.sha256(processed["jpeg"]).hexdigest()
    original_digest = hashlib.sha256(data).hexdigest()
    if c.tx.one("SELECT 1 FROM profile_photos WHERE profile_id=%s AND sha256=%s AND status<>'deleted'",
                (profile_id, original_digest)):
        raise ApiError(409, "duplicate_photo", "This photo is already attached; duplicates are not new evidence")
    m = media_store.store(c.tx, c.actor.org_id, processed["jpeg"], "image/jpeg", "profile_photo")
    t = media_store.store(c.tx, c.actor.org_id, processed["thumb"], "image/jpeg", "profile_thumb")
    pid = uuid.uuid4()
    from ..db import J
    c.tx.run("""INSERT INTO profile_photos (id, org_id, profile_id, media_id, thumb_media_id, sha256, width, height, quality,
                provenance, status, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s)""",
             (pid, c.actor.org_id, profile_id, m["id"], t["id"], original_digest, processed["width"], processed["height"],
              J(processed["quality"]), provenance.strip(), c.actor.user_id))
    material = r["status"] == "approved"
    c.tx.run("""UPDATE profiles SET version=version+1, status=CASE WHEN %s THEN 'pending_review' ELSE status END,
                gallery_state=CASE WHEN %s THEN 'not_in_gallery' ELSE gallery_state END WHERE id=%s""",
             (material, material, profile_id))
    audit(c.tx, c.actor.org_id, "profile.photo_uploaded", "profile_photo", pid, actor=c.actor,
          detail={"profile_id": str(profile_id), "sha256": digest, "approval_reset": material,
                  "image_problems": processed["quality"]["image"]["problems"]})
    return photo_out(c.tx.one("SELECT * FROM profile_photos WHERE id=%s", (pid,)))


@router.post("/profiles/{profile_id}/photos/{photo_id}/review")
def review_photo(profile_id: uuid.UUID, photo_id: uuid.UUID, body: PhotoReviewIn, c: Ctx = Depends(ctx)) -> dict:
    r = c.tx.one("SELECT kind FROM profiles WHERE id=%s", (profile_id,))
    if not r:
        raise not_found()
    _load(c, profile_id, "watchlist.approve" if r["kind"] == "watchlist" else "staff.manage")
    if body.decision not in ("approved", "rejected"):
        raise invalid("decision")
    p = c.tx.one("SELECT * FROM profile_photos WHERE id=%s AND profile_id=%s FOR UPDATE", (photo_id, profile_id))
    if not p or p["status"] == "deleted":
        raise not_found()
    if body.decision == "approved" and p["quality"].get("image", {}).get("problems"):
        raise ApiError(422, "photo_quality_insufficient",
                       "The image failed measured quality checks (" + ", ".join(p["quality"]["image"]["problems"]) +
                       "). Upload a clearer photo.")
    c.tx.run("UPDATE profile_photos SET status=%s, reviewed_by=%s, review_reason=%s WHERE id=%s",
             (body.decision, c.actor.user_id, body.reason, photo_id))
    audit(c.tx, c.actor.org_id, f"profile.photo_{body.decision}", "profile_photo", photo_id, actor=c.actor,
          detail={"profile_id": str(profile_id), "reason": body.reason})
    return photo_out(c.tx.one("SELECT * FROM profile_photos WHERE id=%s", (photo_id,)))


@router.delete("/profiles/{profile_id}/photos/{photo_id}")
def delete_photo(profile_id: uuid.UUID, photo_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    r = c.tx.one("SELECT kind FROM profiles WHERE id=%s", (profile_id,))
    if not r:
        raise not_found()
    r = _load(c, profile_id, manage_perm(r["kind"]), lock=True)
    p = c.tx.one("SELECT * FROM profile_photos WHERE id=%s AND profile_id=%s FOR UPDATE", (photo_id, profile_id))
    if not p or p["status"] == "deleted":
        raise not_found()
    _delete_photo(c.tx, p)
    remaining = c.tx.scalar("SELECT count(*) FROM profile_photos WHERE profile_id=%s AND status='approved'", (profile_id,))
    if r["status"] == "approved" and remaining == 0:
        c.tx.run("UPDATE profiles SET status='pending_review', gallery_state='not_in_gallery', approved_by=NULL WHERE id=%s",
                 (profile_id,))
    c.tx.run("UPDATE profiles SET version=version+1 WHERE id=%s", (profile_id,))
    audit(c.tx, c.actor.org_id, "profile.photo_deleted", "profile_photo", photo_id, actor=c.actor,
          detail={"profile_id": str(profile_id)})
    return {"ok": True}


@router.get("/photos")
def photo_library(kind: str | None = None, status: str | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("photo.read")
    kinds = []
    if c.actor.can("staff.manage"):
        kinds.append("staff")
    kinds.append("watchlist")
    if kind:
        if kind not in kinds:
            raise forbidden() if kind == "staff" else invalid("kind")
        kinds = [kind]
    sql = """SELECT ph.*, p.kind AS profile_kind, p.reference AS profile_reference FROM profile_photos ph
             JOIN profiles p ON p.id=ph.profile_id WHERE ph.status<>'deleted' AND p.status<>'deleted' AND p.kind = ANY(%s)
             AND EXISTS (SELECT 1 FROM profile_scopes s WHERE s.profile_id=p.id AND s.store_id = ANY(%s::uuid[]))"""
    args: list = [kinds, c.actor.store_ids]
    if status:
        sql += " AND ph.status=%s"; args.append(status)
    rows = c.tx.all(sql + " ORDER BY ph.created_at DESC, ph.id LIMIT 200", args)
    return {"items": [photo_out(r) for r in rows], "next_cursor": None}


# Registered last so the literal /photos routes above take precedence over /{action}.
@router.post("/profiles/{profile_id}/{action}")
def profile_action(profile_id: uuid.UUID, action: str, body: ActionIn, c: Ctx = Depends(ctx)) -> dict:
    if action not in ACTIONS:
        raise not_found()
    r = c.tx.one("SELECT kind FROM profiles WHERE id=%s", (profile_id,))
    if not r:
        raise not_found()
    approve_perm = "watchlist.approve" if r["kind"] == "watchlist" else "staff.manage"
    r = _load(c, profile_id, approve_perm if action in ("approve", "reject", "reinstate") else manage_perm(r["kind"]),
              lock=True)
    check_version(r, body.expected_version)
    status = r["status"]
    allowed = {"submit": ({"draft"}, "pending_review"), "approve": ({"pending_review"}, "approved"),
               "reject": ({"pending_review"}, "draft"), "suspend": ({"approved"}, "suspended"),
               "reinstate": ({"suspended", "expired"}, "pending_review"),
               "delete": ({"draft", "pending_review", "approved", "suspended", "expired"}, "deleted")}
    sources, target = allowed[action]
    if status not in sources:
        raise conflict("invalid_transition", r["version"], f"Cannot {action} a profile that is {status}")
    photos = c.tx.one("""SELECT count(*) FILTER (WHERE status IN ('pending','approved')) AS usable,
                                count(*) FILTER (WHERE status='approved') AS approved FROM profile_photos WHERE profile_id=%s""",
                      (profile_id,))
    if action == "submit" and photos["usable"] == 0:
        raise ApiError(422, "photo_required", "Add at least one reference photo before submitting for review")
    gallery = r["gallery_state"]
    if action == "approve":
        if r["kind"] == "watchlist" and str(r["created_by"]) == c.actor.user_id:
            raise ApiError(403, "separation_of_duties", "A different reviewer must approve this enrollment")
        if photos["approved"] == 0:
            raise ApiError(422, "approved_photo_required", "Approve at least one photo after checking its quality")
        if _aware(r["expires_at"]) <= now():
            raise ApiError(422, "profile_expired", "Extend the expiry before approval")
        if r["kind"] == "watchlist":
            inc = c.tx.one("SELECT outcome, status FROM incidents WHERE id=%s", (r["source_incident_id"],))
            if not inc or inc["outcome"] != "confirmed":
                raise ApiError(422, "source_incident_not_confirmed",
                               "Watchlist enrollment requires a source incident reviewed by a person as confirmed")
        # Face templates need the licensed SDK; without it the profile is approved as a record only.
        gallery = "in_gallery" if get_settings().face_sdk_configured else "face_sdk_unavailable"
    if action in ("suspend", "delete", "reject", "reinstate"):
        gallery = "not_in_gallery"
    c.tx.run("""UPDATE profiles SET status=%s, version=version+1, review_reason=%s, gallery_state=%s,
                approved_by=CASE WHEN %s='approve' THEN %s::uuid WHEN %s IN ('reject','reinstate','delete') THEN NULL ELSE approved_by END
                WHERE id=%s""",
             (target, body.reason, gallery, action, c.actor.user_id, action, profile_id))
    if action == "delete":
        for p in c.tx.all("SELECT * FROM profile_photos WHERE profile_id=%s AND status<>'deleted'", (profile_id,)):
            _delete_photo(c.tx, p)
        c.tx.run("DELETE FROM face_templates WHERE profile_id=%s", (profile_id,))
    audit(c.tx, c.actor.org_id, f"profile.{action}", "profile", profile_id, actor=c.actor,
          detail={"from": status, "to": target, "reason": body.reason, "gallery_state": gallery})
    return profile_out(c.tx, c.tx.one("SELECT * FROM profiles WHERE id=%s", (profile_id,)))
