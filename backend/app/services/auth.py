import os
import bcrypt
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import get_db
from app import models

ENV = os.getenv("ENV", "dev")
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    if ENV == "dev":
        SECRET_KEY = "changeme-secret-key-for-dev"
    else:
        raise RuntimeError("SECRET_KEY env var is required when ENV != 'dev'")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_optional_user(
    token: str = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            return None
    except JWTError:
        return None
    return db.query(models.User).filter(models.User.id == int(user_id)).first()


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception
    return user


def require_organizer(current_user: models.User = Depends(get_current_user)):
    if current_user.role != models.UserRole.organizer:
        raise HTTPException(status_code=403, detail="Organizer access required")
    return current_user


def is_tournament_creator(user: models.User, tournament: models.Tournament) -> bool:
    return tournament.organizer_id == user.id


def can_edit_tournament(user: models.User, tournament: models.Tournament, db: Session) -> bool:
    if is_tournament_creator(user, tournament):
        return True
    exists = (
        db.query(models.TournamentCollaborator)
        .filter(
            models.TournamentCollaborator.tournament_id == tournament.id,
            models.TournamentCollaborator.user_id == user.id,
        )
        .first()
    )
    return exists is not None


def get_tournament_or_404(tournament_id: int, db: Session) -> models.Tournament:
    t = db.query(models.Tournament).filter(models.Tournament.id == tournament_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return t


def assert_can_edit_tournament(user: models.User, tournament: models.Tournament, db: Session):
    if not can_edit_tournament(user, tournament, db):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this tournament")
