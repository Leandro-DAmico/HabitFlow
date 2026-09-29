"""Persistence model. Dates used for habit history are civil DATE values."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class SettingsRecord(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    display_name: Mapped[str] = mapped_column(String(80), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Rome")
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class Habit(Base):
    __tablename__ = "habits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))
    goal: Mapped[str] = mapped_column(String(240))
    icon: Mapped[str] = mapped_column(String(32))
    color: Mapped[str] = mapped_column(String(7))
    start_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    archived_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    schedules: Mapped[list[ScheduleRecord]] = relationship(
        back_populates="habit",
        cascade="all, delete-orphan",
        order_by="ScheduleRecord.effective_from",
    )
    pauses: Mapped[list[PauseRecord]] = relationship(
        back_populates="habit", cascade="all, delete-orphan", order_by="PauseRecord.start_date"
    )
    checkins: Mapped[list[Checkin]] = relationship(
        back_populates="habit", cascade="all, delete-orphan", order_by="Checkin.occurrence_date"
    )


class ScheduleRecord(Base):
    __tablename__ = "schedules"
    __table_args__ = (UniqueConstraint("habit_id", "effective_from", name="uq_schedule_effective"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    habit_id: Mapped[str] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    weekdays: Mapped[list[int]] = mapped_column(JSON, default=list)
    target_per_week: Mapped[int] = mapped_column(Integer, default=1)
    timezone: Mapped[str] = mapped_column(String(64))
    effective_from: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    habit: Mapped[Habit] = relationship(back_populates="schedules")
    checkins: Mapped[list[Checkin]] = relationship(back_populates="schedule")


class PauseRecord(Base):
    __tablename__ = "pauses"
    __table_args__ = (
        CheckConstraint("end_date IS NULL OR end_date > start_date", name="ck_pause_range"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    habit_id: Mapped[str] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    habit: Mapped[Habit] = relationship(back_populates="pauses")


class Checkin(Base):
    __tablename__ = "checkins"
    __table_args__ = (
        UniqueConstraint("habit_id", "occurrence_date", name="uq_checkin_habit_date"),
        Index("ix_checkins_habit_date", "habit_id", "occurrence_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    habit_id: Mapped[str] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    schedule_id: Mapped[str] = mapped_column(ForeignKey("schedules.id", ondelete="RESTRICT"))
    occurrence_date: Mapped[date] = mapped_column(Date)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    timezone: Mapped[str] = mapped_column(String(64))
    note: Mapped[str] = mapped_column(Text, default="")

    habit: Mapped[Habit] = relationship(back_populates="checkins")
    schedule: Mapped[ScheduleRecord] = relationship(back_populates="checkins")
