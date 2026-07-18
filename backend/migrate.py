"""Bring the database up to the latest schema. Runs before the app starts.

Databases created before Alembic was introduced already have all tables but no
alembic_version table — those are stamped at the initial revision's schema
(which matches exactly what the old create_all + ad-hoc ALTERs produced) and
then upgraded from there.
"""
from sqlalchemy import inspect

from alembic import command
from alembic.config import Config

from app.database import engine

INITIAL_REVISION = "fabe059cf253"


def main() -> None:
    cfg = Config("alembic.ini")
    inspector = inspect(engine)
    if inspector.has_table("users") and not inspector.has_table("alembic_version"):
        print(f"Existing pre-Alembic database detected — stamping {INITIAL_REVISION}")
        command.stamp(cfg, INITIAL_REVISION)
    command.upgrade(cfg, "head")


if __name__ == "__main__":
    main()
