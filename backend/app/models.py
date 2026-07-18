from sqlalchemy import Column, Integer, String, ForeignKey, Enum, Date, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class UserRole(str, enum.Enum):
    user = "user"
    organizer = "organizer"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.user)

    tournaments = relationship("Tournament", back_populates="organizer")


class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    format = Column(String, nullable=False)
    location = Column(String)
    prize_pool = Column(Integer, nullable=True)
    prize_first = Column(Integer, nullable=True)
    prize_second = Column(Integer, nullable=True)
    prize_third = Column(Integer, nullable=True)
    prize_fourth = Column(Integer, nullable=True)
    organizer_id = Column(Integer, ForeignKey("users.id"))

    organizer = relationship("User", back_populates="tournaments")
    teams = relationship("Team", back_populates="tournament", cascade="all, delete")
    matches = relationship("Match", back_populates="tournament", cascade="all, delete")
    standings = relationship("Standing", back_populates="tournament", cascade="all, delete")
    collaborators = relationship("TournamentCollaborator", back_populates="tournament", cascade="all, delete")


class TournamentCollaborator(Base):
    __tablename__ = "tournament_collaborators"
    __table_args__ = (UniqueConstraint("tournament_id", "user_id", name="uq_tournament_user"),)

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    tournament = relationship("Tournament", back_populates="collaborators")
    user = relationship("User")


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"))
    group_name = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)

    tournament = relationship("Tournament", back_populates="teams")
    players = relationship("Player", back_populates="team", cascade="all, delete")
    home_matches = relationship("Match", foreign_keys="Match.home_team_id", back_populates="home_team")
    away_matches = relationship("Match", foreign_keys="Match.away_team_id", back_populates="away_team")
    standing = relationship("Standing", back_populates="team", uselist=False)


class Player(Base):
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"))

    team = relationship("Team", back_populates="players")


class MatchStatus(str, enum.Enum):
    scheduled = "scheduled"
    finished = "finished"


class Match(Base):
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"))
    home_team_id = Column(Integer, ForeignKey("teams.id"))
    away_team_id = Column(Integer, ForeignKey("teams.id"))
    score_home = Column(Integer, default=0)
    score_away = Column(Integer, default=0)
    pen_home = Column(Integer, nullable=True)
    pen_away = Column(Integer, nullable=True)
    status = Column(Enum(MatchStatus), default=MatchStatus.scheduled)
    phase = Column(String, default="group_stage")
    match_date = Column(Date, nullable=True)
    match_time = Column(String, nullable=True)

    tournament = relationship("Tournament", back_populates="matches")
    home_team = relationship("Team", foreign_keys=[home_team_id], back_populates="home_matches")
    away_team = relationship("Team", foreign_keys=[away_team_id], back_populates="away_matches")


class Standing(Base):
    __tablename__ = "standings"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), unique=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"))
    points = Column(Integer, default=0)
    goals_scored = Column(Integer, default=0)
    goals_conceded = Column(Integer, default=0)
    goal_diff = Column(Integer, default=0)

    team = relationship("Team", back_populates="standing")
    tournament = relationship("Tournament", back_populates="standings")
