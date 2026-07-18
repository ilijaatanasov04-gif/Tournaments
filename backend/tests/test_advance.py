"""Bracket auto-advance flows.

The first knockout phase adapts to the number of groups in use:
1 group pair -> semi finals, 2 pairs -> quarter finals, 4 pairs -> round of 16.
Every bracket therefore ends at the final and produces a champion.
"""
from tests.conftest import add_team, list_matches, set_result


def _matches_by_phase(client, tid, headers):
    matches = list_matches(client, tid, headers=headers)
    by_phase = {}
    for m in matches:
        by_phase.setdefault(m["phase"], []).append(m)
    return by_phase


def _finish(client, headers, match, home, away, pens=None):
    r = set_result(
        client, headers, match["id"], home, away,
        pen_home=pens[0] if pens else None,
        pen_away=pens[1] if pens else None,
    )
    assert r.status_code == 200, r.text


def test_two_group_bracket_seeds_semis_and_crowns_champion(client, organizer, tournament):
    tid = tournament["id"]
    a1 = add_team(client, organizer, tid, "A1", group="A")
    a2 = add_team(client, organizer, tid, "A2", group="A")
    b1 = add_team(client, organizer, tid, "B1", group="B")
    b2 = add_team(client, organizer, tid, "B2", group="B")

    by_phase = _matches_by_phase(client, tid, organizer)
    assert set(by_phase) == {"group_stage"}
    group_a = [m for m in by_phase["group_stage"] if {m["home_team_id"], m["away_team_id"]} == {a1["id"], a2["id"]}]
    group_b = [m for m in by_phase["group_stage"] if {m["home_team_id"], m["away_team_id"]} == {b1["id"], b2["id"]}]
    assert len(group_a) == 1 and len(group_b) == 1

    # Group A done, group B still pending -> no knockout yet.
    _finish(client, organizer, group_a[0], 3, 0)
    by_phase = _matches_by_phase(client, tid, organizer)
    assert set(by_phase) == {"group_stage"}

    # Group B done -> with only 2 groups the bracket starts at the semi finals,
    # cross-group seeded: 1A-2B / 1B-2A.
    _finish(client, organizer, group_b[0], 2, 1)
    by_phase = _matches_by_phase(client, tid, organizer)
    semis = by_phase.get("semi_final", [])
    assert len(semis) == 2
    assert "round_of_16" not in by_phase and "quarter_final" not in by_phase

    a_first = group_a[0]["home_team_id"]
    a_second = group_a[0]["away_team_id"]
    b_first = group_b[0]["home_team_id"]
    b_second = group_b[0]["away_team_id"]
    pairings = {frozenset((m["home_team_id"], m["away_team_id"])) for m in semis}
    assert pairings == {frozenset((a_first, b_second)), frozenset((b_first, a_second))}

    # Finish both semis; one decided on penalties.
    _finish(client, organizer, semis[0], 1, 0)
    assert "final" not in _matches_by_phase(client, tid, organizer)
    _finish(client, organizer, semis[1], 2, 2, pens=(5, 4))

    by_phase = _matches_by_phase(client, tid, organizer)
    final = by_phase.get("final", [])
    assert len(final) == 1
    expected_finalists = {semis[0]["home_team_id"], semis[1]["home_team_id"]}
    assert {final[0]["home_team_id"], final[0]["away_team_id"]} == expected_finalists

    # Final decided on penalties -> champion reported.
    _finish(client, organizer, final[0], 1, 1, pens=(4, 2))
    summary = client.get(f"/tournaments/{tid}").json()
    assert summary["current_phase"] == "final"
    assert summary["champion_name"] is not None


def test_four_group_bracket_starts_at_quarter_finals(client, organizer, tournament):
    tid = tournament["id"]
    for g in ["A", "B", "C", "D"]:
        add_team(client, organizer, tid, f"{g}1", group=g)
        add_team(client, organizer, tid, f"{g}2", group=g)

    for m in _matches_by_phase(client, tid, organizer)["group_stage"]:
        _finish(client, organizer, m, 2, 0)

    by_phase = _matches_by_phase(client, tid, organizer)
    assert len(by_phase.get("quarter_final", [])) == 4
    assert "round_of_16" not in by_phase

    for m in by_phase["quarter_final"]:
        _finish(client, organizer, m, 1, 1, pens=(3, 1))
    by_phase = _matches_by_phase(client, tid, organizer)
    assert len(by_phase.get("semi_final", [])) == 2

    for m in by_phase["semi_final"]:
        _finish(client, organizer, m, 1, 0)
    by_phase = _matches_by_phase(client, tid, organizer)
    assert len(by_phase.get("final", [])) == 1

    _finish(client, organizer, by_phase["final"][0], 2, 0)
    summary = client.get(f"/tournaments/{tid}").json()
    assert summary["champion_name"] is not None


def test_manual_advance_reports_state(client, organizer, tournament):
    tid = tournament["id"]
    add_team(client, organizer, tid, "A1", group="A")
    add_team(client, organizer, tid, "A2", group="A")

    # Nothing ready yet -> helpful 400.
    r = client.post(f"/tournaments/{tid}/advance", headers=organizer)
    assert r.status_code == 400
    assert "No group pairs ready" in r.json()["detail"]

    add_team(client, organizer, tid, "B1", group="B")
    add_team(client, organizer, tid, "B2", group="B")
    for m in list_matches(client, tid, headers=organizer):
        _finish(client, organizer, m, 1, 0)

    # Auto-advance already seeded the first knockout phase -> nothing to do.
    r = client.post(f"/tournaments/{tid}/advance", headers=organizer)
    assert r.status_code == 400
    assert "already seeded" in r.json()["detail"]


def test_champion_reported_in_summary(client, organizer, tournament):
    tid = tournament["id"]
    x = add_team(client, organizer, tid, "Lions", group="A")
    y = add_team(client, organizer, tid, "Tigers", group="A")
    r = client.post(
        "/matches",
        json={
            "tournament_id": tid,
            "home_team_id": x["id"],
            "away_team_id": y["id"],
            "phase": "final",
        },
        headers=organizer,
    )
    assert r.status_code == 200
    _finish(client, organizer, r.json(), 2, 0)

    summary = client.get(f"/tournaments/{tid}").json()
    assert summary["current_phase"] == "final"
    assert summary["champion_name"] == "Lions"


def test_bracket_pairings_follow_slots_not_completion_order(client, organizer, tournament):
    """Winners of bracket-adjacent matches must meet in the next round even when
    results are entered in a scrambled order (regression: pairing used to
    follow match-creation order, scrambling the bracket)."""
    tid = tournament["id"]
    for g in "ABCDEFGH":
        add_team(client, organizer, tid, f"{g}1", group=g)
        add_team(client, organizer, tid, f"{g}2", group=g)
    for m in _matches_by_phase(client, tid, organizer)["group_stage"]:
        _finish(client, organizer, m, 2, 0)

    r16 = _matches_by_phase(client, tid, organizer)["round_of_16"]
    r16.sort(key=lambda m: m["id"])
    assert len(r16) == 8

    # Finish R16 slot-pairs in scrambled order: (2,3), (6,7), (0,1), (4,5).
    for slot in (2, 3, 6, 7, 0, 1, 4, 5):
        _finish(client, organizer, r16[slot], 1, 0)  # home team advances

    qf = _matches_by_phase(client, tid, organizer)["quarter_final"]
    assert len(qf) == 4

    # Bracket-order the QFs by their feeder slots, then finish them scrambled too.
    def feeder_slot(match):
        for i, rm in enumerate(r16):
            if match["home_team_id"] in (rm["home_team_id"], rm["away_team_id"]):
                return i // 2
        raise AssertionError("QF team not found in R16")

    qf_by_slot = sorted(qf, key=feeder_slot)
    for slot in (1, 3, 0, 2):
        _finish(client, organizer, qf_by_slot[slot], 3, 0)

    semis = _matches_by_phase(client, tid, organizer)["semi_final"]
    assert len(semis) == 2
    sf_pairings = {frozenset((m["home_team_id"], m["away_team_id"])) for m in semis}
    qf_winners = [m["home_team_id"] for m in qf_by_slot]  # home won every QF
    expected = {
        frozenset((qf_winners[0], qf_winners[1])),
        frozenset((qf_winners[2], qf_winners[3])),
    }
    assert sf_pairings == expected
