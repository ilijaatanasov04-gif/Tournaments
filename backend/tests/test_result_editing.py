"""Editing finished results: standings recalculation and downstream guards."""
from tests.conftest import add_team, list_matches, set_result


def _standings(client, tid):
    return {s["team_id"]: s for s in client.get(f"/tournaments/{tid}/standings").json()}


def test_edit_group_result_recalculates_standings(client, organizer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "X", group="A")
    add_team(client, organizer, tid, "Y", group="A")
    add_team(client, organizer, tid, "Z", group="A")  # third team keeps the group open
    match = list_matches(client, tid, headers=organizer)[0]
    home_id, away_id = match["home_team_id"], match["away_team_id"]

    assert set_result(client, organizer, match["id"], 3, 0).status_code == 200
    st = _standings(client, tid)
    assert st[home_id]["points"] == 3 and st[home_id]["goal_diff"] == 3

    # Typo fix: it was actually a 1-1 draw.
    r = set_result(client, organizer, match["id"], 1, 1)
    assert r.status_code == 200
    st = _standings(client, tid)
    assert st[home_id]["points"] == 1 and st[home_id]["goal_diff"] == 0
    assert st[away_id]["points"] == 1 and st[away_id]["goal_diff"] == 0
    assert st[home_id]["goals_scored"] == 1 and st[home_id]["goals_conceded"] == 1


def test_group_edit_locked_after_knockout_seeded(client, organizer, tournament):
    tid = tournament["id"]
    for g in ("A", "B"):
        add_team(client, organizer, tid, f"{g}1", group=g)
        add_team(client, organizer, tid, f"{g}2", group=g)
    group_matches = list_matches(client, tid, headers=organizer)
    for m in group_matches:
        assert set_result(client, organizer, m["id"], 2, 0).status_code == 200

    # Both groups complete -> knockout seeded -> group results are locked.
    r = set_result(client, organizer, group_matches[0]["id"], 0, 2)
    assert r.status_code == 409
    assert "locked" in r.json()["detail"]


def test_knockout_edit_allowed_until_next_round_exists(client, organizer, tournament):
    tid = tournament["id"]
    for g in ("A", "B"):
        add_team(client, organizer, tid, f"{g}1", group=g)
        add_team(client, organizer, tid, f"{g}2", group=g)
    for m in list_matches(client, tid, headers=organizer):
        assert set_result(client, organizer, m["id"], 2, 0).status_code == 200

    semis = [m for m in list_matches(client, tid, headers=organizer) if m["phase"] == "semi_final"]
    assert len(semis) == 2

    # Finish one semi, then correct it — the final doesn't exist yet, so editing
    # (even flipping the winner via penalties) is allowed.
    assert set_result(client, organizer, semis[0]["id"], 1, 0).status_code == 200
    r = set_result(client, organizer, semis[0]["id"], 1, 1, pen_home=2, pen_away=4)
    assert r.status_code == 200
    assert r.json()["pen_away"] == 4

    # Finish the other semi -> final created -> both semis are now locked.
    assert set_result(client, organizer, semis[1]["id"], 3, 1).status_code == 200
    r = set_result(client, organizer, semis[0]["id"], 5, 0)
    assert r.status_code == 409
    assert "advanced" in r.json()["detail"]

    # The final itself is still editable after being played (nothing after it).
    final = [m for m in list_matches(client, tid, headers=organizer) if m["phase"] == "final"][0]
    assert set_result(client, organizer, final["id"], 2, 0).status_code == 200
    r = set_result(client, organizer, final["id"], 0, 1)
    assert r.status_code == 200

    summary = client.get(f"/tournaments/{tid}").json()
    assert summary["champion_name"] is not None
