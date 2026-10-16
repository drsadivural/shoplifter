"""Cameras: manual add, RTSP URL add, CSV import, discovery jobs (ONVIF devices on the store network and
USB cameras attached to the store edge), provisioning, activation, zones. A camera record alone never
means analysis is running."""
from __future__ import annotations

import base64
import csv
import io
import ipaddress
import json
import re
import uuid
from urllib.parse import unquote, urlsplit

from fastapi import APIRouter, Depends
from nacl.public import PublicKey, SealedBox
from pydantic import BaseModel, Field

from ..authz import audit, check_version, clean, iso
from ..db import J, Tx
from ..deps import Ctx, ctx
from ..errors import ApiError, conflict, invalid, not_found, unavailable
from ..settings import get_settings
from .edge import edge_state, online_edge, queue_command
from .org import store_policy

router = APIRouter(prefix="/v1", tags=["cameras"])

CHANNELS = ("behavior", "watchlist", "checkout")
ZONE_TYPES = ("shelf", "checkout", "exit_line", "privacy_mask")
RTSP_PATH = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@/%-]{0,200}$")
# Path and query of an operator-entered RTSP URL (no userinfo, no spaces).
RTSP_TARGET = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:/%?-]{0,300}$")
USB_DEVICE = re.compile(r"^/dev/(v4l/by-(id|path)/[A-Za-z0-9._:+-]{1,200}|video\d{1,3})$")


class CameraIn(BaseModel):
    store_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=120)
    address: str = Field(min_length=1, max_length=100)
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=256)
    stream_profile: str = "substream"
    rtsp_path: str | None = Field(default=None, max_length=200)


class RtspCameraIn(BaseModel):
    store_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=120)
    url: str = Field(min_length=8, max_length=600)
    # Used when the URL carries no user:password@ part.
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=256)


class ImportIn(BaseModel):
    store_id: uuid.UUID
    csv: str = Field(max_length=200_000)
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=256)
    dry_run: bool = True


class CameraPatch(BaseModel):
    expected_version: int
    name: str | None = Field(default=None, min_length=1, max_length=120)
    location: str | None = Field(default=None, max_length=120)


class VersionIn(BaseModel):
    expected_version: int


class ActivateIn(BaseModel):
    expected_version: int
    channels: list[str] = Field(min_length=1, max_length=3)


class Zone(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12], max_length=40)
    type: str
    label: str = Field(default="", max_length=80)
    points: list[list[float]] = Field(min_length=2, max_length=64)
    direction: str | None = None


class ZonesIn(BaseModel):
    expected_version: int
    zones: list[Zone] = Field(max_length=64)


class DiscoveryIn(BaseModel):
    store_id: uuid.UUID
    # Omitted: the edge probes from every private interface it has.
    interface: str | None = Field(default=None, max_length=64)
    include_usb: bool = True
    timeout_s: int = Field(default=5, ge=1, le=30)
    cidr: str | None = Field(default=None, max_length=64)


class DiscoveryAddIn(BaseModel):
    endpoint: str = Field(max_length=200)
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=120)
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=256)
    stream_profile: str = "substream"


def validate_address(address: str) -> str:
    """Camera targets must be literal private addresses inside the configured store subnets
    (SSRF / metadata-endpoint protection). Hostnames are not accepted."""
    try:
        ip = ipaddress.ip_address(address.strip())
    except ValueError:
        raise invalid("address", "ip_address_required")
    if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved or not ip.is_private:
        raise invalid("address", "address_not_permitted")
    subnets = get_settings().edge_allowed_subnets
    if subnets and not any(ip in n for n in subnets):
        raise invalid("address", "address_not_permitted")
    return str(ip)


def seal_credentials(edge: dict | None, username: str | None, password: str | None) -> str | None:
    if not username and not password:
        return None
    if not edge:
        raise ApiError(409, "edge_required", "Pair a store edge appliance before storing camera credentials: "
                       "credentials are encrypted to the appliance and never stored readable in the cloud")
    box = SealedBox(PublicKey(base64.b64decode(edge["box_public_key"])))
    sealed = box.encrypt(json.dumps({"username": username or "", "password": password or ""}).encode())
    return base64.b64encode(sealed).decode()


def camera_out(r: dict) -> dict:
    out = clean(r)
    out.pop("credential_sealed", None)
    out.pop("org_id", None)
    out["has_credentials"] = bool(r.get("credential_sealed"))
    out["snapshot"] = ({"media_id": str(r["snapshot_media_id"]), "captured_at": iso(r["snapshot_at"])}
                       if r.get("snapshot_media_id") else None)
    out.pop("snapshot_media_id", None)
    out.pop("snapshot_at", None)
    channels = r.get("channels") or {}
    out["channels"] = {ch: channels.get(ch, {"state": "not_requested", "reason": None}) for ch in CHANNELS}
    return out


def _create_camera(c: Ctx, store_id, name, location, address, username, password, profile, rtsp_path,
                   endpoint=None, vendor=None, model=None, source="manual", source_type="onvif",
                   rtsp_port=None, rtsp_scheme=None, duplicate_field="address") -> dict:
    if profile not in ("substream", "mainstream"):
        raise invalid("stream_profile")
    if source_type == "usb":
        if not USB_DEVICE.match(address):
            raise invalid("address", "usb_device_required")
    else:
        if rtsp_path and not (RTSP_TARGET if source_type == "rtsp" else RTSP_PATH).match(rtsp_path):
            raise invalid("rtsp_path")
        address = validate_address(address)
    if c.tx.one("""SELECT 1 FROM cameras WHERE store_id=%s AND address=%s AND COALESCE(rtsp_port, 0)=%s
                   AND COALESCE(rtsp_path, '')=%s""", (store_id, address, rtsp_port or 0, rtsp_path or "")):
        raise ApiError(422, "validation_failed", "A camera with this address exists in the store",
                       field_errors={duplicate_field: "duplicate"})
    edge = online_edge(c.tx, store_id)
    sealed = seal_credentials(edge, username, password)
    cid = uuid.uuid4()
    c.tx.run("""INSERT INTO cameras (id, org_id, store_id, edge_id, name, location, address, rtsp_path, endpoint_uuid,
                vendor, model, credential_sealed, stream_profile, source_type, rtsp_port, rtsp_scheme)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             (cid, c.actor.org_id, store_id, edge["id"] if edge else None, name.strip(), location.strip(), address,
              rtsp_path, endpoint, vendor, model, sealed, profile, source_type, rtsp_port, rtsp_scheme))
    audit(c.tx, c.actor.org_id, "camera.created_pending", "camera", cid, actor=c.actor, store_id=store_id,
          detail={"source": source, "source_type": source_type, "address": address, "credentials": bool(sealed)})
    if edge:
        _queue_provision(c, c.tx.one("SELECT * FROM cameras WHERE id=%s", (cid,)), edge)
    return c.tx.one("SELECT * FROM cameras WHERE id=%s", (cid,))


def _queue_provision(c: Ctx, cam: dict, edge: dict) -> dict:
    return queue_command(c.tx, c.actor.org_id, cam["store_id"], edge["id"], "provision_camera",
                         {"camera_id": str(cam["id"]), "address": cam["address"], "rtsp_path": cam["rtsp_path"],
                          "source_type": cam["source_type"], "rtsp_port": cam["rtsp_port"],
                          "rtsp_scheme": cam["rtsp_scheme"],
                          "stream_profile": cam["stream_profile"], "credential_sealed": cam["credential_sealed"]},
                         c.actor.user_id)


@router.get("/cameras")
def list_cameras(store_id: uuid.UUID | None = None, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("camera.read")
    stores = c.actor.scoped_stores(str(store_id) if store_id else None)
    rows = c.tx.all("SELECT * FROM cameras WHERE store_id = ANY(%s::uuid[]) ORDER BY name, id", (stores,))
    return {"items": [camera_out(r) for r in rows], "next_cursor": None}


@router.post("/cameras", status_code=201)
def add_camera(body: CameraIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("camera.manage", str(body.store_id))
    return camera_out(_create_camera(c, body.store_id, body.name, body.location, body.address, body.username,
                                     body.password, body.stream_profile, body.rtsp_path))


def parse_rtsp_url(url: str) -> dict:
    """Split an operator-entered RTSP URL. The host must be a literal private address inside the store
    subnets; any user:password@ part is returned separately so it can be sealed to the edge and is
    never stored or logged with the URL."""
    try:
        p = urlsplit(url.strip())
        port = p.port
    except ValueError:
        raise invalid("url", "rtsp_url_required")
    scheme = p.scheme.lower()
    if scheme not in ("rtsp", "rtsps") or not p.hostname or p.fragment:
        raise invalid("url", "rtsp_url_required")
    try:
        address = validate_address(p.hostname)
    except ApiError as exc:
        raise invalid("url", (exc.field_errors or {}).get("address", "address_not_permitted"))
    target = (p.path or "/") + (f"?{p.query}" if p.query else "")
    if not RTSP_TARGET.match(target):
        raise invalid("url", "invalid_rtsp_path")
    return {"scheme": scheme, "address": address, "port": port or (322 if scheme == "rtsps" else 554),
            "path": target, "username": unquote(p.username) if p.username is not None else None,
            "password": unquote(p.password) if p.password is not None else None}


@router.post("/cameras/rtsp", status_code=201)
def add_rtsp_camera(body: RtspCameraIn, c: Ctx = Depends(ctx)) -> dict:
    """Add a camera by its RTSP URL when ONVIF discovery does not find it. The edge reads the stream
    directly; readiness still requires >= 10 s of decoded frames."""
    c.actor.require("camera.manage", str(body.store_id))
    t = parse_rtsp_url(body.url)
    username = t["username"] if t["username"] is not None else body.username
    password = t["password"] if t["password"] is not None else body.password
    return camera_out(_create_camera(c, body.store_id, body.name, body.location, t["address"], username, password,
                                     "substream", t["path"], source="rtsp_url", source_type="rtsp",
                                     rtsp_port=t["port"], rtsp_scheme=t["scheme"], duplicate_field="url"))


@router.post("/cameras/import")
def import_cameras(body: ImportIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("camera.manage", str(body.store_id))
    reader = csv.reader(io.StringIO(body.csv.strip()))
    rows, results, seen = list(reader), [], set()
    if rows and [h.strip().lower() for h in rows[0][:3]] == ["name", "location", "address"]:
        rows = rows[1:]
        start = 2
    else:
        start = 1
    if not rows:
        raise invalid("csv", "empty")
    if len(rows) > 500:
        raise invalid("csv", "too_many_rows")
    existing = {r["address"] for r in c.tx.all("SELECT address FROM cameras WHERE store_id=%s", (body.store_id,))}
    edge = online_edge(c.tx, body.store_id)
    parsed = []
    for i, row in enumerate(rows, start=start):
        errors = []
        cells = [x.strip() for x in row] + ["", "", "", ""]
        name, location, address, profile = cells[0], cells[1], cells[2], cells[3] or "substream"
        if not name or len(name) > 120:
            errors.append("invalid_name")
        try:
            address = validate_address(address)
        except ApiError:
            errors.append("address_not_permitted")
        if profile not in ("substream", "mainstream"):
            errors.append("invalid_stream_profile")
        if address in existing or address in seen:
            errors.append("duplicate_address")
        if (body.username or body.password) and not edge:
            errors.append("edge_required_for_credentials")
        seen.add(address)
        parsed.append((i, name, location, address, profile, errors))
        results.append({"line": i, "name": name, "address": address, "status": "invalid" if errors else "valid",
                        "errors": errors})
    created = 0
    if not body.dry_run:
        if any(r["errors"] for r in results):
            raise ApiError(422, "import_has_invalid_rows", "Fix invalid rows before importing; nothing was imported",
                           field_errors={f"line_{r['line']}": ",".join(r["errors"]) for r in results if r["errors"]})
        for (i, name, location, address, profile, _), res in zip(parsed, results):
            _create_camera(c, body.store_id, name, location, address, body.username, body.password, profile, None,
                           source="csv_import")
            res["status"] = "created"
            created += 1
        audit(c.tx, c.actor.org_id, "camera.bulk_imported", "store", body.store_id, actor=c.actor,
              store_id=body.store_id, detail={"created": created})
    return {"rows": results, "created": created}


def _camera_for(c: Ctx, camera_id, action: str, lock: bool = False) -> dict:
    row = c.tx.one("SELECT * FROM cameras WHERE id=%s" + (" FOR UPDATE" if lock else ""), (camera_id,))
    if not row:
        raise not_found()
    c.actor.require(action, str(row["store_id"]))
    return row


@router.get("/cameras/{camera_id}")
def get_camera(camera_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    row = _camera_for(c, camera_id, "camera.read")
    out = camera_out(row)
    out["commands"] = [clean(r) for r in c.tx.all(
        """SELECT id, kind, status, error, created_at, completed_at FROM edge_commands
           WHERE payload->>'camera_id'=%s ORDER BY created_at DESC LIMIT 10""", (str(camera_id),))]
    out["outages"] = [clean(r) for r in c.tx.all(
        "SELECT started_at, ended_at, reason FROM camera_outages WHERE camera_id=%s ORDER BY started_at DESC LIMIT 20",
        (camera_id,))]
    edge = c.tx.one("SELECT * FROM edges WHERE id=%s", (row["edge_id"],)) if row["edge_id"] else None
    out["edge"] = {"id": str(edge["id"]), "name": edge["name"], "state": edge_state(edge)} if edge else None
    return out


@router.patch("/cameras/{camera_id}")
def patch_camera(camera_id: uuid.UUID, body: CameraPatch, c: Ctx = Depends(ctx)) -> dict:
    row = _camera_for(c, camera_id, "camera.manage", lock=True)
    check_version(row, body.expected_version)
    changes = body.model_dump(exclude_none=True, exclude={"expected_version"})
    if changes:
        sets = ", ".join(f"{k}=%s" for k in changes)
        c.tx.run(f"UPDATE cameras SET {sets}, version=version+1 WHERE id=%s", (*changes.values(), camera_id))
        audit(c.tx, c.actor.org_id, "camera.updated", "camera", camera_id, actor=c.actor, store_id=row["store_id"],
              detail={"fields": sorted(changes)})
    return get_camera(camera_id, c)


@router.post("/cameras/{camera_id}/provision", status_code=202)
def provision(camera_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    row = _camera_for(c, camera_id, "camera.manage", lock=True)
    edge = online_edge(c.tx, row["store_id"])
    if not edge or edge_state(edge) != "online":
        raise unavailable("edge_unavailable", "The store edge appliance is offline or not paired")
    cmd = _queue_provision(c, row, edge)
    c.tx.run("UPDATE cameras SET edge_id=%s WHERE id=%s", (edge["id"], camera_id))
    audit(c.tx, c.actor.org_id, "camera.provision_requested", "camera", camera_id, actor=c.actor, store_id=row["store_id"])
    return {"command_id": str(cmd["id"]), "status": "queued"}


@router.post("/cameras/{camera_id}/activate", status_code=202)
def activate(camera_id: uuid.UUID, body: ActivateIn, c: Ctx = Depends(ctx)) -> dict:
    row = _camera_for(c, camera_id, "camera.manage", lock=True)
    check_version(row, body.expected_version)
    if any(ch not in CHANNELS for ch in body.channels):
        raise invalid("channels")
    if row["readiness"] != "ready":
        raise conflict("camera_not_ready", row["version"],
                       "Analysis can start only after the edge has verified decoded frames from this camera")
    edge = online_edge(c.tx, row["store_id"])
    if not edge or edge_state(edge) != "online":
        raise unavailable("edge_unavailable", "The store edge appliance is offline or not paired")
    policy = store_policy(c.tx, c.actor.org_id, row["store_id"], "detection_rules")["settings"]
    channels = {ch: {"state": "starting" if ch in body.channels else "not_requested", "reason": None} for ch in CHANNELS}
    c.tx.run("""UPDATE cameras SET analysis_state='activation_requested', channels=%s, version=version+1 WHERE id=%s""",
             (J(channels), camera_id))
    cmd = queue_command(c.tx, c.actor.org_id, row["store_id"], edge["id"], "activate_camera",
                        {"camera_id": str(camera_id), "channels": body.channels, "zones": row["zones"],
                         "zones_version": row["zones_version"], "policy": policy}, c.actor.user_id)
    audit(c.tx, c.actor.org_id, "camera.activation_requested", "camera", camera_id, actor=c.actor,
          store_id=row["store_id"], detail={"channels": body.channels})
    return {"command_id": str(cmd["id"]), "camera": camera_out(c.tx.one("SELECT * FROM cameras WHERE id=%s", (camera_id,)))}


@router.post("/cameras/{camera_id}/pause", status_code=202)
def pause(camera_id: uuid.UUID, body: VersionIn, c: Ctx = Depends(ctx)) -> dict:
    row = _camera_for(c, camera_id, "camera.manage", lock=True)
    check_version(row, body.expected_version)
    edge = online_edge(c.tx, row["store_id"])
    if not edge:
        raise unavailable("edge_unavailable", "The store edge appliance is not paired")
    cmd = queue_command(c.tx, c.actor.org_id, row["store_id"], edge["id"], "pause_camera", {"camera_id": str(camera_id)},
                        c.actor.user_id)
    c.tx.run("UPDATE cameras SET version=version+1 WHERE id=%s", (camera_id,))
    audit(c.tx, c.actor.org_id, "camera.pause_requested", "camera", camera_id, actor=c.actor, store_id=row["store_id"])
    return {"command_id": str(cmd["id"])}


@router.get("/cameras/{camera_id}/zones")
def get_zones(camera_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    row = _camera_for(c, camera_id, "camera.read")
    return {"version": row["zones_version"], "zones": row["zones"], "acknowledged_version": row["zones_acked_version"]}


def validate_zones(zones: list[Zone]) -> list[dict]:
    out = []
    for i, z in enumerate(zones):
        if z.type not in ZONE_TYPES:
            raise invalid(f"zones.{i}.type")
        pts = z.points
        if any(len(p) != 2 or not all(0.0 <= v <= 1.0 for v in p) for p in pts):
            raise invalid(f"zones.{i}.points", "coordinates_must_be_normalized")
        if z.type == "exit_line":
            if len(pts) != 2:
                raise invalid(f"zones.{i}.points", "exit_line_needs_two_points")
            if z.direction not in ("in", "out"):
                raise invalid(f"zones.{i}.direction", "required")
        else:
            if len(pts) < 3:
                raise invalid(f"zones.{i}.points", "polygon_needs_three_points")
            area = 0.5 * abs(sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1]
                                 for k in range(len(pts))))
            if area < 1e-4:
                raise invalid(f"zones.{i}.points", "polygon_too_small")
        out.append({"id": z.id, "type": z.type, "label": z.label, "points": [[round(x, 5), round(y, 5)] for x, y in pts],
                    "direction": z.direction if z.type == "exit_line" else None})
    return out


@router.put("/cameras/{camera_id}/zones")
def put_zones(camera_id: uuid.UUID, body: ZonesIn, c: Ctx = Depends(ctx)) -> dict:
    row = _camera_for(c, camera_id, "camera.manage", lock=True)
    if body.expected_version != row["zones_version"]:
        raise conflict("version_conflict", row["zones_version"])
    zones = validate_zones(body.zones)
    new_version = row["zones_version"] + 1
    c.tx.run("UPDATE cameras SET zones=%s, zones_version=%s, version=version+1 WHERE id=%s", (J(zones), new_version, camera_id))
    edge = online_edge(c.tx, row["store_id"])
    if edge:
        queue_command(c.tx, c.actor.org_id, row["store_id"], edge["id"], "update_zones",
                      {"camera_id": str(camera_id), "zones_version": new_version, "zones": zones}, c.actor.user_id)
    audit(c.tx, c.actor.org_id, "camera.zones_updated", "camera", camera_id, actor=c.actor, store_id=row["store_id"],
          detail={"zones_version": new_version, "count": len(zones), "edge_notified": bool(edge)})
    return get_zones(camera_id, c)


# ---- discovery -----------------------------------------------------------------------------

def job_out(r: dict) -> dict:
    out = clean(r)
    out.pop("org_id", None)
    return out


@router.post("/discovery-jobs", status_code=202)
def start_discovery(body: DiscoveryIn, c: Ctx = Depends(ctx)) -> dict:
    c.actor.require("camera.manage", str(body.store_id))
    if body.interface:
        try:
            iface = ipaddress.ip_address(body.interface)
            if iface.version != 4 or not iface.is_private:
                raise ValueError
        except ValueError:
            raise invalid("interface", "private_ipv4_required")
    if body.cidr:
        try:
            net = ipaddress.ip_network(body.cidr, strict=False)
            if not net.is_private or net.num_addresses > 65536:
                raise ValueError
        except ValueError:
            raise invalid("cidr", "private_cidr_required")
    edge = online_edge(c.tx, body.store_id)
    if not edge or edge_state(edge) != "online":
        raise unavailable("edge_unavailable",
                          "Discovery runs on the store edge appliance. Pair an appliance and make sure it is online.")
    jid = uuid.uuid4()
    cmd = queue_command(c.tx, c.actor.org_id, body.store_id, edge["id"], "discover",
                        {"job_id": str(jid), "interface": body.interface or None, "timeout_s": body.timeout_s,
                         "cidr": body.cidr, "include_usb": body.include_usb},
                        c.actor.user_id)
    c.tx.run("""INSERT INTO discovery_jobs (id, org_id, store_id, edge_id, command_id, interface, timeout_s, cidr, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             (jid, c.actor.org_id, body.store_id, edge["id"], cmd["id"], body.interface or None, body.timeout_s, body.cidr,
              c.actor.user_id))
    audit(c.tx, c.actor.org_id, "camera.discovery_started", "discovery_job", jid, actor=c.actor, store_id=body.store_id,
          detail={"interface": body.interface or "all", "timeout_s": body.timeout_s, "include_usb": body.include_usb})
    return job_out(c.tx.one("SELECT * FROM discovery_jobs WHERE id=%s", (jid,)))


@router.get("/discovery-jobs/{job_id}")
def get_discovery(job_id: uuid.UUID, c: Ctx = Depends(ctx)) -> dict:
    row = c.tx.one("SELECT * FROM discovery_jobs WHERE id=%s", (job_id,))
    if not row:
        raise not_found()
    c.actor.require("camera.read", str(row["store_id"]))
    return job_out(row)


@router.post("/discovery-jobs/{job_id}/add", status_code=201)
def add_discovered(job_id: uuid.UUID, body: DiscoveryAddIn, c: Ctx = Depends(ctx)) -> dict:
    job = c.tx.one("SELECT * FROM discovery_jobs WHERE id=%s", (job_id,))
    if not job:
        raise not_found()
    c.actor.require("camera.manage", str(job["store_id"]))
    device = next((d for d in job["devices"] if d["endpoint"] == body.endpoint), None)
    if not device:
        raise invalid("endpoint", "not_in_discovery_results")
    if device.get("kind") == "usb":
        return camera_out(_create_camera(c, job["store_id"], body.name, body.location, device["address"], None, None,
                                         "substream", None, model=device.get("model"), source="usb_discovery",
                                         source_type="usb"))
    return camera_out(_create_camera(c, job["store_id"], body.name, body.location, device["address"], body.username,
                                     body.password, body.stream_profile, None, endpoint=device["endpoint"],
                                     vendor=device.get("vendor"), model=device.get("model"), source="onvif_discovery"))
