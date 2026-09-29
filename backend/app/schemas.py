"""Pydantic request and response models for the public REST contract."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as error:
        raise ValueError("Timezone IANA non valida") from error
    return value


def _uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as error:
        raise ValueError("Deve essere un UUID valido") from error


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("Il timestamp deve includere una timezone")
    return value.astimezone(UTC)


class ScheduleInput(APIModel):
    kind: Literal["daily", "weekdays", "times_per_week"]
    weekdays: list[int] = Field(default_factory=list)
    target_per_week: int = Field(default=1, ge=1, le=7)
    timezone: str = Field(min_length=1, max_length=64)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        return _timezone(value)

    @field_validator("weekdays")
    @classmethod
    def valid_weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 1 or day > 7 for day in value):
            raise ValueError("I giorni devono essere compresi tra 1 e 7")
        if len(set(value)) != len(value):
            raise ValueError("I giorni non possono essere duplicati")
        return sorted(value)

    @model_validator(mode="after")
    def coherent_frequency(self) -> ScheduleInput:
        if self.kind == "daily":
            if self.weekdays or self.target_per_week != 1:
                raise ValueError("La frequenza giornaliera non accetta giorni o target")
        elif self.kind == "weekdays":
            if not self.weekdays or self.target_per_week != 1:
                raise ValueError("I giorni specifici richiedono almeno un giorno e target 1")
        elif self.weekdays:
            raise ValueError("N volte a settimana non accetta giorni specifici")
        return self


class ScheduleOut(ScheduleInput):
    effective_from: date


class HabitCreate(APIModel):
    name: str = Field(min_length=1, max_length=80)
    goal: str = Field(default="", max_length=240)
    icon: str = Field(min_length=1, max_length=32)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    start_date: date
    schedule: ScheduleInput


class HabitUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    goal: str | None = Field(default=None, max_length=240)
    icon: str | None = Field(default=None, min_length=1, max_length=32)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    schedule: ScheduleInput | None = None

    @model_validator(mode="after")
    def has_a_change(self) -> HabitUpdate:
        if not self.model_fields_set:
            raise ValueError("Invia almeno una modifica")
        return self


class StatsOut(APIModel):
    current_streak: int = Field(ge=0)
    best_streak: int = Field(ge=0)
    streak_unit: Literal["sessions", "weeks"]
    completed: int = Field(ge=0)
    expected: int = Field(ge=0)
    completion_rate: float | None = Field(default=None, ge=0, le=100)
    total_checkins: int = Field(ge=0)
    week_completed: int = Field(ge=0)
    week_target: int = Field(ge=0)


class HabitOut(APIModel):
    id: str
    name: str
    goal: str
    icon: str
    color: str
    start_date: date
    status: Literal["active", "paused", "archived"]
    schedule: ScheduleOut
    pending_schedule: ScheduleOut | None = None
    today: date
    is_due: bool
    completed_today: bool
    note_today: str
    stats: StatsOut


class SettingsOut(APIModel):
    display_name: str
    timezone: str
    onboarding_completed: bool


class SettingsPatch(APIModel):
    display_name: str | None = Field(default=None, max_length=80)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    onboarding_completed: bool | None = None

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str | None) -> str | None:
        return _timezone(value) if value is not None else value

    @model_validator(mode="after")
    def has_a_change(self) -> SettingsPatch:
        if not self.model_fields_set:
            raise ValueError("Invia almeno una modifica")
        return self


class CheckinInput(APIModel):
    note: str = Field(default="", max_length=1000)


class CalendarPoint(APIModel):
    date: date
    completed: int = Field(ge=0)
    expected: int = Field(ge=0)


class AggregatePoint(APIModel):
    label: str
    completed: int = Field(ge=0)
    expected: int = Field(ge=0)


class AnalyticsOut(APIModel):
    from_date: date
    to_date: date
    completed: int = Field(ge=0)
    expected: int = Field(ge=0)
    completion_rate: float | None = Field(default=None, ge=0, le=100)
    total_checkins: int = Field(ge=0)
    active_habits: int = Field(ge=0)
    calendar: list[CalendarPoint]
    weekly: list[AggregatePoint]
    monthly: list[AggregatePoint]
    habits: list[HabitOut]


class ErrorBody(APIModel):
    code: str
    message: str
    details: list[dict[str, object]] = Field(default_factory=list)


class ErrorResponse(APIModel):
    error: ErrorBody


class BackupSettings(APIModel):
    display_name: str = Field(max_length=80)
    timezone: str = Field(min_length=1, max_length=64)
    onboarding_completed: bool

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        return _timezone(value)


class BackupHabit(APIModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    goal: str = Field(max_length=240)
    icon: str = Field(min_length=1, max_length=32)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    start_date: date
    status: Literal["active", "paused", "archived"]
    archived_on: date | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        return _uuid(value)

    @field_validator("created_at", "updated_at")
    @classmethod
    def aware_datetime(cls, value: datetime) -> datetime:
        return _aware_utc(value)


class BackupSchedule(ScheduleInput):
    id: str
    habit_id: str
    effective_from: date
    created_at: datetime

    @field_validator("id", "habit_id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        return _uuid(value)

    @field_validator("created_at")
    @classmethod
    def aware_datetime(cls, value: datetime) -> datetime:
        return _aware_utc(value)


class BackupPause(APIModel):
    id: str
    habit_id: str
    start_date: date
    end_date: date | None = None
    created_at: datetime

    @field_validator("id", "habit_id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        return _uuid(value)

    @field_validator("created_at")
    @classmethod
    def aware_datetime(cls, value: datetime) -> datetime:
        return _aware_utc(value)

    @model_validator(mode="after")
    def ordered_range(self) -> BackupPause:
        if self.end_date is not None and self.end_date <= self.start_date:
            raise ValueError("La fine della pausa deve seguire l'inizio")
        return self


class BackupCheckin(APIModel):
    id: str
    habit_id: str
    schedule_id: str
    occurrence_date: date
    completed_at: datetime
    timezone: str = Field(min_length=1, max_length=64)
    note: str = Field(max_length=1000)

    @field_validator("id", "habit_id", "schedule_id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        return _uuid(value)

    @field_validator("completed_at")
    @classmethod
    def aware_datetime(cls, value: datetime) -> datetime:
        return _aware_utc(value)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        return _timezone(value)


class BackupPayload(APIModel):
    format: Literal["habitflow-backup"]
    version: Literal[1]
    exported_at: datetime
    settings: BackupSettings
    habits: list[BackupHabit] = Field(default_factory=list)
    schedules: list[BackupSchedule] = Field(default_factory=list)
    pauses: list[BackupPause] = Field(default_factory=list)
    checkins: list[BackupCheckin] = Field(default_factory=list)

    @field_validator("exported_at")
    @classmethod
    def aware_datetime(cls, value: datetime) -> datetime:
        return _aware_utc(value)


class ImportResult(APIModel):
    imported: int = Field(ge=0)
    skipped: int = Field(ge=0)


class DemoResult(APIModel):
    created: int = Field(ge=0)


class HealthOut(APIModel):
    status: Literal["ok"]
