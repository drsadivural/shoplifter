import threading

from conftest import Client, bootstrap_org, invite_and_login, login_admin


def manual(cl, store_id, text="Observed concealment near aisle 3"):
    r = cl.post("/v1/incidents", json={"store_id": store_id, "description": text})
    assert r.status_code == 201, r.text
    return r.json()


def test_claim_race_has_one_winner_and_stale_version_conflicts(org):
    app, admin, store = org["app"], org["admin"], org["store"]
    r1, _ = invite_and_login(app, admin, "responder", [store["id"]])
    r2, _ = invite_and_login(app, admin, "responder", [store["id"]])
    inc = manual(r1, store["id"])
    assert inc["status"] == "new" and inc["version"] == 1 and inc["ref"].startswith("INC-")
    results = []
    barrier = threading.Barrier(2)

    def go(cl):
        barrier.wait()
        results.append(cl.post(f"/v1/incidents/{inc['id']}/claim", json={"expected_version": 1}))
    threads = [threading.Thread(target=go, args=(c,)) for c in (r1, r2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409], [r.text for r in results]
    loser = next(r for r in results if r.status_code == 409).json()
    assert loser["current_version"] == 2


def test_outcome_requires_owner_reason_and_is_human_recorded(org):
    app, admin, store = org["app"], org["admin"], org["store"]
    r1, c1 = invite_and_login(app, admin, "responder", [store["id"]])
    r2, _ = invite_and_login(app, admin, "responder", [store["id"]])
    inc = manual(r1, store["id"])
    # cannot record outcome before acknowledgement
    r = r1.post(f"/v1/incidents/{inc['id']}/outcome", json={"expected_version": 1, "outcome": "confirmed", "reason": "seen"})
    assert r.status_code == 409 and r.json()["code"] == "invalid_transition"
    claimed = r1.post(f"/v1/incidents/{inc['id']}/claim", json={"expected_version": 1}).json()
    r = r2.post(f"/v1/incidents/{inc['id']}/outcome", json={"expected_version": claimed["version"], "outcome": "false_alert",
                                                             "reason": "not theft"})
    assert r.status_code == 409 and r.json()["code"] == "owned_by_another_responder"
    r = r1.post(f"/v1/incidents/{inc['id']}/outcome", json={"expected_version": claimed["version"], "outcome": "confirmed",
                                                             "reason": ""})
    assert r.status_code == 422
    r = r1.post(f"/v1/incidents/{inc['id']}/outcome", json={"expected_version": claimed["version"], "outcome": "confirmed",
                                                             "reason": "Item concealed in bag, verified on footage",
                                                             "loss_value": 3200})
    body = r.json()
    assert r.status_code == 200 and body["status"] == "resolved" and body["outcome"] == "confirmed"
    assert body["reviews"][-1]["actor"] and body["reviews"][-1]["reason"].startswith("Item concealed")
    assert [t["action"] for t in body["timeline"]][-1] == "incident.outcome_confirmed"
    # reopen requires permission (responder lacks incident.reopen)
    assert r1.post(f"/v1/incidents/{inc['id']}/reopen", json={"expected_version": body["version"], "reason": "x"}).status_code == 403
    r = admin.post(f"/v1/incidents/{inc['id']}/reopen", json={"expected_version": body["version"], "reason": "New footage"})
    assert r.status_code == 200 and r.json()["status"] == "reviewing" and r.json()["outcome"] is None


def test_store_scope_and_tenant_isolation(org, app):
    admin, store, store_b = org["admin"], org["store"], org["store_b"]
    resp_a, _ = invite_and_login(app, admin, "responder", [store["id"]])
    inc_b = manual(admin, store_b["id"])
    assert resp_a.get(f"/v1/incidents/{inc_b['id']}").status_code == 404
    assert all(i["store_id"] == store["id"] for i in resp_a.get("/v1/incidents").json()["items"])
    assert resp_a.post("/v1/incidents", json={"store_id": store_b["id"], "description": "x"}).status_code == 404
    # another organization cannot see it either
    other = bootstrap_org()
    other_admin, _ = login_admin(app, other)
    assert other_admin.get(f"/v1/incidents/{inc_b['id']}").status_code == 404
    assert other_admin.get(f"/v1/stores/{store['id']}").status_code == 404
    # viewers cannot respond
    viewer, _ = invite_and_login(app, admin, "viewer", [store_b["id"]])
    assert viewer.get(f"/v1/incidents/{inc_b['id']}").status_code == 200
    assert viewer.post(f"/v1/incidents/{inc_b['id']}/claim", json={"expected_version": 1}).status_code == 403


def test_pagination_is_stable(org):
    admin, store = org["admin"], org["store"]
    ids = {manual(admin, store["id"], f"obs {i}")["id"] for i in range(7)}
    seen, cursor = [], None
    while True:
        url = f"/v1/incidents?store_id={store['id']}&limit=3" + (f"&cursor={cursor}" if cursor else "")
        page = admin.get(url).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen)) and ids <= set(seen)


def test_cases_and_export_require_mfa_and_produce_hashed_manifest(org):
    import io, json, zipfile, hashlib
    app, admin, store = org["app"], org["admin"], org["store"]
    inc = manual(admin, store["id"])
    case = admin.post("/v1/cases", json={"title": "Repeat loss aisle 3", "store_id": store["id"],
                                         "incident_ids": [inc["id"]]}).json()
    assert case["ref"].startswith("CASE-") and len(case["incidents"]) == 1
    hdr = {"Idempotency-Key": "export-key-0001"}
    body = {"case_id": case["id"], "redaction": "blur_bystanders", "reason": "Police request", "recipient": "Officer A"}
    assert admin.post("/v1/exports", json=body, headers=hdr).json()["code"] == "redaction_unavailable"
    body["redaction"] = "none"
    e1 = admin.post("/v1/exports", json=body, headers=hdr)
    e2 = admin.post("/v1/exports", json=body, headers=hdr)
    assert e1.status_code == 202 and e1.json()["id"] == e2.json()["id"]
    from retailguard_api.worker import APNs, process_outbox
    process_outbox(APNs())
    ex = admin.get(f"/v1/exports/{e1.json()['id']}").json()
    assert ex["status"] == "ready"
    data = admin.get(f"/v1/exports/{ex['id']}/download").content
    z = zipfile.ZipFile(io.BytesIO(data))
    manifest = json.loads(z.read("manifest.json"))
    for f in manifest["files"]:
        assert hashlib.sha256(z.read(f["name"])).hexdigest() == f["sha256"]
    log = admin.get(f"/v1/cases/{case['id']}").json()["access_log"]
    assert any(a["action"] == "export.downloaded" for a in log)


def test_search_reports_coverage_gaps_and_photo_search_unavailable(org):
    admin, store = org["admin"], org["store"]
    manual(admin, store["id"])
    r = admin.get(f"/v1/search?store_id={store['id']}").json()
    reasons = {g["reason"] for g in r["coverage"]["gaps"]}
    assert "no_cameras" in reasons and r["items"]
    from PIL import Image
    import io
    buf = io.BytesIO()
    Image.effect_noise((400, 400), 80).convert("RGB").save(buf, "JPEG")
    r = admin.c.post("/v1/search/photo", files={"file": ("q.jpg", buf.getvalue(), "image/jpeg")},
                     headers={"X-CSRF-Token": admin.c.cookies.get("rg_csrf")})
    assert r.status_code == 503 and r.json()["code"] == "face_sdk_unavailable"
    r = admin.c.post("/v1/search/photo", files={"file": ("q.jpg", b"not an image at all", "image/jpeg")},
                     headers={"X-CSRF-Token": admin.c.cookies.get("rg_csrf")})
    assert r.status_code == 422
    audit = admin.get("/v1/audit?action=search.photo").json()["items"]
    assert audit and audit[0]["detail"]["result"] == "face_sdk_unavailable"


def test_escalation_deadline_and_notifications(org):
    import psycopg, os
    from retailguard_api.worker import APNs, escalate_overdue, process_outbox
    app, admin, store = org["app"], org["admin"], org["store"]
    resp, creds = invite_and_login(app, admin, "responder", [store["id"]])
    inc = manual(resp, store["id"])
    process_outbox(APNs())
    me = resp.get("/v1/me").json()
    assert me["unread_notifications"] >= 1
    with psycopg.connect(os.environ["MIGRATION_DATABASE_URL"]) as conn:
        conn.execute("UPDATE incidents SET ack_deadline=now() - interval '1 minute' WHERE id=%s", (inc["id"],))
    assert escalate_overdue() >= 1
    after = resp.get(f"/v1/incidents/{inc['id']}").json()
    assert after["priority"] == "high" and after["escalated_at"]
    assert any(t["action"] == "incident.ack_deadline_missed" for t in after["timeline"])


def test_audit_chain_verifies(org):
    admin, store = org["admin"], org["store"]
    manual(admin, store["id"])
    r = admin.get("/v1/audit/verify").json()
    assert r["valid"] is True and r["checked"] > 3
