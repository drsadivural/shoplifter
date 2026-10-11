import psycopg
import pyotp

from conftest import Client, bootstrap_org, invite_and_login, login_admin


def test_login_requires_mfa_enrollment_for_admin_and_hides_account_existence(app):
    creds = bootstrap_org()
    cl = Client(app)
    unknown = cl.post("/v1/auth/login", json={"email": "nobody@example.test", "password": "x" * 14})
    wrong = cl.post("/v1/auth/login", json={"email": creds["email"], "password": "wrong-password-123"})
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["code"] == wrong.json()["code"] == "invalid_credentials"
    assert unknown.json()["message"] == wrong.json()["message"]

    r = cl.post("/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    assert r.json()["state"] == "mfa_enrollment_required"
    # Partial session cannot reach data
    assert cl.get("/v1/me").json()["code"] == "mfa_enrollment_required"
    secret = cl.get("/v1/auth/mfa/setup").json()["secret"]
    assert cl.post("/v1/auth/mfa/enable", json={"code": "000000"}).status_code == 401
    r = cl.post("/v1/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()})
    assert r.status_code == 200 and len(r.json()["recovery_codes"]) == 10
    me = cl.get("/v1/me").json()
    assert me["user"]["role"] == "org_admin" and "org.manage" in me["permissions"]


def test_mfa_verify_with_recovery_code_is_single_use(app):
    creds = bootstrap_org()
    cl = Client(app)
    cl.post("/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    secret = cl.get("/v1/auth/mfa/setup").json()["secret"]
    codes = cl.post("/v1/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()}).json()["recovery_codes"]
    for expected in (200, 401):
        c2 = Client(app)
        assert c2.post("/v1/auth/login", json={"email": creds["email"], "password": creds["password"]}).json()["state"] == "mfa_required"
        assert c2.post("/v1/auth/mfa/verify", json={"recovery_code": codes[0]}).status_code == expected


def test_csrf_required_for_cookie_mutations(org):
    admin = org["admin"]
    r = admin.c.post("/v1/stores", json={"name": "No CSRF", "address": "x", "timezone": "Asia/Tokyo"})
    assert r.status_code == 403 and r.json()["code"] == "csrf_failed"
    r = admin.c.post("/v1/stores", json={"name": "Bad CSRF", "address": "x", "timezone": "Asia/Tokyo"},
                     headers={"X-CSRF-Token": "forged"})
    assert r.status_code == 403


def test_login_rate_limited_after_repeated_failures(app):
    creds = bootstrap_org()
    cl = Client(app)
    codes = [cl.post("/v1/auth/login", json={"email": creds["email"], "password": "not-the-password!"}).status_code
             for _ in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429
    # Even the right password is refused while locked
    assert cl.post("/v1/auth/login", json={"email": creds["email"], "password": creds["password"]}).status_code == 429


def test_logout_revokes_session_and_bearer_client(org):
    app = org["app"]
    responder, creds = invite_and_login(app, org["admin"], "responder", [org["store"]["id"]])
    assert responder.get("/v1/me").status_code == 200
    assert responder.post("/v1/auth/logout").status_code == 200
    assert responder.get("/v1/me").status_code == 401
    ios = Client(app)
    r = ios.c.post("/v1/auth/login", json={"email": creds["email"], "password": creds["password"], "client": "ios"})
    token = r.json()["token"]
    assert ios.c.get("/v1/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    # bearer requests do not need CSRF
    assert ios.c.post("/v1/auth/logout", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert ios.c.get("/v1/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_role_change_revokes_sessions_and_self_lockout_prevented(org):
    app, admin = org["app"], org["admin"]
    viewer, creds = invite_and_login(app, admin, "viewer", [org["store"]["id"]])
    users = {u["id"]: u for u in admin.get("/v1/users").json()["items"]}
    me = admin.get("/v1/me").json()["user"]
    r = admin.patch(f"/v1/users/{me['id']}", json={"expected_version": users[me["id"]]["version"], "role": "viewer"})
    assert r.status_code == 403 and r.json()["code"] == "self_lockout"
    target = users[creds["id"]]
    r = admin.patch(f"/v1/users/{creds['id']}", json={"expected_version": target["version"], "role": "responder"})
    assert r.status_code == 200 and r.json()["role"] == "responder"
    assert viewer.get("/v1/me").status_code == 401  # session revoked on permission change
    stale = admin.patch(f"/v1/users/{creds['id']}", json={"expected_version": target["version"], "active": False})
    assert stale.status_code == 409 and stale.json()["current_version"] == target["version"] + 1


def test_password_reset_link_flow(org):
    app, admin = org["app"], org["admin"]
    _, creds = invite_and_login(app, admin, "responder", [org["store"]["id"]])
    url = admin.post(f"/v1/users/{creds['id']}/password-reset-link").json()["reset_url"]
    token = url.split("token=")[1]
    anon = Client(app)
    assert anon.post("/v1/auth/password-reset/complete", json={"token": token, "new_password": "short"}).status_code == 422
    assert anon.post("/v1/auth/password-reset/complete", json={"token": token, "new_password": "a-much-better-passphrase"}).status_code == 200
    assert anon.post("/v1/auth/password-reset/complete", json={"token": token, "new_password": "another-passphrase-x"}).status_code == 422
    assert anon.post("/v1/auth/login", json={"email": creds["email"], "password": "a-much-better-passphrase"}).status_code == 200
    # request endpoint never reveals existence
    assert anon.post("/v1/auth/password-reset/request", json={"email": "ghost@example.test"}).status_code == 202


def test_rls_blocks_rows_without_tenant_context(org):
    import os
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        assert conn.execute("SELECT count(*) FROM stores").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM app_users").fetchone()[0] == 0
        conn.execute("SELECT set_config('app.org_id', %s, false)", (org["creds"]["org_id"],))
        assert conn.execute("SELECT count(*) FROM stores").fetchone()[0] == 2
        # the API role cannot rewrite audit history
        try:
            conn.execute("DELETE FROM audit")
            assert False, "audit delete should be denied"
        except psycopg.errors.InsufficientPrivilege:
            pass
