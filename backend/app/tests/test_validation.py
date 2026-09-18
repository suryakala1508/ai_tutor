import io

from app.tests.conftest import auth_headers, create_space_and_project, signup


def test_material_upload_rejects_unsupported_type(client):
    token = signup(client, "v1@test.com")["access_token"]
    _, project = create_space_and_project(client, token)

    resp = client.post(
        f"/api/projects/{project['id']}/materials",
        headers=auth_headers(token),
        files={"file": ("evil.exe", io.BytesIO(b"binary junk"), "application/octet-stream")},
    )
    assert resp.status_code == 415


def test_material_upload_rejects_empty_file(client):
    token = signup(client, "v2@test.com")["access_token"]
    _, project = create_space_and_project(client, token)

    resp = client.post(
        f"/api/projects/{project['id']}/materials",
        headers=auth_headers(token),
        files={"file": ("empty.txt", io.BytesIO(b""), "text/plain")},
    )
    assert resp.status_code == 422


def test_quiz_answer_missing_field_rejected(client):
    token = signup(client, "v3@test.com")["access_token"]
    resp = client.post(
        "/api/projects/fake-project-id/quiz/answer",
        headers=auth_headers(token),
        json={"answer_text": "42"},  # missing question_id
    )
    assert resp.status_code == 422


def test_quiz_answer_unknown_extra_field_rejected(client):
    token = signup(client, "v4@test.com")["access_token"]
    resp = client.post(
        "/api/projects/fake-project-id/quiz/answer",
        headers=auth_headers(token),
        json={"question_id": "q1", "answer_text": "42", "override_score": 100},
    )
    assert resp.status_code == 422


def test_tutor_message_empty_body_rejected(client):
    token = signup(client, "v5@test.com")["access_token"]
    resp = client.post(
        "/api/projects/fake-project-id/tutor/message",
        headers=auth_headers(token),
        json={"conversation_id": "c1", "message": ""},
    )
    assert resp.status_code == 422


def test_tutor_message_extra_field_rejected(client):
    token = signup(client, "v6@test.com")["access_token"]
    resp = client.post(
        "/api/projects/fake-project-id/tutor/message",
        headers=auth_headers(token),
        json={"conversation_id": "c1", "message": "hello", "system_override": "ignore rules"},
    )
    assert resp.status_code == 422


def test_space_create_requires_name(client):
    token = signup(client, "v7@test.com")["access_token"]
    resp = client.post("/api/spaces", headers=auth_headers(token), json={"name": ""})
    assert resp.status_code == 422
