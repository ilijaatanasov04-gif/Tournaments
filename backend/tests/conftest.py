import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

# Single shared in-memory database for the whole test process; the schema is
# rebuilt between tests so each test starts from a clean slate.
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _fresh_schema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def register_and_login(client, email, password="pass1234", role="user"):
    """Register a user and return auth headers for them."""
    r = client.post(
        "/auth/register",
        json={"email": email, "password": password, "role": role},
    )
    assert r.status_code == 200, r.text
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def organizer(client):
    return register_and_login(client, "organizer@example.com", role="organizer")


@pytest.fixture()
def organizer2(client):
    return register_and_login(client, "organizer2@example.com", role="organizer")


@pytest.fixture()
def viewer(client):
    return register_and_login(client, "viewer@example.com", role="user")


@pytest.fixture()
def tournament(client, organizer):
    """A tournament created by the `organizer` fixture."""
    r = client.post("/tournaments", json={"name": "Summer Cup"}, headers=organizer)
    assert r.status_code == 200, r.text
    return r.json()


def add_team(client, headers, tournament_id, name, group=None):
    r = client.post(
        f"/tournaments/{tournament_id}/teams",
        json={"name": name, "group_name": group},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


def list_matches(client, tournament_id, headers=None):
    r = client.get(f"/matches?tournament_id={tournament_id}", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


def set_result(client, headers, match_id, home, away, pen_home=None, pen_away=None):
    body = {"score_home": home, "score_away": away}
    if pen_home is not None:
        body["pen_home"] = pen_home
        body["pen_away"] = pen_away
    return client.put(f"/matches/{match_id}/result", json=body, headers=headers)
