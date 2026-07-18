"""Populate the database with realistic demo data.

Creates a demo organizer account and three tournaments in different states:
a completed one (full bracket, penalties, champion), one mid-group-stage,
and one that hasn't kicked off yet.

Run inside Docker:   docker compose exec backend python seed_demo.py
Run locally:         python seed_demo.py   (needs DATABASE_URL)

Demo login: demo@tournamentmanager.app / demo1234
The script is a no-op if the demo account already exists.
"""
import random
from datetime import date, timedelta

from app.database import SessionLocal
from app import models
from app.services.auth import hash_password
from app.services import advance as advance_service
from app.routers.matches import _update_standings

DEMO_EMAIL = "demo@tournamentmanager.app"
DEMO_PASSWORD = "demo1234"

CLUBS = [
    "Red Star United", "Olympia FC", "Riverside Rovers", "Northgate City",
    "Falcon Athletic", "Iron Harbour", "Blue Valley", "Crystal Point",
    "Thunder Park", "Golden Coast", "Silver Lake FC", "Westbridge",
    "Eagle Rock", "Marble Town", "Stormfield", "Highland Wolves",
    "Cedar Grove", "Portside FC", "Lakeside Union", "Foxhill Rangers",
    "Granite City", "Sunset Harbour", "Kings Meadow", "Victory Lane",
    "Aurora FC", "Delta Sporting", "Cobalt Town", "Harbour Lights",
    "Maple Cross", "Southgate Wanderers", "Pinnacle FC", "Old Quarter",
    "Beacon Hill", "Rapid Meadows", "Ivory Coast Rangers", "Summit City",
]

random.seed(42)
TODAY = date.today()


def add_team(db, tournament, name, group):
    team = models.Team(name=name, tournament_id=tournament.id, group_name=group)
    db.add(team)
    db.commit()
    db.refresh(team)
    db.add(models.Standing(team_id=team.id, tournament_id=tournament.id))
    db.commit()
    advance_service.add_group_matches_for_team(db, tournament.id, team)
    return team


def play(db, match, score_home, score_away, pens=None):
    match.score_home = score_home
    match.score_away = score_away
    if pens:
        match.pen_home, match.pen_away = pens
    match.status = models.MatchStatus.finished
    if match.phase == "group_stage":
        _update_standings(db, match)
    db.commit()
    db.refresh(match)
    advance_service.maybe_advance_after_result(db, match)


def random_score(allow_draw=True):
    home, away = random.randint(0, 4), random.randint(0, 3)
    if not allow_draw and home == away:
        home += 1
    return home, away


def date_matches(db, tournament_id, start, spacing_days=1, time_slots=("17:00", "19:00", "21:00")):
    """Assign dates/times to all undated matches of a tournament."""
    matches = (
        db.query(models.Match)
        .filter(models.Match.tournament_id == tournament_id, models.Match.match_date.is_(None))
        .order_by(models.Match.id)
        .all()
    )
    for i, m in enumerate(matches):
        m.match_date = start + timedelta(days=(i // len(time_slots)) * spacing_days)
        m.match_time = time_slots[i % len(time_slots)]
    db.commit()


def make_tournament(db, organizer, name, location, pool=None):
    prizes = {}
    if pool:
        prizes = {
            "prize_pool": pool,
            "prize_first": pool // 2,
            "prize_second": int(pool * 0.3),
            "prize_third": int(pool * 0.13),
            "prize_fourth": int(pool * 0.07),
        }
    t = models.Tournament(
        name=name, format="standard", location=location,
        organizer_id=organizer.id, **prizes,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def play_out_group_stage(db, tournament_id, allow_draws=True):
    for m in (
        db.query(models.Match)
        .filter(
            models.Match.tournament_id == tournament_id,
            models.Match.phase == "group_stage",
            models.Match.status == models.MatchStatus.scheduled,
        )
        .order_by(models.Match.id)
        .all()
    ):
        play(db, m, *random_score(allow_draw=allow_draws))


def play_out_knockouts(db, tournament_id):
    """Knockout rounds appear progressively as results come in — keep playing
    until the bracket is decided."""
    while True:
        pending = (
            db.query(models.Match)
            .filter(
                models.Match.tournament_id == tournament_id,
                models.Match.phase != "group_stage",
                models.Match.status == models.MatchStatus.scheduled,
            )
            .order_by(models.Match.id)
            .all()
        )
        if not pending:
            break
        for m in pending:
            home, away = random_score()
            pens = None
            if home == away:
                pa = random.randint(1, 4)
                pens = (pa + 1, pa) if random.random() < 0.5 else (pa, pa + 1)
            play(db, m, home, away, pens=pens)


def main():
    db = SessionLocal()
    try:
        if db.query(models.User).filter(models.User.email == DEMO_EMAIL).first():
            print("Demo data already seeded — nothing to do.")
            return

        organizer = models.User(
            email=DEMO_EMAIL,
            password=hash_password(DEMO_PASSWORD),
            role=models.UserRole.organizer,
        )
        db.add(organizer)
        db.commit()
        db.refresh(organizer)
        print(f"Created demo organizer: {DEMO_EMAIL} / {DEMO_PASSWORD}")

        # 1. Completed tournament: 8 groups x 2 teams, full bracket with penalties.
        t1 = make_tournament(db, organizer, "Champions Trophy 2026", "London", pool=5000)
        clubs = iter(CLUBS[:16])
        for group in "ABCDEFGH":
            add_team(db, t1, next(clubs), group)
            add_team(db, t1, next(clubs), group)
        date_matches(db, t1.id, TODAY - timedelta(days=21))
        play_out_group_stage(db, t1.id)
        date_matches(db, t1.id, TODAY - timedelta(days=10))  # R16 got created undated
        play_out_knockouts(db, t1.id)
        date_matches(db, t1.id, TODAY - timedelta(days=5))   # later rounds
        print(f"Seeded finished tournament: {t1.name}")

        # 2. Ongoing tournament: 4 groups x 3 teams, group stage half-played.
        t2 = make_tournament(db, organizer, "Spring League Cup", "Madrid", pool=1500)
        clubs = iter(CLUBS[16:28])
        for group in "ABCD":
            for _ in range(3):
                add_team(db, t2, next(clubs), group)
        date_matches(db, t2.id, TODAY - timedelta(days=4))
        group_matches = (
            db.query(models.Match)
            .filter(models.Match.tournament_id == t2.id, models.Match.phase == "group_stage")
            .order_by(models.Match.id)
            .all()
        )
        # Play every other match so all groups are visibly mid-stage.
        for i, m in enumerate(group_matches):
            if i % 2 == 0:
                play(db, m, *random_score())
        date_matches(db, t2.id, TODAY + timedelta(days=3))  # anything newly created
        print(f"Seeded ongoing tournament: {t2.name}")

        # 3. Upcoming tournament: teams registered, fixtures scheduled, no results.
        t3 = make_tournament(db, organizer, "Summer Invitational", "Amsterdam", pool=800)
        clubs = iter(CLUBS[28:36])
        for group in "AB":
            for _ in range(4):
                add_team(db, t3, next(clubs), group)
        date_matches(db, t3.id, TODAY + timedelta(days=7), spacing_days=2)
        print(f"Seeded upcoming tournament: {t3.name}")

        print("Done. Sign in with the demo account to manage the tournaments.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
