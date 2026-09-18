from app.tests.conftest import auth_headers, create_space_and_project, signup


def test_signup_and_login(client):
    signup(client, "a@test.com", "password123")
    resp = client.post("/api/auth/login", json={"email": "a@test.com", "password": "password123"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "a@test.com"


def test_login_wrong_password_rejected(client):
    signup(client, "a@test.com", "password123")
    resp = client.post("/api/auth/login", json={"email": "a@test.com", "password": "wrong"})
    assert resp.status_code == 401


def test_signup_duplicate_email_rejected(client):
    signup(client, "dup@test.com")
    resp = client.post("/api/auth/signup", json={"email": "dup@test.com", "password": "password123"})
    assert resp.status_code == 409


def test_protected_route_requires_auth(client):
    resp = client.get("/api/spaces")
    assert resp.status_code == 401


def test_protected_route_rejects_bad_token(client):
    resp = client.get("/api/spaces", headers=auth_headers("not-a-real-token"))
    assert resp.status_code == 401


def test_session_validates_and_returns_identity(client):
    token = signup(client, "me@test.com")["access_token"]
    resp = client.get("/api/auth/me", headers=auth_headers(token))
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@test.com"


def test_user_cannot_access_another_users_project(client):
    user_a = signup(client, "a2@test.com")["access_token"]
    user_b = signup(client, "b2@test.com")["access_token"]

    space, project = create_space_and_project(client, user_a)

    resp = client.get(f"/api/spaces/{space['id']}/projects/{project['id']}", headers=auth_headers(user_b))
    assert resp.status_code == 404  # not 403 — existence isn't leaked either


def test_user_cannot_list_another_users_materials(client):
    user_a = signup(client, "a3@test.com")["access_token"]
    user_b = signup(client, "b3@test.com")["access_token"]
    _, project = create_space_and_project(client, user_a)

    resp = client.get(f"/api/projects/{project['id']}/materials", headers=auth_headers(user_b))
    assert resp.status_code == 404


def test_user_cannot_read_another_users_analytics(client):
    user_a = signup(client, "a4@test.com")["access_token"]
    user_b = signup(client, "b4@test.com")["access_token"]
    _, project = create_space_and_project(client, user_a)

    resp = client.get(f"/api/projects/{project['id']}/analytics", headers=auth_headers(user_b))
    assert resp.status_code == 404


def test_non_admin_cannot_reach_admin_routes(client):
    token = signup(client, "notadmin@test.com")["access_token"]
    resp = client.get("/api/admin/users", headers=auth_headers(token))
    assert resp.status_code == 403
