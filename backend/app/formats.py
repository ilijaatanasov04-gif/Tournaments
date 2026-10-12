from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class PhaseSpec:
    key: str
    label: str
    order: int
    slots: Optional[int] = None
    is_group_stage: bool = False


@dataclass(frozen=True)
class FormatSpec:
    key: str
    label: str
    group_count: int
    advancing_per_group: int
    phases: list[PhaseSpec] = field(default_factory=list)
    teams_per_group: Optional[int] = None  # None = unlimited

    @property
    def total_teams(self) -> Optional[int]:
        if self.teams_per_group is None:
            return None
        return self.group_count * self.teams_per_group

    def phase(self, key: str) -> Optional[PhaseSpec]:
        return next((p for p in self.phases if p.key == key), None)


STANDARD = FormatSpec(
    key="standard",
    label="8 Groups → Round of 16 → QF → SF → Final",
    group_count=8,
    advancing_per_group=2,
    teams_per_group=None,
    phases=[
        PhaseSpec(key="group_stage", label="Group Stage", order=0, is_group_stage=True),
        PhaseSpec(key="round_of_16", label="Round of 16", order=1, slots=8),
        PhaseSpec(key="quarter_final", label="Quarter Final", order=2, slots=4),
        PhaseSpec(key="semi_final", label="Semi Final", order=3, slots=2),
        PhaseSpec(key="final", label="Final", order=4, slots=1),
    ],
)


FOUR_GROUPS = FormatSpec(
    key="groups_4",
    label="4 Groups → Quarter Final → Semi Final → Final",
    group_count=4,
    advancing_per_group=2,
    teams_per_group=None,
    phases=[
        PhaseSpec(key="group_stage", label="Group Stage", order=0, is_group_stage=True),
        PhaseSpec(key="quarter_final", label="Quarter Final", order=1, slots=4),
        PhaseSpec(key="semi_final", label="Semi Final", order=2, slots=2),
        PhaseSpec(key="final", label="Final", order=3, slots=1),
    ],
)


TWO_GROUPS = FormatSpec(
    key="groups_2",
    label="2 Groups → Semi Final → Final",
    group_count=2,
    advancing_per_group=2,
    teams_per_group=None,
    phases=[
        PhaseSpec(key="group_stage", label="Group Stage", order=0, is_group_stage=True),
        PhaseSpec(key="semi_final", label="Semi Final", order=1, slots=2),
        PhaseSpec(key="final", label="Final", order=2, slots=1),
    ],
)


FORMATS: dict[str, FormatSpec] = {
    STANDARD.key: STANDARD,
    FOUR_GROUPS.key: FOUR_GROUPS,
    TWO_GROUPS.key: TWO_GROUPS,
}

DEFAULT_FORMAT_KEY = STANDARD.key


def get_format(key: str) -> Optional[FormatSpec]:
    return FORMATS.get(key)
