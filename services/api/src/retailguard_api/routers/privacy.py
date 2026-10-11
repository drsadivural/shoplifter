"""Legal holds on incident evidence and data-subject request tracking (docs/SECURITY.md, Japan-first handling)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..authz import audit, check_version, clean, iso, now
from ..deps import Ctx, ctx
from ..errors import conflict, invalid, not_found
from .profiles import privacy as privacy_settings

router = APIRouter(prefix="/v1", tags=["privacy"])


class HoldIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)
    review_days: int | None = Field(default=None, ge=1, le=365)


class ReleaseIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class RequestIn(BaseModel):
    kind: str
    subject_reference: str = Field(min_length=1, max_length=200)
    received_at: datetime
    notes: str = Field(default="", max_length=4000)


class CompleteIn(BaseModel):
    expected_version: int
    status: str
    resolution: str = Field(min_length=3, max_length=4000)


def _incident(c: Ctx, incident_id) -> dict:
    r = c.tx.one("SELECT * FROM incidents WHERE id=%s FOR UPDATE", (incident_id,))
    if not r:
        raise not_found()
    c.actor.require("privacy.manage", str(r["store_id"]))
    return r


@router.post("/incidents/{incident_id}/legal-hold")
def place_hold(incident_id: uuid.UUID, body: HoldIn, c: Ctx = Depends(ctx)) -> dict:
    """Holds keep evidence beyond retention; they require a reason and a review date (not indefinite)."""
    r = _incident(c, incident_id)
    days = body.review_days or privacy_settings(c.tx, c.actor.org_id)["legal_hold_review_days"]
    review = now() + timedelta(days=days)
    c.tx.run("""UPDATE incidents SET legal_hold_reason=%s, legal_hold_review_at=%s, legal_hold_by=%s, version=version+1
                WHERE id=%s""", (body.reason, review, c.actor.user_id, incident_id))
    c.tx.run("""UPDATE media SET hold_reason=%s, hold_review_at=%s WHERE id IN
                (SELECT media_id FROM incident_evidence WHERE incident_id=%s) AND deleted_at IS NULL""",
             (body.reason, review, incident_id))
    audit(c.tx, c.actor.org_id, "incident.legal_hold_placed", "incident", incident_id, actor=c.actor,
          store_id=r["store_id"], detail={"reason": body.reason, "review_at": iso(review)})
    return {"incident_id": str(incident_id), "legal_hold_reason": body.reason, "legal_hold_review_at": iso(review)}


@router.post("/incidents/{incident_id}/legal-hold/release")
def release_hold(incident_id: uuid.UUID, body: ReleaseIn, c: Ctx = Depends(ctx)) -> dict:
    r = _incident(c, incident_id)
    if not r["legal_hold_reason"]:
        raise conflict("no_legal_hold", r["version"], "This incident has no legal hold")
    c.tx.run("""UPDATE incidents SET legal_hold_reason=NULL, legal_hold_review_at=NULL, legal_hold_by=NULL,
                version=version+1 WHERE id=%s""", (incident_id,))
    c.tx.run("""UPDATE media SET hold_reason=NULL, hold_review_at=NULL WHERE id IN
                (SELECT media_id FROM incident_evidence WHERE incident_id=%s)""", (incident_id,))
    audit(c.tx, c.actor.org_id, "incident.legal_hold_released", "incident", incident_id, actor=c.actor,
          store_id=r["store_id"], detail={"reason": body.reason})
    return {"incident_id": str(incident_id), "legal_hold_reason": None}


@router.get("/privacy/holds")
def list_holds(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("privacy.manage")
    rows = c.tx.all("""SELECT i.id, i.seq, i.store_id, i.captured_at, i.legal_hold_reason, i.legal_hold_review_at,
                              u.display_name AS placed_by FROM incidents i LEFT JOIN app_users u ON u.id=i.legal_hold_by
                       WHERE i.legal_hold_reason IS NOT NULL ORDER BY i.legal_hold_review_at""")
    out = []
    for r in rows:
        x = clean(r)
        x["ref"] = f"INC-{r['captured_at'].year}-{x.pop('seq'):06d}"
        x["review_overdue"] = r["legal_hold_review_at"] < now()
        out.append(x)
    return {"items": out, "next_cursor": None}


def request_out(r: dict) -> dict:
    out = clean(r)
    out.pop("org_id", None)
    out["overdue"] = r["status"] == "open" and r["due_at"] < now()
    return out


@router.get("/privacy/requests")
def list_requests(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("privacy.manage")
    rows = c.tx.all("SELECT * FROM privacy_requests ORDER BY (status='open') DESC, due_at, id")
    return {"items": [request_out(r) for r in rows], "next_cursor": None}


@router.post("/privacy/requests", status_code=201)
def create_request(body: RequestIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("privacy.manage")
    if body.kind not in ("access", "correction", "deletion"):
        raise invalid("kind")
    received = body.received_at if body.received_at.tzinfo else body.received_at.replace(tzinfo=timezone.utc)
    if received > now() + timedelta(minutes=5):
        raise invalid("received_at", "future")
    rid = uuid.uuid4()
    # Response deadline is an organizational policy; 14 days is a conservative default to review with counsel.
    c.tx.run("""INSERT INTO privacy_requests (id, org_id, kind, subject_reference, received_at, due_at, notes, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
             (rid, c.actor.org_id, body.kind, body.subject_reference.strip(), received, received + timedelta(days=14),
              body.notes, c.actor.user_id))
    audit(c.tx, c.actor.org_id, "privacy.request_recorded", "privacy_request", rid, actor=c.actor,
          detail={"kind": body.kind})
    return request_out(c.tx.one("SELECT * FROM privacy_requests WHERE id=%s", (rid,)))


@router.post("/privacy/requests/{request_id}/complete")
def complete_request(request_id: uuid.UUID, body: CompleteIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("privacy.manage")
    r = c.tx.one("SELECT * FROM privacy_requests WHERE id=%s FOR UPDATE", (request_id,))
    check_version(r, body.expected_version)
    if body.status not in ("completed", "rejected"):
        raise invalid("status")
    if r["status"] != "open":
        raise conflict("invalid_transition", r["version"], "This request is already closed")
    c.tx.run("""UPDATE privacy_requests SET status=%s, resolution=%s, completed_by=%s, completed_at=now(), version=version+1
                WHERE id=%s""", (body.status, body.resolution, c.actor.user_id, request_id))
    audit(c.tx, c.actor.org_id, f"privacy.request_{body.status}", "privacy_request", request_id, actor=c.actor,
          detail={"resolution": body.resolution})
    return request_out(c.tx.one("SELECT * FROM privacy_requests WHERE id=%s", (request_id,)))
