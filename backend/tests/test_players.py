from tests.conftest import add_team


def test_player_roster_lifecycle(client, organizer, tournament):
    tid = tournament["id"]
    team = add_team(client, organizer, tid, "Lions", group="A")
    team_id = team["id"]

    assert client.get(f"/tournaments/{tid}/teams/{team_id}/players").json() == []

    r = client.post(
        f"/tournaments/{tid}/teams/{team_id}/players",
        json={"name": "Marko Petrov"},
        headers=organizer,
    )
    assert r.status_code == 200
    player = r.json()
    assert player["name"] == "Marko Petrov"
    assert player["team_id"] == team_id

    client.post(f"/tournaments/{tid}/teams/{team_id}/players", json={"name": "Ivan Iliev"}, headers=organizer)
    roster = client.get(f"/tournaments/{tid}/teams/{team_id}/players").json()
    assert [p["name"] for p in roster] == ["Marko Petrov", "Ivan Iliev"]

    r = client.delete(f"/tournaments/{tid}/teams/{team_id}/players/{player['id']}", headers=organizer)
    assert r.status_code == 204
    roster = client.get(f"/tournaments/{tid}/teams/{team_id}/players").json()
    assert [p["name"] for p in roster] == ["Ivan Iliev"]


def test_player_validation_and_permissions(client, organizer, organizer2, tournament):
    tid = tournament["id"]
    team = add_team(client, organizer, tid, "Lions", group="A")
    team_id = team["id"]

    r = client.post(f"/tournaments/{tid}/teams/{team_id}/players", json={"name": "  "}, headers=organizer)
    assert r.status_code == 400

    r = client.post(f"/tournaments/{tid}/teams/{team_id}/players", json={"name": "Intruder"}, headers=organizer2)
    assert r.status_code == 403

    assert client.post(f"/tournaments/{tid}/teams/{team_id}/players", json={"name": "X"}).status_code == 401

    r = client.get(f"/tournaments/{tid}/teams/9999/players")
    assert r.status_code == 404
