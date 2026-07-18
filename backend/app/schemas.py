from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import date
from app.models import UserRole, MatchStatus


# Auth
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: UserRole = UserRole.user


class UserOut(BaseModel):
    id: int
    email: str
    role: UserRole

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# Tournaments
class TournamentCreate(BaseModel):
    name: str
    format: Optional[str] = None
    location: Optional[str] = None
    prize_pool: Optional[int] = None
    prize_first: Optional[int] = None
    prize_second: Optional[int] = None
    prize_third: Optional[int] = None
    prize_fourth: Optional[int] = None


class TournamentUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    prize_pool: Optional[int] = None
    prize_first: Optional[int] = None
    prize_second: Optional[int] = None
    prize_third: Optional[int] = None
    prize_fourth: Optional[int] = None


class TournamentOut(BaseModel):
    id: int
    name: str
    format: str
    location: Optional[str]
    prize_pool: Optional[int] = None
    prize_first: Optional[int] = None
    prize_second: Optional[int] = None
    prize_third: Optional[int] = None
    prize_fourth: Optional[int] = None
    organizer_id: int

    model_config = {"from_attributes": True}


class TournamentSummary(BaseModel):
    id: int
    name: str
    format: str
    location: Optional[str]
    prize_pool: Optional[int] = None
    prize_first: Optional[int] = None
    prize_second: Optional[int] = None
    prize_third: Optional[int] = None
    prize_fourth: Optional[int] = None
    organizer_id: int
    team_count: int
    match_total: int
    match_done: int
    current_phase: Optional[str] = None
    champion_name: Optional[str] = None


# Teams
class TeamCreate(BaseModel):
    name: str
    group_name: Optional[str] = None
    logo_url: Optional[str] = None


class TeamUpdate(BaseModel):
    group_name: Optional[str] = None
    logo_url: Optional[str] = None


class TeamOut(BaseModel):
    id: int
    name: str
    tournament_id: int
    group_name: Optional[str] = None
    logo_url: Optional[str] = None

    model_config = {"from_attributes": True}


# Players
class PlayerCreate(BaseModel):
    name: str


class PlayerOut(BaseModel):
    id: int
    name: str
    team_id: int

    model_config = {"from_attributes": True}


# Matches
class MatchCreate(BaseModel):
    tournament_id: int
    home_team_id: int
    away_team_id: int
    phase: str = "group_stage"
    match_date: Optional[date] = None
    match_time: Optional[str] = None


class MatchUpdate(BaseModel):
    match_date: Optional[date] = None
    match_time: Optional[str] = None


class MatchResult(BaseModel):
    score_home: int
    score_away: int
    pen_home: Optional[int] = None
    pen_away: Optional[int] = None


class MatchOut(BaseModel):
    id: int
    tournament_id: int
    home_team_id: int
    away_team_id: int
    score_home: int
    score_away: int
    pen_home: Optional[int] = None
    pen_away: Optional[int] = None
    status: MatchStatus
    phase: str = "group_stage"
    match_date: Optional[date] = None
    match_time: Optional[str] = None

    model_config = {"from_attributes": True}


# Permissions
class CollaboratorOut(BaseModel):
    user_id: int
    email: str


class CollaboratorAdd(BaseModel):
    email: EmailStr


class TournamentPermissions(BaseModel):
    tournament_id: int
    organizer_id: int
    is_creator: bool
    can_edit: bool
    collaborators: List[CollaboratorOut]


# Standings
class StandingOut(BaseModel):
    team_id: int
    tournament_id: int
    points: int
    goals_scored: int
    goals_conceded: int
    goal_diff: int

    model_config = {"from_attributes": True}
