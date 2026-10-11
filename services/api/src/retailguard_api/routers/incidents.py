"""Incidents (alerts), human review with optimistic concurrency, cases, exports and search."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, Field

from .. import media as media_store
from ..authz import audit, check_version, clean, decode_cursor, encode_cursor, iso, now, outbox, page_limit
from ..db import J, Tx
from ..deps import Ctx, ctx
from ..errors import ApiError, conflict, invalid, not_found, unavailable
from ..settings import get_settings
from .edge import ack_deadline, evidence_retention_days, next_seq
from .profiles import privacy

router = APIRouter(prefix="/v1", tags=["incidents"])

CHANNELS = ("behavior_candidate", "watchlist_candidate", "checkout_exception", "rfid_exception", "manual_observation")
STATUSES = ("new", "acknowledged", "reviewing", "resolved")
OUTCOMES = ("confirmed", "false_alert", "inconclusive")


class ManualIn(BaseModel):
    store_id: uuid.UUID
    camera_id: uuid.UUID | None = None
    description: str = Field(min_length=1, max_length=2000)
    observed_at: datetime | None = None


class VersionIn(BaseModel):
    expected_version: int


class ReasonIn(BaseModel):
    expected_version: int
    reason: str = Field(min_length=1, max_length=2000)


class OutcomeIn(BaseModel):
    expected_version: int
    outcome: str
    reason: str = Field(min_length=1, max_length=2000)
    observed_behavior: str | None = Field(default=None, max_length=2000)
    loss_value: Decimal | None = Field(default=None, ge=0, le=Decimal("999999999"))
    recovered_value: Decimal | None = Field(default=None, ge=0, le=Decimal("999999999"))


class EscalateIn(BaseModel):
    expected_version: int
    reason: str = Field(min_length=1, max_length=2000)
    priority: str = "high"


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class AssociationIn(BaseModel):
    decision: str
    reason: str = Field(min_length=1, max_length=2000)


class CaseIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    store_id: uuid.UUID | None = None
    incident_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class LinkIn(BaseModel):
    incident_id: uuid.UUID


class ExportIn(BaseModel):
    case_id: uuid.UUID
    redaction: str
    reason: str = Field(min_length=1, max_length=2000)
    recipient: str = Field(min_length=1, max_length=300)
    expires_in_days: int = Field(default=7, ge=1, le=30)


SUMMARY_SQL = """
SELECT i.*, s.name AS store_name, s.timezone AS store_timezone, c.name AS camera_name,
       u.display_name AS assignee_name
FROM incidents i JOIN stores s ON s.id=i.store_id
LEFT JOIN cameras c ON c.id=i.camera_id
LEFT JOIN app_users u ON u.id=i.assignee"""


def ref(r: dict, prefix: str = "INC") -> str:
    year = (r.get("captured_at") or r.get("created_at") or now()).year
    return f"{prefix}-{year}-{r['seq']:06d}"


def summary(r: dict) -> dict:
    return {"id": str(r["id"]), "ref": ref(r), "store_id": str(r["store_id"]), "store_name": r["store_name"],
            "store_timezone": r["store_timezone"], "camera_id": str(r["camera_id"]) if r["camera_id"] else None,
            "camera_name": r["camera_name"], "channel": r["channel"], "status": r["status"], "outcome": r["outcome"],
            "priority": r["priority"],
            "assignee": {"id": str(r["assignee"]), "display_name": r["assignee_name"]} if r["assignee"] else None,
            "evidence_state": r["evidence_state"], "captured_at": iso(r["captured_at"]),
            "ingested_at": iso(r["ingested_at"]), "delayed": r["delayed"], "version": r["version"],
            "description": r["description"][:300]}


def _filters(c: Ctx, args: dict) -> tuple[str, list]:
    sql, params = " WHERE i.store_id = ANY(%s::uuid[])", [c.actor.scoped_stores(args.get("store_id"))]
    if args.get("channel"):
        chans = args["channel"].split(",")
        if any(ch not in CHANNELS for ch in chans):
            raise invalid("channel")
        sql += " AND i.channel = ANY(%s)"; params.append(chans)
    if args.get("status"):
        sts = args["status"].split(",")
        if any(s not in STATUSES for s in sts):
            raise invalid("status")
        sql += " AND i.status = ANY(%s)"; params.append(sts)
    if args.get("open"):
        sql += " AND i.status <> 'resolved'"
    if args.get("outcome"):
        if args["outcome"] not in OUTCOMES + ("none",):
            raise invalid("outcome")
        if args["outcome"] == "none":
            sql += " AND i.outcome IS NULL"
        else:
            sql += " AND i.outcome=%s"; params.append(args["outcome"])
    if args.get("priority"):
        sql += " AND i.priority=%s"; params.append(args["priority"])
    if args.get("assignee"):
        if args["assignee"] == "me":
            sql += " AND i.assignee=%s"; params.append(c.actor.user_id)
        elif args["assignee"] == "none":
            sql += " AND i.assignee IS NULL"
        else:
            sql += " AND i.assignee::text=%s"; params.append(args["assignee"])
    if args.get("camera_id"):
        sql += " AND i.camera_id::text=%s"; params.append(args["camera_id"])
    if args.get("evidence_state"):
        sql += " AND i.evidence_state=%s"; params.append(args["evidence_state"])
    if args.get("profile_id"):
        sql += " AND (i.profile_id::text=%s OR i.id IN (SELECT source_incident_id FROM profiles WHERE id::text=%s))"
        params += [args["profile_id"], args["profile_id"]]
    for key, op in (("from", ">="), ("to", "<")):
        if args.get(key):
            try:
                dt = datetime.fromisoformat(args[key].replace("Z", "+00:00"))
            except ValueError:
                raise invalid(key, "invalid_datetime")
            sql += f" AND i.captured_at {op} %s"; params.append(dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc))
    if args.get("q"):
        q = args["q"][:100]
        sql += " AND (i.description ILIKE %s OR i.outcome_reason ILIKE %s OR i.event_id ILIKE %s OR i.seq::text = %s)"
        params += [f"%{q}%", f"%{q}%", f"%{q}%", q.split("-")[-1].lstrip("0") or "0"]
    return sql, params


def query_incidents(c: Ctx, args: dict, cursor: str | None, limit: int | None) -> dict:
    lim = page_limit(limit)
    where, params = _filters(c, args)
    cur = decode_cursor(cursor, 2)
    if cur:
        where += " AND (i.captured_at, i.id) < (%s::timestamptz, %s::uuid)"; params += cur
    rows = c.tx.all(SUMMARY_SQL + where + " ORDER BY i.captured_at DESC, i.id DESC LIMIT %s", params + [lim + 1])
    nxt = encode_cursor(rows[lim - 1]["captured_at"], rows[lim - 1]["id"]) if len(rows) > lim else None
    return {"items": [summary(r) for r in rows[:lim]], "next_cursor": nxt}


@router.get("/incidents")
def list_incidents(request: Request, cursor: str | None = None, limit: int | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("incident.read")
    return query_incidents(c, dict(request.query_params), cursor, limit)


def load(c: Ctx, incident_id, lock: bool = False) -> dict:
    r = c.tx.one(SUMMARY_SQL + " WHERE i.id=%s" + (" FOR UPDATE OF i" if lock else ""), (incident_id,))
    if not r:
        raise not_found()
    c.actor.require("incident.read", str(r["store_id"]))
    return r


def detail(c: Ctx, incident_id) -> dict:
    r = load(c, incident_id)
    out = summary(r)
    out.update({
        "description": r["description"], "signals": r["signals"], "gate_reason": r["gate_reason"],
        "model_version": r["model_version"], "preprocessing_version": r["preprocessing_version"],
        "uncertainty": r["uncertainty"], "observed_behavior": r["observed_behavior"],
        "outcome_reason": r["outcome_reason"],
        "loss_value": float(r["loss_value"]) if r["loss_value"] is not None else None,
        "recovered_value": float(r["recovered_value"]) if r["recovered_value"] is not None else None,
        "currency": r["currency"], "ack_deadline": iso(r["ack_deadline"]), "acknowledged_at": iso(r["acknowledged_at"]),
        "resolved_at": iso(r["resolved_at"]), "escalated_at": iso(r["escalated_at"]),
        "association_decision": r["association_decision"],
        "profile_id": str(r["profile_id"]) if r["profile_id"] else None,
        "legal_hold": {"reason": r["legal_hold_reason"], "review_at": iso(r["legal_hold_review_at"])}
        if r["legal_hold_reason"] else None,
    })
    out["evidence"] = [clean(e) for e in c.tx.all(
        """SELECT m.id AS media_id, m.mime, m.sha256, ie.kind, m.created_at, m.expires_at, m.deleted_at IS NOT NULL AS expired
           FROM incident_evidence ie JOIN media m ON m.id=ie.media_id WHERE ie.incident_id=%s ORDER BY m.created_at""",
        (incident_id,))]
    out["notes"] = [clean(n) for n in c.tx.all(
        """SELECT n.id, n.body, n.created_at, u.display_name AS author FROM incident_notes n
           JOIN app_users u ON u.id=n.author_id WHERE n.incident_id=%s ORDER BY n.created_at""", (incident_id,))]
    out["reviews"] = [clean(v) for v in c.tx.all(
        """SELECT v.id, v.action, v.outcome, v.reason, v.created_at, u.display_name AS actor FROM reviews v
           JOIN app_users u ON u.id=v.actor_id WHERE v.incident_id=%s ORDER BY v.created_at""", (incident_id,))]
    out["timeline"] = [clean(t) for t in c.tx.all(
        """SELECT a.created_at AS at, a.action, a.actor_kind, u.display_name AS actor FROM audit a
           LEFT JOIN app_users u ON u.id=a.actor_id WHERE a.resource_type='incident' AND a.resource_id=%s
           AND a.result='success' ORDER BY a.seq""", (str(incident_id),))]
    out["cases"] = [{"id": str(x["id"]), "ref": ref(x, "CASE")} for x in c.tx.all(
        """SELECT k.id, k.seq, k.created_at FROM case_incidents ci JOIN cases k ON k.id=ci.case_id WHERE ci.incident_id=%s""",
        (incident_id,))]
    return out


@router.post("/incidents", status_code=201)
def create_manual(body: ManualIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("incident.create", str(body.store_id))
    if body.camera_id and not c.tx.one("SELECT 1 FROM cameras WHERE id=%s AND store_id=%s", (body.camera_id, body.store_id)):
        raise invalid("camera_id", "not_in_store")
    observed = body.observed_at or now()
    observed = observed if observed.tzinfo else observed.replace(tzinfo=timezone.utc)
    if observed > now() + timedelta(minutes=5):
        raise invalid("observed_at", "future")
    iid = uuid.uuid4()
    seq = next_seq(c.tx, c.actor.org_id)
    c.tx.run("""INSERT INTO incidents (id, org_id, store_id, camera_id, seq, event_id, channel, description, evidence_state,
                model_version, gate_reason, created_by, captured_at, ack_deadline)
                VALUES (%s,%s,%s,%s,%s,%s,'manual_observation',%s,'unavailable','human','manual_observation',%s,%s,%s)""",
             (iid, c.actor.org_id, body.store_id, body.camera_id, seq, f"manual:{iid}", body.description.strip(),
              c.actor.user_id, observed, ack_deadline(c.tx, c.actor.org_id, body.store_id)))
    audit(c.tx, c.actor.org_id, "incident.manual_created", "incident", iid, actor=c.actor, store_id=body.store_id)
    outbox(c.tx, c.actor.org_id, f"incident:{iid}", "incident.created",
           {"incident_id": str(iid), "store_id": str(body.store_id), "channel": "manual_observation"})
    return detail(c, iid)


@router.get("/incidents/{incident_id}")
def get_incident(incident_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    return detail(c, incident_id)


def _review(c: Ctx, r: dict, action: str, reason: str, outcome: str | None = None) -> None:
    c.tx.run("""INSERT INTO reviews (id, org_id, incident_id, actor_id, action, reason, outcome, from_version)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
             (uuid.uuid4(), c.actor.org_id, r["id"], c.actor.user_id, action, reason, outcome, r["version"]))


def _owned_elsewhere(c: Ctx, r: dict) -> bool:
    return r["assignee"] is not None and str(r["assignee"]) != c.actor.user_id


@router.post("/incidents/{incident_id}/claim")
def claim(incident_id: uuid.UUID, body: VersionIn, c: Ctx = Depends(ctx)) -> dict:
    r = load(c, incident_id, lock=True)
    c.actor.require("incident.respond", str(r["store_id"]))
    check_version(r, body.expected_version)
    if r["status"] != "new":
        raise conflict("invalid_transition", r["version"], "This alert has already been acknowledged")
    if _owned_elsewhere(c, r):
        raise conflict("owned_by_another_responder", r["version"], "Another responder owns this alert")
    c.tx.run("""UPDATE incidents SET status='acknowledged', assignee=%s, acknowledged_at=now(), version=version+1
                WHERE id=%s AND version=%s""", (c.actor.user_id, incident_id, r["version"]))
    _review(c, r, "acknowledge", "Took ownership")
    audit(c.tx, c.actor.org_id, "incident.acknowledged", "incident", incident_id, actor=c.actor, store_id=r["store_id"])
    outbox(c.tx, c.actor.org_id, f"incident:{incident_id}:v{r['version'] + 1}", "incident.updated",
           {"incident_id": str(incident_id), "store_id": str(r["store_id"])})
    return detail(c, incident_id)


@router.post("/incidents/{incident_id}/request-review")
def request_review(incident_id: uuid.UUID, body: ReasonIn, c: Ctx = Depends(ctx)) -> dict:
    r = load(c, incident_id, lock=True)
    c.actor.require("incident.respond", str(r["store_id"]))
    check_version(r, body.expected_version)
    if r["status"] not in ("new", "acknowledged"):
        raise conflict("invalid_transition", r["version"], "Review cannot be requested in the current state")
    if _owned_elsewhere(c, r):
        raise conflict("owned_by_another_responder", r["version"], "Another responder owns this alert")
    c.tx.run("""UPDATE incidents SET status='reviewing', assignee=COALESCE(assignee, %s),
                acknowledged_at=COALESCE(acknowledged_at, now()), version=version+1 WHERE id=%s""",
             (c.actor.user_id, incident_id))
    _review(c, r, "request_review", body.reason)
    audit(c.tx, c.actor.org_id, "incident.review_requested", "incident", incident_id, actor=c.actor, store_id=r["store_id"],
          detail={"reason": body.reason})
    outbox(c.tx, c.actor.org_id, f"incident:{incident_id}:v{r['version'] + 1}", "incident.review_requested",
           {"incident_id": str(incident_id), "store_id": str(r["store_id"])})
    return detail(c, incident_id)


@router.post("/incidents/{incident_id}/outcome")
def record_outcome(incident_id: uuid.UUID, body: OutcomeIn, c: Ctx = Depends(ctx)) -> dict:
    """Human outcome. The inference pipeline has no path to this endpoint (edge credentials
    cannot call it), so model output can never author a confirmed outcome."""
    r = load(c, incident_id, lock=True)
    c.actor.require("incident.respond", str(r["store_id"]))
    check_version(r, body.expected_version)
    if body.outcome not in OUTCOMES:
        raise invalid("outcome")
    if r["status"] not in ("acknowledged", "reviewing"):
        raise conflict("invalid_transition", r["version"], "Acknowledge the alert before recording an outcome")
    if str(r["assignee"]) != c.actor.user_id:
        raise conflict("owned_by_another_responder", r["version"], "Only the responder who owns this alert can record the outcome")
    if body.outcome == "confirmed" and r["evidence_state"] == "pending":
        raise conflict("evidence_pending", r["version"], "Evidence is still uploading; wait for it or record inconclusive")
    c.tx.run("""UPDATE incidents SET status='resolved', outcome=%s, outcome_reason=%s, observed_behavior=%s, loss_value=%s,
                recovered_value=%s, resolved_at=now(), version=version+1 WHERE id=%s""",
             (body.outcome, body.reason, body.observed_behavior, body.loss_value, body.recovered_value, incident_id))
    _review(c, r, "outcome", body.reason, body.outcome)
    audit(c.tx, c.actor.org_id, f"incident.outcome_{body.outcome}", "incident", incident_id, actor=c.actor,
          store_id=r["store_id"], detail={"reason": body.reason})
    outbox(c.tx, c.actor.org_id, f"incident:{incident_id}:v{r['version'] + 1}", "incident.updated",
           {"incident_id": str(incident_id), "store_id": str(r["store_id"])})
    return detail(c, incident_id)


@router.post("/incidents/{incident_id}/escalate")
def escalate(incident_id: uuid.UUID, body: EscalateIn, c: Ctx = Depends(ctx)) -> dict:
    r = load(c, incident_id, lock=True)
    c.actor.require("incident.respond", str(r["store_id"]))
    check_version(r, body.expected_version)
    if body.priority not in ("normal", "high", "urgent"):
        raise invalid("priority")
    if r["status"] == "resolved":
        raise conflict("invalid_transition", r["version"], "Resolved incidents must be reopened first")
    c.tx.run("UPDATE incidents SET priority=%s, escalated_at=now(), version=version+1 WHERE id=%s", (body.priority, incident_id))
    _review(c, r, "escalate", body.reason)
    audit(c.tx, c.actor.org_id, "incident.escalated", "incident", incident_id, actor=c.actor, store_id=r["store_id"],
          detail={"priority": body.priority, "reason": body.reason})
    outbox(c.tx, c.actor.org_id, f"incident:{incident_id}:escalate:v{r['version'] + 1}", "incident.escalated",
           {"incident_id": str(incident_id), "store_id": str(r["store_id"]), "backup": True})
    return detail(c, incident_id)


@router.post("/incidents/{incident_id}/reopen")
def reopen(incident_id: uuid.UUID, body: ReasonIn, c: Ctx = Depends(ctx)) -> dict:
    r = load(c, incident_id, lock=True)
    c.actor.require("incident.reopen", str(r["store_id"]))
    check_version(r, body.expected_version)
    if r["status"] != "resolved":
        raise conflict("invalid_transition", r["version"], "Only resolved incidents can be reopened")
    c.tx.run("""UPDATE incidents SET status='reviewing', outcome=NULL, outcome_reason=NULL, resolved_at=NULL,
                assignee=%s, version=version+1 WHERE id=%s""", (c.actor.user_id, incident_id))
    _review(c, r, "reopen", body.reason)
    audit(c.tx, c.actor.org_id, "incident.reopened", "incident", incident_id, actor=c.actor, store_id=r["store_id"],
          detail={"reason": body.reason, "previous_outcome": r["outcome"]})
    return detail(c, incident_id)


@router.post("/incidents/{incident_id}/notes", status_code=201)
def add_note(incident_id: uuid.UUID, body: NoteIn, c: Ctx = Depends(ctx)) -> dict:
    r = load(c, incident_id)
    c.actor.require("incident.respond", str(r["store_id"]))
    nid = uuid.uuid4()
    c.tx.run("INSERT INTO incident_notes (id, org_id, incident_id, author_id, body) VALUES (%s,%s,%s,%s,%s)",
             (nid, c.actor.org_id, incident_id, c.actor.user_id, body.body.strip()))
    audit(c.tx, c.actor.org_id, "incident.note_added", "incident", incident_id, actor=c.actor, store_id=r["store_id"])
    return detail(c, incident_id)


@router.post("/incidents/{incident_id}/association")
def association(incident_id: uuid.UUID, body: AssociationIn, c: Ctx = Depends(ctx)) -> dict:
    r = load(c, incident_id, lock=True)
    c.actor.require("incident.respond", str(r["store_id"]))
    if r["channel"] != "watchlist_candidate":
        raise conflict("not_a_watchlist_candidate", r["version"], "Only watchlist candidates have an identity association")
    if body.decision not in ("accepted", "rejected"):
        raise invalid("decision")
    c.tx.run("UPDATE incidents SET association_decision=%s, version=version+1 WHERE id=%s", (body.decision, incident_id))
    _review(c, r, f"association_{body.decision}", body.reason)
    audit(c.tx, c.actor.org_id, f"incident.association_{body.decision}", "incident", incident_id, actor=c.actor,
          store_id=r["store_id"], detail={"reason": body.reason})
    return detail(c, incident_id)


@router.get("/incidents/{incident_id}/visit")
def visit(incident_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    r = load(c, incident_id)
    events = [clean(x) for x in c.tx.all(
        """SELECT i.id, i.channel, i.captured_at, c.name AS camera_name, c.location FROM incidents i
           LEFT JOIN cameras c ON c.id=i.camera_id WHERE i.store_id=%s AND i.camera_id IS NOT NULL
           AND i.captured_at BETWEEN %s AND %s ORDER BY i.captured_at LIMIT 50""",
        (r["store_id"], r["captured_at"] - timedelta(minutes=30), r["captured_at"] + timedelta(minutes=30)))]
    # Cross-camera person association needs a validated re-identification model; none is installed.
    return {"available": False, "reason": "reid_unavailable", "incident_id": str(incident_id),
            "nearby_events": events,
            "note": "Events from the same store within ±30 minutes are listed by time only. They are not linked to the same person."}


@router.get("/incidents/{incident_id}/pos-events")
def pos_events(incident_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    r = load(c, incident_id)
    integrations = c.tx.all("SELECT id, name, config, last_event_at FROM integrations WHERE store_id=%s AND kind='pos'",
                            (r["store_id"],))
    if not integrations:
        return {"available": False, "reason": "pos_unconfigured", "events": [], "integrations": []}
    rows = c.tx.all("""SELECT kind, lane, transaction_id, barcode, item_count, amount, occurred_at, received_at
                       FROM pos_events WHERE store_id=%s AND occurred_at BETWEEN %s AND %s AND kind<>'heartbeat'
                       ORDER BY occurred_at LIMIT 200""",
                    (r["store_id"], r["captured_at"] - timedelta(minutes=5), r["captured_at"] + timedelta(minutes=5)))
    fresh = any(i["last_event_at"] and i["last_event_at"] > r["captured_at"] - timedelta(minutes=10) for i in integrations)
    return {"available": fresh, "reason": None if fresh else "pos_telemetry_missing", "events": [clean(x) for x in rows],
            "integrations": [{"id": str(i["id"]), "name": i["name"], "clock_offset_ms": (i["config"] or {}).get("clock_offset_ms"),
                              "lane_map": (i["config"] or {}).get("lane_map", {})} for i in integrations]}


# ---- cases ----------------------------------------------------------------------------------

def case_summary(c: Ctx, k: dict) -> dict:
    owner = c.tx.one("SELECT display_name FROM app_users WHERE id=%s", (k["owner_id"],))
    return {"id": str(k["id"]), "ref": ref(k, "CASE"), "title": k["title"], "status": k["status"],
            "store_id": str(k["store_id"]) if k["store_id"] else None,
            "owner": {"id": str(k["owner_id"]), "display_name": owner["display_name"] if owner else ""},
            "incident_count": c.tx.scalar("SELECT count(*) FROM case_incidents WHERE case_id=%s", (k["id"],)),
            "updated_at": iso(k["updated_at"]), "created_at": iso(k["created_at"]), "version": k["version"],
            "close_reason": k["close_reason"]}


def _case_visible(c: Ctx, k: dict) -> None:
    if k["store_id"]:
        c.actor.require_store(str(k["store_id"]))


def load_case(c: Ctx, case_id, lock: bool = False) -> dict:
    c.actor.require("case.read")
    k = c.tx.one("SELECT * FROM cases WHERE id=%s" + (" FOR UPDATE" if lock else ""), (case_id,))
    if not k:
        raise not_found()
    _case_visible(c, k)
    return k


@router.get("/cases")
def list_cases(status: str | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("case.read")
    sql = "SELECT * FROM cases WHERE (store_id IS NULL OR store_id = ANY(%s::uuid[]))"
    args: list = [c.actor.store_ids]
    if status:
        sql += " AND status=%s"; args.append(status)
    rows = c.tx.all(sql + " ORDER BY updated_at DESC, id LIMIT 200", args)
    return {"items": [case_summary(c, k) for k in rows], "next_cursor": None}


def _link(c: Ctx, k: dict, incident_id) -> None:
    inc = load(c, incident_id)
    if k["store_id"] and inc["store_id"] != k["store_id"]:
        raise invalid("incident_id", "different_store")
    c.tx.run("""INSERT INTO case_incidents (org_id, case_id, incident_id, linked_by) VALUES (%s,%s,%s,%s)
                ON CONFLICT DO NOTHING""", (c.actor.org_id, k["id"], incident_id, c.actor.user_id))


@router.post("/cases", status_code=201)
def create_case(body: CaseIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("case.manage", str(body.store_id) if body.store_id else None)
    if body.store_id is None and not c.actor.all_stores:
        raise invalid("store_id", "required")
    kid = uuid.uuid4()
    c.tx.run("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"case-seq:{c.actor.org_id}",))
    seq = c.tx.scalar("SELECT COALESCE(max(seq), 0) + 1 FROM cases")
    c.tx.run("INSERT INTO cases (id, org_id, store_id, seq, owner_id, title, status) VALUES (%s,%s,%s,%s,%s,%s,'open')",
             (kid, c.actor.org_id, body.store_id, seq, c.actor.user_id, body.title.strip()))
    k = c.tx.one("SELECT * FROM cases WHERE id=%s", (kid,))
    for iid in body.incident_ids:
        _link(c, k, iid)
    audit(c.tx, c.actor.org_id, "case.created", "case", kid, actor=c.actor, store_id=body.store_id,
          detail={"incident_ids": [str(x) for x in body.incident_ids]})
    return get_case(kid, c)


@router.get("/cases/{case_id}")
def get_case(case_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    k = load_case(c, case_id)
    out = case_summary(c, k)
    out["incidents"] = [summary(r) for r in c.tx.all(
        SUMMARY_SQL + " JOIN case_incidents ci ON ci.incident_id=i.id WHERE ci.case_id=%s ORDER BY i.captured_at", (case_id,))]
    out["notes"] = [clean(n) for n in c.tx.all(
        """SELECT n.id, n.body, n.created_at, u.display_name AS author FROM case_notes n
           JOIN app_users u ON u.id=n.author_id WHERE n.case_id=%s ORDER BY n.created_at""", (case_id,))]
    out["timeline"] = [clean(t) for t in c.tx.all(
        """SELECT a.created_at AS at, a.action, u.display_name AS actor, a.detail FROM audit a
           LEFT JOIN app_users u ON u.id=a.actor_id WHERE a.resource_type IN ('case','export') AND
           (a.resource_id=%s OR a.detail->>'case_id'=%s) ORDER BY a.seq""", (str(case_id), str(case_id)))]
    out["exports"] = [export_out(e) for e in c.tx.all("SELECT * FROM exports WHERE case_id=%s ORDER BY created_at DESC", (case_id,))]
    out["access_log"] = [clean(t) for t in c.tx.all(
        """SELECT a.created_at AS at, a.action, u.display_name AS actor FROM audit a LEFT JOIN app_users u ON u.id=a.actor_id
           WHERE a.action IN ('case.viewed','export.downloaded') AND (a.resource_id=%s OR a.detail->>'case_id'=%s)
           ORDER BY a.seq DESC LIMIT 100""", (str(case_id), str(case_id)))]
    audit(c.tx, c.actor.org_id, "case.viewed", "case", case_id, actor=c.actor, store_id=k["store_id"])
    return out


@router.post("/cases/{case_id}/incidents", status_code=201)
def link_incident(case_id: uuid.UUID, body: LinkIn, c: Ctx = Depends(ctx)) -> dict:
    k = load_case(c, case_id, lock=True)
    c.actor.require("case.manage")
    if k["status"] != "open":
        raise conflict("case_closed", k["version"], "Reopen the case to change linked incidents")
    _link(c, k, body.incident_id)
    c.tx.run("UPDATE cases SET updated_at=now(), version=version+1 WHERE id=%s", (case_id,))
    audit(c.tx, c.actor.org_id, "case.incident_linked", "case", case_id, actor=c.actor, store_id=k["store_id"],
          detail={"incident_id": str(body.incident_id)})
    return get_case(case_id, c)


@router.delete("/cases/{case_id}/incidents/{incident_id}")
def unlink_incident(case_id: uuid.UUID, incident_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    k = load_case(c, case_id, lock=True)
    c.actor.require("case.manage")
    if k["status"] != "open":
        raise conflict("case_closed", k["version"], "Reopen the case to change linked incidents")
    if not c.tx.run("DELETE FROM case_incidents WHERE case_id=%s AND incident_id=%s", (case_id, incident_id)):
        raise not_found()
    c.tx.run("UPDATE cases SET updated_at=now(), version=version+1 WHERE id=%s", (case_id,))
    audit(c.tx, c.actor.org_id, "case.incident_unlinked", "case", case_id, actor=c.actor, store_id=k["store_id"],
          detail={"incident_id": str(incident_id)})
    return get_case(case_id, c)


@router.post("/cases/{case_id}/notes", status_code=201)
def case_note(case_id: uuid.UUID, body: NoteIn, c: Ctx = Depends(ctx)) -> dict:
    k = load_case(c, case_id)
    c.actor.require("case.manage")
    c.tx.run("INSERT INTO case_notes (id, org_id, case_id, author_id, body) VALUES (%s,%s,%s,%s,%s)",
             (uuid.uuid4(), c.actor.org_id, case_id, c.actor.user_id, body.body.strip()))
    c.tx.run("UPDATE cases SET updated_at=now() WHERE id=%s", (case_id,))
    audit(c.tx, c.actor.org_id, "case.note_added", "case", case_id, actor=c.actor, store_id=k["store_id"])
    return get_case(case_id, c)


@router.post("/cases/{case_id}/{action}")
def case_status(case_id: uuid.UUID, action: str, body: ReasonIn, c: Ctx = Depends(ctx)) -> dict:
    if action not in ("close", "reopen"):
        raise not_found()
    k = load_case(c, case_id, lock=True)
    c.actor.require("case.manage")
    check_version(k, body.expected_version)
    target = "closed" if action == "close" else "open"
    if k["status"] == target:
        raise conflict("invalid_transition", k["version"])
    c.tx.run("UPDATE cases SET status=%s, close_reason=%s, updated_at=now(), version=version+1 WHERE id=%s",
             (target, body.reason if action == "close" else None, case_id))
    audit(c.tx, c.actor.org_id, f"case.{action}d" if action == "close" else "case.reopened", "case", case_id,
          actor=c.actor, store_id=k["store_id"], detail={"reason": body.reason})
    return get_case(case_id, c)


# ---- exports --------------------------------------------------------------------------------

def export_out(e: dict) -> dict:
    out = clean(e)
    out.pop("org_id", None)
    out.pop("idempotency_key", None)
    if out["status"] == "ready" and e["expires_at"] < now():
        out["status"] = "expired"
    return out


@router.post("/exports", status_code=202)
def create_export(body: ExportIn, request: Request, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("export.create")
    if not c.actor.mfa_verified:
        raise ApiError(403, "mfa_required_for_export", "Evidence export requires a session verified with multi-factor authentication")
    key = request.headers.get("idempotency-key", "")
    if not 8 <= len(key) <= 128:
        raise ApiError(400, "idempotency_key_required", "Idempotency-Key header is required")
    if body.redaction not in ("none", "blur_bystanders", "faces_and_bystanders"):
        raise invalid("redaction")
    existing = c.tx.one("SELECT * FROM exports WHERE idempotency_key=%s", (key,))
    if existing:
        if str(existing["case_id"]) != str(body.case_id) or existing["created_by"] != uuid.UUID(c.actor.user_id):
            raise ApiError(409, "idempotency_mismatch", "Idempotency-Key reused for a different request")
        return export_out(existing)
    k = load_case(c, body.case_id)
    if body.redaction != "none":
        # Automated redaction requires a validated person/face detector, which is not installed.
        raise unavailable("redaction_unavailable",
                          "Automated redaction needs a validated detection model that is not installed. "
                          "Choose 'none' only if the recipient is authorized to see unredacted evidence.")
    eid = uuid.uuid4()
    c.tx.run("""INSERT INTO exports (id, org_id, case_id, idempotency_key, redaction, reason, recipient, expires_at, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             (eid, c.actor.org_id, body.case_id, key, body.redaction, body.reason, body.recipient,
              now() + timedelta(days=body.expires_in_days), c.actor.user_id))
    audit(c.tx, c.actor.org_id, "export.requested", "export", eid, actor=c.actor, store_id=k["store_id"],
          detail={"case_id": str(body.case_id), "recipient": body.recipient, "reason": body.reason, "redaction": body.redaction})
    outbox(c.tx, c.actor.org_id, f"export:{eid}", "export.build", {"export_id": str(eid)})
    return export_out(c.tx.one("SELECT * FROM exports WHERE id=%s", (eid,)))


def _load_export(c: Ctx, export_id) -> dict:
    c.actor.require("case.read")
    e = c.tx.one("SELECT * FROM exports WHERE id=%s", (export_id,))
    if not e:
        raise not_found()
    load_case(c, e["case_id"])
    return e


@router.get("/exports")
def list_exports(c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("case.read")
    rows = c.tx.all("""SELECT e.* FROM exports e JOIN cases k ON k.id=e.case_id
                       WHERE k.store_id IS NULL OR k.store_id = ANY(%s::uuid[]) ORDER BY e.created_at DESC LIMIT 200""",
                    (c.actor.store_ids,))
    return {"items": [export_out(e) for e in rows], "next_cursor": None}


@router.get("/exports/{export_id}")
def get_export(export_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    return export_out(_load_export(c, export_id))


@router.get("/exports/{export_id}/download")
def download_export(export_id: uuid.UUID, c: Ctx = Depends(ctx)):
    from fastapi.responses import Response
    e = _load_export(c, export_id)
    c.actor.require("export.create")
    if e["status"] != "ready" or e["expires_at"] < now() or not e["media_id"]:
        raise ApiError(410, "export_unavailable", "This export is not ready or has expired")
    m = c.tx.one("SELECT * FROM media WHERE id=%s", (e["media_id"],))
    data = media_store.read(m)
    c.tx.run("UPDATE exports SET download_count=download_count+1 WHERE id=%s", (export_id,))
    audit(c.tx, c.actor.org_id, "export.downloaded", "export", export_id, actor=c.actor,
          detail={"case_id": str(e["case_id"]), "recipient": e["recipient"]})
    return Response(data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="retailguard-export-{export_id}.zip"',
        "Cache-Control": "private, no-store"})


# ---- search ---------------------------------------------------------------------------------

@router.get("/search")
def search(request: Request, cursor: str | None = None, limit: int | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("search.metadata")
    args = dict(request.query_params)
    result = query_incidents(c, args, cursor, limit)
    stores = c.actor.scoped_stores(args.get("store_id"))
    retention_days = privacy(c.tx, c.actor.org_id)["evidence_retention_days"]
    cutoff = now() - timedelta(days=retention_days)

    def _dt(key, default):
        if not args.get(key):
            return default
        v = datetime.fromisoformat(args[key].replace("Z", "+00:00"))
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    start, end = _dt("from", cutoff), _dt("to", now())
    cam_sql = "SELECT id, name, store_id, activated_at, created_at FROM cameras WHERE store_id = ANY(%s::uuid[])"
    cam_args: list = [stores]
    if args.get("camera_id"):
        cam_sql += " AND id::text=%s"; cam_args.append(args["camera_id"])
    cams = c.tx.all(cam_sql + " ORDER BY name", cam_args)
    gaps, cameras = [], []
    if start < cutoff:
        gaps.append({"camera_id": None, "from": iso(start), "to": iso(cutoff), "reason": "beyond_retention"})
    if not cams:
        gaps.append({"camera_id": None, "from": iso(start), "to": iso(end), "reason": "no_cameras"})
    for cam in cams:
        outages = c.tx.all("""SELECT started_at, ended_at FROM camera_outages WHERE camera_id=%s
                              AND started_at < %s AND COALESCE(ended_at, now()) > %s ORDER BY started_at""",
                           (cam["id"], end, start))
        cameras.append({"id": str(cam["id"]), "name": cam["name"], "store_id": str(cam["store_id"]),
                        "activated_at": iso(cam["activated_at"]),
                        "outages": [{"from": iso(o["started_at"]), "to": iso(o["ended_at"])} for o in outages]})
        if cam["activated_at"] is None:
            gaps.append({"camera_id": str(cam["id"]), "from": iso(start), "to": iso(end), "reason": "before_activation"})
        elif cam["activated_at"] > start:
            gaps.append({"camera_id": str(cam["id"]), "from": iso(start), "to": iso(cam["activated_at"]),
                         "reason": "before_activation"})
        for o in outages:
            gaps.append({"camera_id": str(cam["id"]), "from": iso(max(o["started_at"], start)),
                         "to": iso(min(o["ended_at"] or now(), end)), "reason": "outage"})
    result["coverage"] = {"from": iso(start), "to": iso(end), "retention_cutoff": iso(cutoff), "cameras": cameras,
                          "gaps": gaps}
    audit(c.tx, c.actor.org_id, "search.metadata", "search", "incidents", actor=c.actor,
          detail={k: v for k, v in args.items() if k not in ("cursor",)})
    return result


@router.post("/search/photo")
def photo_search(file: UploadFile = File(...), c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("search.photo")
    data = file.file.read(media_store.MAX_UPLOAD_BYTES + 1)
    processed = media_store.process_photo(data)  # 413/422 on invalid input
    problems = processed["quality"]["image"]["problems"]
    if problems:
        raise ApiError(422, "query_photo_quality", "The query photo failed quality checks: " + ", ".join(problems),
                       field_errors={"file": ",".join(problems)})
    audit(c.tx, c.actor.org_id, "search.photo_attempted", "search", "photo", actor=c.actor,
          detail={"result": "face_sdk_unavailable" if not get_settings().face_sdk_configured else "queued"})
    # Returned (not raised) so the audit record above commits. The query photo is never stored
    # when it cannot be processed.
    from ..errors import error_response
    if not get_settings().face_sdk_configured:
        return error_response(unavailable("face_sdk_unavailable",
                              "Photo search needs the licensed Ayonix face SDK, which is not installed in this deployment. "
                              "The photo was checked and discarded; nothing was stored."))
    return error_response(unavailable("face_index_unavailable", "No compatible face index has been built yet"))
