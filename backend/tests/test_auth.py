from tests.conftest import register_and_login


def test_register_and_me(client):
    r = client.post(
        "/auth/register",
        json={"email": "a@example.com", "password": "secret123", "role": "user"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "a@example.com"
    assert body["role"] == "user"
    assert "password" not in body

    headers = register_and_login(client, "b@example.com")
    r = client.get("/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["email"] == "b@example.com"


def test_register_duplicate_email(client):
    payload = {"email": "dup@example.com", "password": "secret123", "role": "user"}
    assert client.post("/auth/register", json=payload).status_code == 200
    r = client.post("/auth/register", json=payload)
    assert r.status_code == 400
    assert "already registered" in r.json()["detail"]


def test_login_wrong_password(client):
    client.post(
        "/auth/register",
        json={"email": "c@example.com", "password": "rightpass", "role": "user"},
    )
    r = client.post("/auth/login", json={"email": "c@example.com", "password": "wrongpass"})
    assert r.status_code == 401


def test_login_unknown_email(client):
    r = client.post("/auth/login", json={"email": "nobody@example.com", "password": "x"})
    assert r.status_code == 401


def test_me_requires_token(client):
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
