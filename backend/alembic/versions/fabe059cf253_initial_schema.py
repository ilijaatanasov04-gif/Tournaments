"""initial schema

Revision ID: fabe059cf253
Revises: 
Create Date: 2026-07-03 17:33:43.080995

"""
from alembic import op
import sqlalchemy as sa


revision = 'fabe059cf253'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('password', sa.String(), nullable=False),
    sa.Column('role', sa.Enum('user', 'organizer', name='userrole'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_table('tournaments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('format', sa.String(), nullable=False),
    sa.Column('location', sa.String(), nullable=True),
    sa.Column('prize_pool', sa.Integer(), nullable=True),
    sa.Column('prize_first', sa.Integer(), nullable=True),
    sa.Column('prize_second', sa.Integer(), nullable=True),
    sa.Column('prize_third', sa.Integer(), nullable=True),
    sa.Column('prize_fourth', sa.Integer(), nullable=True),
    sa.Column('organizer_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['organizer_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tournaments_id'), 'tournaments', ['id'], unique=False)
    op.create_table('teams',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=True),
    sa.Column('group_name', sa.String(), nullable=True),
    sa.Column('logo_url', sa.String(), nullable=True),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_teams_id'), 'teams', ['id'], unique=False)
    op.create_table('tournament_collaborators',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tournament_id', 'user_id', name='uq_tournament_user')
    )
    op.create_index(op.f('ix_tournament_collaborators_id'), 'tournament_collaborators', ['id'], unique=False)
    op.create_index(op.f('ix_tournament_collaborators_tournament_id'), 'tournament_collaborators', ['tournament_id'], unique=False)
    op.create_index(op.f('ix_tournament_collaborators_user_id'), 'tournament_collaborators', ['user_id'], unique=False)
    op.create_table('matches',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=True),
    sa.Column('home_team_id', sa.Integer(), nullable=True),
    sa.Column('away_team_id', sa.Integer(), nullable=True),
    sa.Column('score_home', sa.Integer(), nullable=True),
    sa.Column('score_away', sa.Integer(), nullable=True),
    sa.Column('pen_home', sa.Integer(), nullable=True),
    sa.Column('pen_away', sa.Integer(), nullable=True),
    sa.Column('status', sa.Enum('scheduled', 'finished', name='matchstatus'), nullable=True),
    sa.Column('phase', sa.String(), nullable=True),
    sa.Column('match_date', sa.Date(), nullable=True),
    sa.Column('match_time', sa.String(), nullable=True),
    sa.ForeignKeyConstraint(['away_team_id'], ['teams.id'], ),
    sa.ForeignKeyConstraint(['home_team_id'], ['teams.id'], ),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_matches_id'), 'matches', ['id'], unique=False)
    op.create_table('players',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('team_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_players_id'), 'players', ['id'], unique=False)
    op.create_table('standings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('team_id', sa.Integer(), nullable=True),
    sa.Column('tournament_id', sa.Integer(), nullable=True),
    sa.Column('points', sa.Integer(), nullable=True),
    sa.Column('goals_scored', sa.Integer(), nullable=True),
    sa.Column('goals_conceded', sa.Integer(), nullable=True),
    sa.Column('goal_diff', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('team_id')
    )
    op.create_index(op.f('ix_standings_id'), 'standings', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_standings_id'), table_name='standings')
    op.drop_table('standings')
    op.drop_index(op.f('ix_players_id'), table_name='players')
    op.drop_table('players')
    op.drop_index(op.f('ix_matches_id'), table_name='matches')
    op.drop_table('matches')
    op.drop_index(op.f('ix_tournament_collaborators_user_id'), table_name='tournament_collaborators')
    op.drop_index(op.f('ix_tournament_collaborators_tournament_id'), table_name='tournament_collaborators')
    op.drop_index(op.f('ix_tournament_collaborators_id'), table_name='tournament_collaborators')
    op.drop_table('tournament_collaborators')
    op.drop_index(op.f('ix_teams_id'), table_name='teams')
    op.drop_table('teams')
    op.drop_index(op.f('ix_tournaments_id'), table_name='tournaments')
    op.drop_table('tournaments')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    # drop_table doesn't remove PostgreSQL enum types; no-op on other dialects
    sa.Enum(name='matchstatus').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='userrole').drop(op.get_bind(), checkfirst=True)
