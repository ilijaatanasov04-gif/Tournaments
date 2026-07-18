from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import models, schemas, formats
from app.services.auth import (
    get_current_user,
    require_organizer,
    assert_can_edit_tournament,
    is_tournament_creator,
    get_tournament_or_404,
)
from app.services import advance as advance_service

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


_PHASE_ORDER = ["group_stage", "round_of_16", "quarter_final", "semi_final", "final"]


def _summarize(t: models.Tournament, db: Session) -> dict:
    team_count = (
        db.query(models.Team).filter(models.Team.tournament_id == t.id).count()
    )
    match_total = (
        db.query(models.Match).filter(models.Match.tournament_id == t.id).count()
    )
    match_done = (
        db.query(models.Match)
        .filter(
            models.Match.tournament_id == t.id,
            models.Match.status == models.MatchStatus.finished,
        )
        .count()
    )

    current_phase = None
    for phase in reversed(_PHASE_ORDER):
        has_phase = (
            db.query(models.Match)
            .filter(models.Match.tournament_id == t.id, models.Match.phase == phase)
            .first()
        )
        if has_phase:
            current_phase = phase
            break

    champion_name = None
    final_match = (
        db.query(models.Match)
        .filter(
            models.Match.tournament_id == t.id,
            models.Match.phase == "final",
            models.Match.status == models.MatchStatus.finished,
        )
        .first()
    )
    if final_match:
        if final_match.score_home > final_match.score_away:
            winner_id = final_match.home_team_id
        elif final_match.score_away > final_match.score_home:
            winner_id = final_match.away_team_id
        elif final_match.pen_home is not None and final_match.pen_away is not None:
            winner_id = (
                final_match.home_team_id
                if final_match.pen_home > final_match.pen_away
                else final_match.away_team_id
                if final_match.pen_away > final_match.pen_home
                else None
            )
        else:
            winner_id = None
        if winner_id:
            winner = (
                db.query(models.Team).filter(models.Team.id == winner_id).first()
            )
            if winner:
                champion_name = winner.name

    return {
        "id": t.id,
        "name": t.name,
        "format": t.format,
        "location": t.location,
        "prize_pool": t.prize_pool,
        "prize_first": t.prize_first,
        "prize_second": t.prize_second,
        "prize_third": t.prize_third,
        "prize_fourth": t.prize_fourth,
        "organizer_id": t.organizer_id,
        "team_count": team_count,
        "match_total": match_total,
        "match_done": match_done,
        "current_phase": current_phase,
        "champion_name": champion_name,
    }


@router.get("", response_model=List[schemas.TournamentSummary])
def list_tournaments(db: Session = Depends(get_db)):
    tournaments = db.query(models.Tournament).all()
    return [_summarize(t, db) for t in tournaments]


@router.get("/{tournament_id}", response_model=schemas.TournamentSummary)
def get_tournament(tournament_id: int, db: Session = Depends(get_db)):
    t = get_tournament_or_404(tournament_id, db)
    return _summarize(t, db)


@router.post("", response_model=schemas.TournamentSummary)
def create_tournament(
    data: schemas.TournamentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    fmt = data.format or formats.DEFAULT_FORMAT_KEY
    if not formats.get_format(fmt):
        raise HTTPException(status_code=400, detail=f"Unknown format '{fmt}'")
    payload = data.model_dump()
    payload["format"] = fmt
    t = models.Tournament(**payload, organizer_id=current_user.id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return _summarize(t, db)


@router.delete("/{tournament_id}", status_code=204)
def delete_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    t = get_tournament_or_404(tournament_id, db)
    if not is_tournament_creator(current_user, t):
        raise HTTPException(status_code=403, detail="Only the tournament creator can delete it")
    db.delete(t)
    db.commit()


@router.patch("/{tournament_id}", response_model=schemas.TournamentSummary)
def update_tournament(
    tournament_id: int,
    data: schemas.TournamentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    t = get_tournament_or_404(tournament_id, db)
    if not is_tournament_creator(current_user, t):
        raise HTTPException(status_code=403, detail="Only the tournament creator can edit details")

    fields_set = data.model_fields_set
    if "name" in fields_set:
        if not data.name or not data.name.strip():
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        t.name = data.name.strip()
    if "location" in fields_set:
        t.location = data.location.strip() if data.location else None
    for field in ("prize_pool", "prize_first", "prize_second", "prize_third", "prize_fourth"):
        if field in fields_set:
            value = getattr(data, field)
            if value is not None and value < 0:
                raise HTTPException(status_code=400, detail=f"{field} cannot be negative")
            setattr(t, field, value)

    db.commit()
    db.refresh(t)
    return _summarize(t, db)


# Permissions
@router.get("/{tournament_id}/permissions", response_model=schemas.TournamentPermissions)
def get_permissions(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    t = get_tournament_or_404(tournament_id, db)
    collabs = (
        db.query(models.TournamentCollaborator)
        .filter(models.TournamentCollaborator.tournament_id == tournament_id)
        .all()
    )
    return {
        "tournament_id": t.id,
        "organizer_id": t.organizer_id,
        "is_creator": is_tournament_creator(current_user, t),
        "can_edit": is_tournament_creator(current_user, t)
        or any(c.user_id == current_user.id for c in collabs),
        "collaborators": [
            schemas.CollaboratorOut(
                user_id=c.user_id,
                email=c.user.email,
            )
            for c in collabs
        ],
    }


@router.post("/{tournament_id}/collaborators", response_model=schemas.CollaboratorOut)
def add_collaborator(
    tournament_id: int,
    data: schemas.CollaboratorAdd,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    t = get_tournament_or_404(tournament_id, db)
    if not is_tournament_creator(current_user, t):
        raise HTTPException(status_code=403, detail="Only the creator can manage collaborators")
    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"No user with email '{data.email}'")
    if user.id == t.organizer_id:
        raise HTTPException(status_code=400, detail="The creator already has full access")
    existing = (
        db.query(models.TournamentCollaborator)
        .filter(
            models.TournamentCollaborator.tournament_id == tournament_id,
            models.TournamentCollaborator.user_id == user.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="User is already a collaborator")
    c = models.TournamentCollaborator(tournament_id=tournament_id, user_id=user.id)
    db.add(c)
    db.commit()
    db.refresh(c)
    return schemas.CollaboratorOut(user_id=user.id, email=user.email)


@router.delete("/{tournament_id}/collaborators/{user_id}", status_code=204)
def remove_collaborator(
    tournament_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    t = get_tournament_or_404(tournament_id, db)
    if not is_tournament_creator(current_user, t):
        raise HTTPException(status_code=403, detail="Only the creator can manage collaborators")
    c = (
        db.query(models.TournamentCollaborator)
        .filter(
            models.TournamentCollaborator.tournament_id == tournament_id,
            models.TournamentCollaborator.user_id == user_id,
        )
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Collaborator not found")
    db.delete(c)
    db.commit()


# Teams
@router.get("/{tournament_id}/teams", response_model=List[schemas.TeamOut])
def list_teams(tournament_id: int, db: Session = Depends(get_db)):
    return db.query(models.Team).filter(models.Team.tournament_id == tournament_id).all()


@router.post("/{tournament_id}/teams", response_model=schemas.TeamOut)
def add_team(
    tournament_id: int,
    data: schemas.TeamCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    tournament = get_tournament_or_404(tournament_id, db)
    assert_can_edit_tournament(current_user, tournament, db)
    t = models.Team(
        name=data.name,
        tournament_id=tournament_id,
        group_name=data.group_name,
        logo_url=(data.logo_url.strip() if data.logo_url else None) or None,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    standing = models.Standing(team_id=t.id, tournament_id=tournament_id)
    db.add(standing)
    db.commit()
    advance_service.add_group_matches_for_team(db, tournament_id, t)
    return t


@router.patch("/{tournament_id}/teams/{team_id}", response_model=schemas.TeamOut)
def update_team(
    tournament_id: int,
    team_id: int,
    data: schemas.TeamUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    tournament = get_tournament_or_404(tournament_id, db)
    assert_can_edit_tournament(current_user, tournament, db)
    team = db.query(models.Team).filter(
        models.Team.id == team_id,
        models.Team.tournament_id == tournament_id,
    ).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    group_changed = data.group_name is not None and data.group_name != team.group_name
    if data.group_name is not None:
        team.group_name = data.group_name
    db.commit()
    db.refresh(team)
    if group_changed:
        advance_service.remove_unfinished_group_matches_for_team(db, tournament_id, team.id)
        advance_service.add_group_matches_for_team(db, tournament_id, team)
    return team


# Players
def _get_team_or_404(tournament_id: int, team_id: int, db: Session) -> models.Team:
    team = (
        db.query(models.Team)
        .filter(models.Team.id == team_id, models.Team.tournament_id == tournament_id)
        .first()
    )
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.get("/{tournament_id}/teams/{team_id}/players", response_model=List[schemas.PlayerOut])
def list_players(tournament_id: int, team_id: int, db: Session = Depends(get_db)):
    _get_team_or_404(tournament_id, team_id, db)
    return db.query(models.Player).filter(models.Player.team_id == team_id).order_by(models.Player.id).all()


@router.post("/{tournament_id}/teams/{team_id}/players", response_model=schemas.PlayerOut)
def add_player(
    tournament_id: int,
    team_id: int,
    data: schemas.PlayerCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    tournament = get_tournament_or_404(tournament_id, db)
    assert_can_edit_tournament(current_user, tournament, db)
    team = _get_team_or_404(tournament_id, team_id, db)
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Player name cannot be empty")
    player = models.Player(name=name, team_id=team.id)
    db.add(player)
    db.commit()
    db.refresh(player)
    return player


@router.delete("/{tournament_id}/teams/{team_id}/players/{player_id}", status_code=204)
def remove_player(
    tournament_id: int,
    team_id: int,
    player_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    tournament = get_tournament_or_404(tournament_id, db)
    assert_can_edit_tournament(current_user, tournament, db)
    _get_team_or_404(tournament_id, team_id, db)
    player = (
        db.query(models.Player)
        .filter(models.Player.id == player_id, models.Player.team_id == team_id)
        .first()
    )
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    db.delete(player)
    db.commit()


# Standings
@router.get("/{tournament_id}/standings", response_model=List[schemas.StandingOut])
def get_standings(tournament_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.Standing)
        .filter(models.Standing.tournament_id == tournament_id)
        .order_by(models.Standing.points.desc(), models.Standing.goal_diff.desc())
        .all()
    )


@router.post("/{tournament_id}/advance", response_model=List[schemas.MatchOut])
def advance_to_knockout(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    tournament = get_tournament_or_404(tournament_id, db)
    assert_can_edit_tournament(current_user, tournament, db)
    try:
        return advance_service.seed_first_knockout_phase(db, tournament)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
