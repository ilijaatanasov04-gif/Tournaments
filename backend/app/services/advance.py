from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from app import models, formats


def _ranked_teams_per_group(db: Session, tournament_id: int) -> dict[str, list[models.Team]]:
    teams = (
        db.query(models.Team)
        .filter(models.Team.tournament_id == tournament_id)
        .all()
    )
    standings = {
        s.team_id: s
        for s in db.query(models.Standing)
        .filter(models.Standing.tournament_id == tournament_id)
        .all()
    }

    by_group: dict[str, list[models.Team]] = {}
    for t in teams:
        if t.group_name:
            by_group.setdefault(t.group_name, []).append(t)

    def rank_key(t):
        s = standings.get(t.id)
        return (
            -(s.points if s else 0),
            -(s.goal_diff if s else 0),
            -(s.goals_scored if s else 0),
        )

    for ts in by_group.values():
        ts.sort(key=rank_key)
    return by_group


# Cross-group R16 pairings for 8 groups (A-H): top 2 of each group play
# the other group in their pair. 1A-2B, 1B-2A, 1C-2D, 1D-2C, etc.
_R16_GROUP_PAIRS = [("A", "B"), ("C", "D"), ("E", "F"), ("G", "H")]

# Formats that share this module's group-stage + cross-group-knockout engine.
# All formats registered today use it; a genuinely different shape (e.g. a
# round-robin-only league) would need its own seeder and shouldn't be added here.
_GROUP_KNOCKOUT_FORMATS = {formats.STANDARD.key, formats.FOUR_GROUPS.key, formats.TWO_GROUPS.key}


# ── Group-stage round-robin auto-generation ──────────────────────────────

def add_group_matches_for_team(db: Session, tournament_id: int, team: models.Team) -> list[models.Match]:
    """Create group-stage matches between `team` and every other team currently in the same group.
    Skips pairings that already have a match. No date is assigned."""
    if not team.group_name:
        return []
    other_teams = (
        db.query(models.Team)
        .filter(
            models.Team.tournament_id == tournament_id,
            models.Team.group_name == team.group_name,
            models.Team.id != team.id,
        )
        .all()
    )
    created: list[models.Match] = []
    for other in other_teams:
        existing = (
            db.query(models.Match)
            .filter(
                models.Match.tournament_id == tournament_id,
                models.Match.phase == "group_stage",
                or_(
                    and_(models.Match.home_team_id == team.id, models.Match.away_team_id == other.id),
                    and_(models.Match.home_team_id == other.id, models.Match.away_team_id == team.id),
                ),
            )
            .first()
        )
        if existing:
            continue
        m = models.Match(
            tournament_id=tournament_id,
            home_team_id=team.id,
            away_team_id=other.id,
            phase="group_stage",
        )
        db.add(m)
        created.append(m)
    if created:
        db.commit()
        for m in created:
            db.refresh(m)
    return created


def remove_unfinished_group_matches_for_team(db: Session, tournament_id: int, team_id: int) -> int:
    """Delete unfinished group-stage matches involving the given team. Returns count deleted."""
    matches = (
        db.query(models.Match)
        .filter(
            models.Match.tournament_id == tournament_id,
            models.Match.phase == "group_stage",
            models.Match.status == models.MatchStatus.scheduled,
            or_(models.Match.home_team_id == team_id, models.Match.away_team_id == team_id),
        )
        .all()
    )
    for m in matches:
        db.delete(m)
    if matches:
        db.commit()
    return len(matches)


# ── Knockout seeding / per-pair auto-advance ─────────────────────────────

def _group_complete(db: Session, tournament_id: int, group_name: str) -> bool:
    """A group is 'complete' when it has at least 2 teams and all of its
    intra-group matches are finished."""
    team_ids = [
        t.id
        for t in db.query(models.Team)
        .filter(
            models.Team.tournament_id == tournament_id,
            models.Team.group_name == group_name,
        )
        .all()
    ]
    if len(team_ids) < 2:
        return False
    matches = (
        db.query(models.Match)
        .filter(
            models.Match.tournament_id == tournament_id,
            models.Match.phase == "group_stage",
            or_(
                models.Match.home_team_id.in_(team_ids),
                models.Match.away_team_id.in_(team_ids),
            ),
        )
        .all()
    )
    if not matches:
        return False
    return all(m.status == models.MatchStatus.finished for m in matches)


def _winner_team_id(m: models.Match):
    if m.score_home > m.score_away:
        return m.home_team_id
    if m.score_away > m.score_home:
        return m.away_team_id
    # Draw at full time — fall back to penalty shootout if recorded.
    if m.pen_home is not None and m.pen_away is not None:
        if m.pen_home > m.pen_away:
            return m.home_team_id
        if m.pen_away > m.pen_home:
            return m.away_team_id
    return None  # unresolved draw


def _first_knockout_phase_key(db: Session, tournament: models.Tournament) -> str:
    """Pick the first knockout phase so the bracket always ends at the final.

    The bracket size adapts to how many groups are actually used: 1 active group
    pair produces 2 first-round matches (semi finals), 2 pairs produce 4
    (quarter finals), 4 pairs produce 8 (round of 16). Once knockout matches
    exist, their earliest phase is reused so the bracket stays consistent even
    if more groups gain teams later."""
    spec = formats.get_format(tournament.format)
    knockout_phases = sorted(
        (p for p in spec.phases if not p.is_group_stage), key=lambda p: p.order
    )

    existing = (
        db.query(models.Match.phase)
        .filter(
            models.Match.tournament_id == tournament.id,
            models.Match.phase != "group_stage",
        )
        .distinct()
        .all()
    )
    if existing:
        existing_keys = {row[0] for row in existing}
        for p in knockout_phases:
            if p.key in existing_keys:
                return p.key

    populated_groups = {
        g
        for (g,) in db.query(models.Team.group_name)
        .filter(models.Team.tournament_id == tournament.id, models.Team.group_name.isnot(None))
        .distinct()
        .all()
    }
    active_pairs = sum(
        1 for g1, g2 in _R16_GROUP_PAIRS if g1 in populated_groups or g2 in populated_groups
    )
    needed_matches = 2 * max(active_pairs, 1)

    # Tightest phase that fits all first-round matches (slots == matches in phase).
    for p in reversed(knockout_phases):
        if p.slots is not None and p.slots >= needed_matches:
            return p.key
    return knockout_phases[0].key


def seed_first_knockout_for_ready_pairs(db: Session, tournament: models.Tournament) -> list[models.Match]:
    """For each group pair (A-B, C-D, E-F, G-H), if both groups are complete and the
    pair's first-round knockout matches don't yet exist, create them. The target
    phase adapts to the number of groups in use (see _first_knockout_phase_key)."""
    if tournament.format not in _GROUP_KNOCKOUT_FORMATS:
        return []

    first_phase = _first_knockout_phase_key(db, tournament)
    ranked = _ranked_teams_per_group(db, tournament.id)
    created: list[models.Match] = []

    for g1, g2 in _R16_GROUP_PAIRS:
        if not _group_complete(db, tournament.id, g1):
            continue
        if not _group_complete(db, tournament.id, g2):
            continue
        a, b = ranked[g1], ranked[g2]
        pairings = [(a[0], b[1]), (b[0], a[1])]
        for home, away in pairings:
            existing = (
                db.query(models.Match)
                .filter(
                    models.Match.tournament_id == tournament.id,
                    models.Match.phase == first_phase,
                    or_(
                        and_(
                            models.Match.home_team_id == home.id,
                            models.Match.away_team_id == away.id,
                        ),
                        and_(
                            models.Match.home_team_id == away.id,
                            models.Match.away_team_id == home.id,
                        ),
                    ),
                )
                .first()
            )
            if existing:
                continue
            m = models.Match(
                tournament_id=tournament.id,
                phase=first_phase,
                home_team_id=home.id,
                away_team_id=away.id,
            )
            db.add(m)
            created.append(m)
    if created:
        db.commit()
        for m in created:
            db.refresh(m)
    return created


def bracket_ordered_matches(
    db: Session, tournament: models.Tournament, phase_key: str
) -> list:
    """Return the matches of a knockout phase in bracket order, with None holes
    for slots whose match hasn't been created yet.

    The first knockout phase is ordered by id (matches are created two at a
    time per group pair, so id-adjacent matches are true bracket pairs). Every
    later phase places each match at the slot of the feeder pair its teams came
    from, so 'winners of slots 2j and 2j+1 meet at slot j' holds by
    construction — regardless of the order results were entered in."""
    spec = formats.get_format(tournament.format)
    if not spec:
        return []
    ko_keys = [p.key for p in sorted(spec.phases, key=lambda p: p.order) if not p.is_group_stage]
    if phase_key not in ko_keys:
        return []

    per_phase: dict[str, list[models.Match]] = {k: [] for k in ko_keys}
    for m in (
        db.query(models.Match)
        .filter(
            models.Match.tournament_id == tournament.id,
            models.Match.phase.in_(ko_keys),
        )
        .order_by(models.Match.id)
        .all()
    ):
        per_phase[m.phase].append(m)

    prev_slots = None
    for key in ko_keys:
        cur = per_phase[key]
        if prev_slots is None:
            if not cur and key != phase_key:
                continue  # leading phase not used (small bracket)
            slots = list(cur)
        else:
            pair_count = max(1, len(prev_slots) // 2)
            slots = [None] * pair_count
            team_to_pair = {}
            for i, m in enumerate(prev_slots):
                if m is not None:
                    team_to_pair[m.home_team_id] = i // 2
                    team_to_pair[m.away_team_id] = i // 2
            leftovers = []
            for m in cur:
                j = team_to_pair.get(m.home_team_id, team_to_pair.get(m.away_team_id))
                if j is not None and j < pair_count and slots[j] is None:
                    slots[j] = m
                else:
                    leftovers.append(m)
            for m in leftovers:
                if None in slots:
                    slots[slots.index(None)] = m
        if key == phase_key:
            return slots
        prev_slots = slots
    return []


def _advance_finished_knockout_pairs(
    db: Session, tournament: models.Tournament, finished_phase_key: str
) -> list[models.Match]:
    """Pair matches in `finished_phase_key` by bracket slot. Whenever both
    matches in a slot pair are finished and their next-phase match doesn't
    exist yet, create it with the two winners."""
    spec = formats.get_format(tournament.format)
    if not spec:
        return []
    phases = sorted(spec.phases, key=lambda p: p.order)
    try:
        idx = next(i for i, p in enumerate(phases) if p.key == finished_phase_key)
    except StopIteration:
        return []
    if idx + 1 >= len(phases):
        return []
    next_phase = phases[idx + 1]

    phase_matches = bracket_ordered_matches(db, tournament, finished_phase_key)
    next_matches = (
        db.query(models.Match)
        .filter(
            models.Match.tournament_id == tournament.id,
            models.Match.phase == next_phase.key,
        )
        .all()
    )

    created: list[models.Match] = []
    for i in range(0, len(phase_matches) - 1, 2):
        m1, m2 = phase_matches[i], phase_matches[i + 1]
        if m1 is None or m2 is None:
            continue
        if m1.status != models.MatchStatus.finished or m2.status != models.MatchStatus.finished:
            continue
        w1 = _winner_team_id(m1)
        w2 = _winner_team_id(m2)
        if w1 is None or w2 is None:
            continue
        # Skip if a next-phase match between these two winners already exists.
        if any({nm.home_team_id, nm.away_team_id} == {w1, w2} for nm in next_matches):
            continue
        nm = models.Match(
            tournament_id=tournament.id,
            phase=next_phase.key,
            home_team_id=w1,
            away_team_id=w2,
        )
        db.add(nm)
        created.append(nm)
    if created:
        db.commit()
        for m in created:
            db.refresh(m)
    return created


def maybe_advance_after_result(db: Session, match: models.Match) -> list[models.Match]:
    """Called after a match result is saved. Seeds the next phase incrementally:
    - group_stage → first knockout phase: per group pair (A-B, C-D, E-F, G-H),
      as each pair finishes
    - knockout → next knockout: per pair of consecutive matches, as each pair finishes"""
    if not match.tournament:
        return []
    if match.phase == "group_stage":
        return seed_first_knockout_for_ready_pairs(db, match.tournament)
    return _advance_finished_knockout_pairs(db, match.tournament, match.phase)


# Kept for the manual `POST /tournaments/{id}/advance` endpoint — same semantics
# as the auto-advance: seed any pair that's ready.
def seed_first_knockout_phase(db: Session, tournament: models.Tournament) -> list[models.Match]:
    spec = formats.get_format(tournament.format)
    if not spec:
        raise ValueError(f"Unknown format '{tournament.format}'")
    if tournament.format not in _GROUP_KNOCKOUT_FORMATS:
        raise ValueError(f"No seeder implemented for format '{tournament.format}'")

    created = seed_first_knockout_for_ready_pairs(db, tournament)
    if not created:
        # Help the caller understand why nothing happened.
        ranked = _ranked_teams_per_group(db, tournament.id)
        ready_pairs = [
            (g1, g2)
            for g1, g2 in _R16_GROUP_PAIRS
            if _group_complete(db, tournament.id, g1) and _group_complete(db, tournament.id, g2)
        ]
        if not ready_pairs:
            existing_groups = sorted(ranked.keys())
            raise ValueError(
                "No group pairs ready yet. Need at least one of A-B, C-D, E-F, G-H "
                f"with both groups containing 2+ teams and all matches finished. "
                f"Current groups: {', '.join(existing_groups) or 'none'}."
            )
        raise ValueError("Knockout already seeded for all ready group pairs.")
    return created
