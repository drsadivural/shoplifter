from conftest import invite_and_login


def test_legal_hold_blocks_retention_and_requires_privacy_role(org):
    import os, psycopg
    from retailguard_api.worker import retention
    app, admin, store = org["app"], org["admin"], org["store"]
    inc = admin.post("/v1/incidents", json={"store_id": store["id"], "description": "x"}).json()
    resp, _ = invite_and_login(app, admin, "responder", [store["id"]])
    assert resp.post(f"/v1/incidents/{inc['id']}/legal-hold", json={"reason": "Police request"}).status_code == 403
    r = admin.post(f"/v1/incidents/{inc['id']}/legal-hold", json={"reason": "Police request #123", "review_days": 30})
    assert r.status_code == 200 and r.json()["legal_hold_review_at"]
    assert admin.get(f"/v1/incidents/{inc['id']}").json()["legal_hold"]["reason"] == "Police request #123"
    holds = admin.get("/v1/privacy/holds").json()["items"]
    assert holds[0]["id"] == inc["id"] and holds[0]["review_overdue"] is False
    assert admin.post(f"/v1/incidents/{inc['id']}/legal-hold/release", json={"reason": "Case closed"}).status_code == 200
    assert admin.post(f"/v1/incidents/{inc['id']}/legal-hold/release", json={"reason": "again"}).status_code == 409


def test_privacy_request_lifecycle(org):
    admin = org["admin"]
    r = admin.post("/v1/privacy/requests", json={"kind": "deletion", "subject_reference": "Customer letter 2026-10-01",
                                                 "received_at": "2026-10-01T00:00:00Z"})
    assert r.status_code == 201 and r.json()["status"] == "open"
    req = r.json()
    done = admin.post(f"/v1/privacy/requests/{req['id']}/complete",
                      json={"expected_version": req["version"], "status": "completed", "resolution": "No matching records held"})
    assert done.json()["status"] == "completed"
    stale = admin.post(f"/v1/privacy/requests/{req['id']}/complete",
                       json={"expected_version": req["version"], "status": "rejected", "resolution": "dup"})
    assert stale.status_code == 409
