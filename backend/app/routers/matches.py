from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app import models, schemas, formats
from app.services.auth import (
    require_organizer,
    assert_can_edit_tournament,
    can_edit_tournament,
    get_tournament_or_404,
    get_optional_user,
)
from app.services import advance as advance_service

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("", response_model=List[schemas.MatchOut])
def list_matches(
    tournament_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_user),
):
    query = db.query(models.Match)
    if tournament_id:
        query = query.filter(models.Match.tournament_id == tournament_id)
        tournament = (
            db.query(models.Tournament)
            .filter(models.Tournament.id == tournament_id)
            .first()
        )
        is_editor = bool(
            tournament
            and current_user
            and can_edit_tournament(current_user, tournament, db)
        )
    else:
        is_editor = False
    if not is_editor:
        # Non-editors see scheduled fixtures (dated) and all finished results.
        # Undated *upcoming* matches stay private until the organizer sets a date.
        query = query.filter(
            or_(
                models.Match.match_date.isnot(None),
                models.Match.status == models.MatchStatus.finished,
            )
        )
    return query.all()


@router.post("", response_model=schemas.MatchOut)
def create_match(
    data: schemas.MatchCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    tournament = get_tournament_or_404(data.tournament_id, db)
    assert_can_edit_tournament(current_user, tournament, db)
    match = models.Match(**data.model_dump())
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


@router.patch("/{match_id}", response_model=schemas.MatchOut)
def update_match(
    match_id: int,
    data: schemas.MatchUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    tournament = get_tournament_or_404(match.tournament_id, db)
    assert_can_edit_tournament(current_user, tournament, db)
    if "match_date" in data.model_fields_set:
        match.match_date = data.match_date
    if "match_time" in data.model_fields_set:
        match.match_time = (data.match_time.strip() if data.match_time else None) or None
    db.commit()
    db.refresh(match)
    return match


@router.put("/{match_id}/result", response_model=schemas.MatchOut)
def set_result(
    match_id: int,
    result: schemas.MatchResult,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_organizer),
):
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    tournament = get_tournament_or_404(match.tournament_id, db)
    assert_can_edit_tournament(current_user, tournament, db)

    is_edit = match.status == models.MatchStatus.finished
    is_knockout = match.phase != "group_stage"
    is_draw = result.score_home == result.score_away

    if is_edit:
        # Editing a result is only safe while nothing downstream depends on it.
        _assert_result_editable(db, match)

    if is_knockout and is_draw:
        if result.pen_home is None or result.pen_away is None:
            raise HTTPException(
                status_code=400,
                detail="Knockout match ended in a draw — enter penalty shootout scores.",
            )
        if result.pen_home == result.pen_away:
            raise HTTPException(
                status_code=400,
                detail="Penalty shootout cannot end in a tie.",
            )

    if is_edit and match.phase == "group_stage":
        _revert_standings(db, match)

    match.score_home = result.score_home
    match.score_away = result.score_away
    if is_knockout and is_draw:
        match.pen_home = result.pen_home
        match.pen_away = result.pen_away
    else:
        match.pen_home = None
        match.pen_away = None
    match.status = models.MatchStatus.finished

    if match.phase == "group_stage":
        _update_standings(db, match)
    db.commit()
    db.refresh(match)

    advance_service.maybe_advance_after_result(db, match)
    return match


def _assert_result_editable(db: Session, match: models.Match):
    """A finished result may be corrected as long as no later round was built
    on top of it. Otherwise the organizer must undo the later rounds first."""
    if match.phase == "group_stage":
        # Blocked once the knockout pair fed by this group has been seeded:
        # any non-group match involving a team from this group.
        group_team_ids = [
            t.id
            for t in db.query(models.Team).filter(
                models.Team.tournament_id == match.tournament_id,
                models.Team.group_name
                == db.query(models.Team.group_name)
                .filter(models.Team.id == match.home_team_id)
                .scalar(),
            )
        ]
        dependent = (
            db.query(models.Match)
            .filter(
                models.Match.tournament_id == match.tournament_id,
                models.Match.phase != "group_stage",
                or_(
                    models.Match.home_team_id.in_(group_team_ids),
                    models.Match.away_team_id.in_(group_team_ids),
                ),
            )
            .first()
        )
        if dependent:
            raise HTTPException(
                status_code=409,
                detail="This group already fed the knockout bracket — its results are locked.",
            )
        return

    # Knockout: blocked once either team appears in a later phase.
    spec = formats.get_format(match.tournament.format)
    phase_keys = [p.key for p in sorted(spec.phases, key=lambda p: p.order)] if spec else []
    later_keys = phase_keys[phase_keys.index(match.phase) + 1:] if match.phase in phase_keys else []
    if not later_keys:
        return
    later_phase_match = (
        db.query(models.Match)
        .filter(
            models.Match.tournament_id == match.tournament_id,
            models.Match.phase.in_(later_keys),
            or_(
                models.Match.home_team_id.in_([match.home_team_id, match.away_team_id]),
                models.Match.away_team_id.in_([match.home_team_id, match.away_team_id]),
            ),
        )
        .first()
    )
    if later_phase_match:
        raise HTTPException(
            status_code=409,
            detail="The winner already advanced to the next round — this result is locked.",
        )


def _revert_standings(db: Session, match: models.Match):
    """Remove a previously recorded result's contribution to the standings."""
    home_standing = db.query(models.Standing).filter(
        models.Standing.team_id == match.home_team_id
    ).first()
    away_standing = db.query(models.Standing).filter(
        models.Standing.team_id == match.away_team_id
    ).first()

    if not home_standing or not away_standing:
        return

    home_standing.goals_scored -= match.score_home
    home_standing.goals_conceded -= match.score_away
    away_standing.goals_scored -= match.score_away
    away_standing.goals_conceded -= match.score_home

    if match.score_home > match.score_away:
        home_standing.points -= 3
    elif match.score_home < match.score_away:
        away_standing.points -= 3
    else:
        home_standing.points -= 1
        away_standing.points -= 1

    home_standing.goal_diff = home_standing.goals_scored - home_standing.goals_conceded
    away_standing.goal_diff = away_standing.goals_scored - away_standing.goals_conceded


def _update_standings(db: Session, match: models.Match):
    home_standing = db.query(models.Standing).filter(
        models.Standing.team_id == match.home_team_id
    ).first()
    away_standing = db.query(models.Standing).filter(
        models.Standing.team_id == match.away_team_id
    ).first()

    if not home_standing or not away_standing:
        return

    home_standing.goals_scored += match.score_home
    home_standing.goals_conceded += match.score_away
    away_standing.goals_scored += match.score_away
    away_standing.goals_conceded += match.score_home

    if match.score_home > match.score_away:
        home_standing.points += 3
    elif match.score_home < match.score_away:
        away_standing.points += 3
    else:
        home_standing.points += 1
        away_standing.points += 1

    home_standing.goal_diff = home_standing.goals_scored - home_standing.goals_conceded
    away_standing.goal_diff = away_standing.goals_scored - away_standing.goals_conceded
