from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from app import formats

router = APIRouter(prefix="/formats", tags=["formats"])


class PhaseOut(BaseModel):
    key: str
    label: str
    order: int
    slots: int | None = None
    is_group_stage: bool = False


class FormatOut(BaseModel):
    key: str
    label: str
    group_count: int
    teams_per_group: Optional[int] = None
    advancing_per_group: int
    total_teams: Optional[int] = None
    phases: List[PhaseOut]


def _serialize(f: formats.FormatSpec) -> FormatOut:
    return FormatOut(
        key=f.key,
        label=f.label,
        group_count=f.group_count,
        teams_per_group=f.teams_per_group,
        advancing_per_group=f.advancing_per_group,
        total_teams=f.total_teams,
        phases=[PhaseOut(**p.__dict__) for p in f.phases],
    )


@router.get("", response_model=List[FormatOut])
def list_formats():
    return [_serialize(f) for f in formats.FORMATS.values()]


@router.get("/{key}", response_model=FormatOut)
def get_format(key: str):
    spec = formats.get_format(key)
    if not spec:
        raise HTTPException(status_code=404, detail="Format not found")
    return _serialize(spec)
