import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("GROQ_API_KEY", "test-key-not-real")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.database import Base, get_db
from app.main import app

get_settings.cache_clear()

TEST_DB_PATH = "./test.db"
engine = create_engine(f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def _clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    session = TestSessionLocal()
    yield session
    session.close()


def signup(client, email="user@test.com", password="password123", name="Test User"):
    resp = client.post("/api/auth/signup", json={"name": name, "email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create_space_and_project(client, token, space_name="Space", project_name="Project"):
    space = client.post("/api/spaces", headers=auth_headers(token), json={"name": space_name}).json()
    project = client.post(
        f"/api/spaces/{space['id']}/projects", headers=auth_headers(token), json={"name": project_name, "goal": "test goal"}
    ).json()
    return space, project
