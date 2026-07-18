from tests.conftest import add_team, list_matches, set_result


def test_add_team_creates_standing_and_group_matches(client, organizer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "Alpha", group="A")
    add_team(client, organizer, tid, "Bravo", group="A")
    add_team(client, organizer, tid, "Charlie", group="A")

    standings = client.get(f"/tournaments/{tid}/standings").json()
    assert len(standings) == 3
    assert all(s["points"] == 0 for s in standings)

    # Round-robin inside the group: 3 teams -> 3 matches, all group_stage, undated.
    matches = list_matches(client, tid, headers=organizer)
    assert len(matches) == 3
    assert all(m["phase"] == "group_stage" for m in matches)
    assert all(m["match_date"] is None for m in matches)


def test_team_without_group_gets_no_matches(client, organizer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "Loner")
    assert list_matches(client, tid, headers=organizer) == []


def test_moving_team_regenerates_pending_matches(client, organizer, tournament):
    tid = tournament["id"]
    a1 = add_team(client, organizer, tid, "A1", group="A")
    add_team(client, organizer, tid, "A2", group="A")
    add_team(client, organizer, tid, "B1", group="B")

    r = client.patch(
        f"/tournaments/{tid}/teams/{a1['id']}",
        json={"group_name": "B"},
        headers=organizer,
    )
    assert r.status_code == 200

    matches = list_matches(client, tid, headers=organizer)
    assert len(matches) == 1  # old A1-A2 match dropped, new A1-B1 match created
    teams = {matches[0]["home_team_id"], matches[0]["away_team_id"]}
    assert a1["id"] in teams


def test_result_updates_standings(client, organizer, tournament):
    tid = tournament["id"]
    home = add_team(client, organizer, tid, "Home", group="A")
    away = add_team(client, organizer, tid, "Away", group="A")
    match = list_matches(client, tid, headers=organizer)[0]

    r = set_result(client, organizer, match["id"], 3, 1)
    assert r.status_code == 200
    assert r.json()["status"] == "finished"

    standings = {s["team_id"]: s for s in client.get(f"/tournaments/{tid}/standings").json()}
    winner_id = match["home_team_id"]
    loser_id = match["away_team_id"]
    assert standings[winner_id]["points"] == 3
    assert standings[winner_id]["goal_diff"] == 2
    assert standings[loser_id]["points"] == 0
    assert standings[loser_id]["goal_diff"] == -2
    assert {home["id"], away["id"]} == {winner_id, loser_id}


def test_group_draw_gives_a_point_each(client, organizer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "X", group="A")
    add_team(client, organizer, tid, "Y", group="A")
    match = list_matches(client, tid, headers=organizer)[0]

    assert set_result(client, organizer, match["id"], 2, 2).status_code == 200
    standings = client.get(f"/tournaments/{tid}/standings").json()
    assert [s["points"] for s in standings] == [1, 1]


def test_resubmitting_a_result_edits_it(client, organizer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "X", group="A")
    add_team(client, organizer, tid, "Y", group="A")
    add_team(client, organizer, tid, "Z", group="A")
    match = list_matches(client, tid, headers=organizer)[0]

    assert set_result(client, organizer, match["id"], 1, 0).status_code == 200
    r = set_result(client, organizer, match["id"], 2, 0)
    assert r.status_code == 200
    assert r.json()["score_home"] == 2


def test_result_requires_edit_access(client, organizer, organizer2, viewer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "X", group="A")
    add_team(client, organizer, tid, "Y", group="A")
    match = list_matches(client, tid, headers=organizer)[0]

    assert set_result(client, viewer, match["id"], 1, 0).status_code == 403  # not an organizer
    assert set_result(client, organizer2, match["id"], 1, 0).status_code == 403  # not a collaborator


def test_knockout_draw_requires_decisive_penalties(client, organizer, tournament):
    tid = tournament["id"]
    x = add_team(client, organizer, tid, "X", group="A")
    y = add_team(client, organizer, tid, "Y", group="A")
    r = client.post(
        "/matches",
        json={
            "tournament_id": tid,
            "home_team_id": x["id"],
            "away_team_id": y["id"],
            "phase": "quarter_final",
        },
        headers=organizer,
    )
    assert r.status_code == 200
    mid = r.json()["id"]

    assert set_result(client, organizer, mid, 1, 1).status_code == 400  # no penalties
    assert set_result(client, organizer, mid, 1, 1, pen_home=4, pen_away=4).status_code == 400  # tied shootout

    r = set_result(client, organizer, mid, 1, 1, pen_home=5, pen_away=4)
    assert r.status_code == 200
    assert r.json()["pen_home"] == 5
    assert r.json()["pen_away"] == 4


def test_match_visibility_and_date_editing(client, organizer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "X", group="A")
    add_team(client, organizer, tid, "Y", group="A")

    # Editors see undated matches, anonymous visitors don't.
    editor_view = list_matches(client, tid, headers=organizer)
    assert len(editor_view) == 1
    assert list_matches(client, tid) == []

    # Scheduling the match makes it public.
    mid = editor_view[0]["id"]
    r = client.patch(
        f"/matches/{mid}",
        json={"match_date": "2026-08-01", "match_time": "18:30"},
        headers=organizer,
    )
    assert r.status_code == 200
    public = list_matches(client, tid)
    assert len(public) == 1
    assert public[0]["match_date"] == "2026-08-01"
    assert public[0]["match_time"] == "18:30"


def test_finished_matches_are_public_even_without_date(client, organizer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "X", group="A")
    add_team(client, organizer, tid, "Y", group="A")
    match = list_matches(client, tid, headers=organizer)[0]

    assert list_matches(client, tid) == []  # unscheduled + not played -> private
    assert set_result(client, organizer, match["id"], 1, 0).status_code == 200

    public = list_matches(client, tid)
    assert len(public) == 1
    assert public[0]["status"] == "finished"
