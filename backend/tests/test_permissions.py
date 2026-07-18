from tests.conftest import add_team


def test_permissions_endpoint(client, organizer, organizer2, tournament):
    tid = tournament["id"]

    r = client.get(f"/tournaments/{tid}/permissions", headers=organizer)
    assert r.status_code == 200
    assert r.json()["is_creator"] is True
    assert r.json()["can_edit"] is True
    assert r.json()["collaborators"] == []

    r = client.get(f"/tournaments/{tid}/permissions", headers=organizer2)
    assert r.json()["is_creator"] is False
    assert r.json()["can_edit"] is False


def test_collaborator_lifecycle(client, organizer, organizer2, tournament):
    tid = tournament["id"]

    # Non-collaborator organizer cannot edit.
    r = client.post(
        f"/tournaments/{tid}/teams",
        json={"name": "Intruders", "group_name": "A"},
        headers=organizer2,
    )
    assert r.status_code == 403

    # Creator adds them as collaborator.
    r = client.post(
        f"/tournaments/{tid}/collaborators",
        json={"email": "organizer2@example.com"},
        headers=organizer,
    )
    assert r.status_code == 200
    collaborator_id = r.json()["user_id"]

    r = client.get(f"/tournaments/{tid}/permissions", headers=organizer2)
    assert r.json()["can_edit"] is True
    assert r.json()["is_creator"] is False

    # Now they can edit.
    add_team(client, organizer2, tid, "Allowed FC", group="A")

    # Creator removes them; edit access is revoked.
    r = client.delete(f"/tournaments/{tid}/collaborators/{collaborator_id}", headers=organizer)
    assert r.status_code == 204
    r = client.post(
        f"/tournaments/{tid}/teams",
        json={"name": "Blocked FC", "group_name": "A"},
        headers=organizer2,
    )
    assert r.status_code == 403


def test_collaborator_management_is_creator_only(client, organizer, organizer2, viewer, tournament):
    tid = tournament["id"]
    r = client.post(
        f"/tournaments/{tid}/collaborators",
        json={"email": "viewer@example.com"},
        headers=organizer2,
    )
    assert r.status_code == 403


def test_collaborator_validation(client, organizer, organizer2, tournament):
    tid = tournament["id"]

    r = client.post(
        f"/tournaments/{tid}/collaborators",
        json={"email": "ghost@example.com"},
        headers=organizer,
    )
    assert r.status_code == 404

    r = client.post(
        f"/tournaments/{tid}/collaborators",
        json={"email": "organizer@example.com"},
        headers=organizer,
    )
    assert r.status_code == 400  # creator already has full access

    ok = {"email": "organizer2@example.com"}
    assert client.post(f"/tournaments/{tid}/collaborators", json=ok, headers=organizer).status_code == 200
    assert client.post(f"/tournaments/{tid}/collaborators", json=ok, headers=organizer).status_code == 400  # duplicate
