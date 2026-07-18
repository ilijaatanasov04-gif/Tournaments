"""Full 16-team bracket: groups A-H, penalties at every knockout stage."""
from tests.conftest import add_team, list_matches, set_result

GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H"]


def _by_phase(client, tid, headers):
    out = {}
    for m in list_matches(client, tid, headers=headers):
        out.setdefault(m["phase"], []).append(m)
    return out


def test_full_bracket_with_penalties_every_round(client, organizer, tournament):
    tid = tournament["id"]
    for g in GROUPS:
        add_team(client, organizer, tid, f"{g}1", group=g)
        add_team(client, organizer, tid, f"{g}2", group=g)

    # Finish all 8 group matches.
    for m in _by_phase(client, tid, organizer)["group_stage"]:
        r = set_result(client, organizer, m["id"], 2, 0)
        assert r.status_code == 200, r.text

    by_phase = _by_phase(client, tid, organizer)
    assert len(by_phase.get("round_of_16", [])) == 8, f"R16 has {len(by_phase.get('round_of_16', []))}"

    # R16: decide every match on penalties (draw + shootout).
    for m in by_phase["round_of_16"]:
        r = set_result(client, organizer, m["id"], 1, 1, pen_home=5, pen_away=4)
        assert r.status_code == 200, r.text

    by_phase = _by_phase(client, tid, organizer)
    assert len(by_phase.get("quarter_final", [])) == 4, f"QF has {len(by_phase.get('quarter_final', []))}: {by_phase.keys()}"

    # QF: penalties again.
    for m in by_phase["quarter_final"]:
        r = set_result(client, organizer, m["id"], 0, 0, pen_home=3, pen_away=2)
        assert r.status_code == 200, r.text

    by_phase = _by_phase(client, tid, organizer)
    assert len(by_phase.get("semi_final", [])) == 2, f"SF has {len(by_phase.get('semi_final', []))}"

    # SF: penalties again.
    for m in by_phase["semi_final"]:
        r = set_result(client, organizer, m["id"], 2, 2, pen_home=4, pen_away=1)
        assert r.status_code == 200, r.text

    by_phase = _by_phase(client, tid, organizer)
    assert len(by_phase.get("final", [])) == 1, f"final has {len(by_phase.get('final', []))}"

    # Final on penalties; champion must be reported.
    final = by_phase["final"][0]
    r = set_result(client, organizer, final["id"], 1, 1, pen_home=6, pen_away=5)
    assert r.status_code == 200, r.text
    summary = client.get(f"/tournaments/{tid}").json()
    assert summary["champion_name"] is not None
