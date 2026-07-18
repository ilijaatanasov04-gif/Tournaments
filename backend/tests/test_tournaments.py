def test_create_defaults_to_standard_format(client, organizer):
    r = client.post("/tournaments", json={"name": "Cup"}, headers=organizer)
    assert r.status_code == 200
    body = r.json()
    assert body["format"] == "standard"
    assert body["team_count"] == 0
    assert body["match_total"] == 0
    assert body["current_phase"] is None
    assert body["champion_name"] is None


def test_create_rejects_unknown_format(client, organizer):
    r = client.post("/tournaments", json={"name": "Cup", "format": "nope"}, headers=organizer)
    assert r.status_code == 400


def test_create_requires_organizer_role(client, viewer):
    r = client.post("/tournaments", json={"name": "Cup"}, headers=viewer)
    assert r.status_code == 403


def test_create_requires_auth(client):
    assert client.post("/tournaments", json={"name": "Cup"}).status_code == 401


def test_list_and_get(client, organizer, tournament):
    r = client.get("/tournaments")
    assert r.status_code == 200
    assert [t["name"] for t in r.json()] == ["Summer Cup"]

    r = client.get(f"/tournaments/{tournament['id']}")
    assert r.status_code == 200
    assert r.json()["name"] == "Summer Cup"

    assert client.get("/tournaments/9999").status_code == 404


def test_update_details_creator_only(client, organizer, organizer2, tournament):
    tid = tournament["id"]
    r = client.patch(
        f"/tournaments/{tid}",
        json={"name": "Renamed Cup", "location": "Skopje", "prize_pool": 1000},
        headers=organizer,
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed Cup"
    assert r.json()["location"] == "Skopje"
    assert r.json()["prize_pool"] == 1000

    r = client.patch(f"/tournaments/{tid}", json={"name": "Hijacked"}, headers=organizer2)
    assert r.status_code == 403


def test_update_validation(client, organizer, tournament):
    tid = tournament["id"]
    assert client.patch(f"/tournaments/{tid}", json={"name": "  "}, headers=organizer).status_code == 400
    assert client.patch(f"/tournaments/{tid}", json={"prize_pool": -5}, headers=organizer).status_code == 400


def test_delete_creator_only(client, organizer, organizer2, tournament):
    tid = tournament["id"]
    # A collaborator still cannot delete.
    client.post(
        f"/tournaments/{tid}/collaborators",
        json={"email": "organizer2@example.com"},
        headers=organizer,
    )
    assert client.delete(f"/tournaments/{tid}", headers=organizer2).status_code == 403

    assert client.delete(f"/tournaments/{tid}", headers=organizer).status_code == 204
    assert client.get(f"/tournaments/{tid}").status_code == 404
