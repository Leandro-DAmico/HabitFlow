"""Application services: persistence orchestration around the pure domain rules."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal, cast
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import Select, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, selectinload

from app.domain import (
    Calendar,
    Pause,
    Schedule,
    calculate_stats,
    calendar_series,
    eligible,
    local_today,
    next_monday,
)
from app.errors import AppError, ConflictError, ForbiddenStateError, NotFoundError
from app.models import Checkin, Habit, PauseRecord, ScheduleRecord, SettingsRecord, new_id
from app.notifications import NotificationPort
from app.schemas import (
    AggregatePoint,
    AnalyticsOut,
    BackupCheckin,
    BackupHabit,
    BackupPause,
    BackupPayload,
    BackupSchedule,
    BackupSettings,
    CalendarPoint,
    CheckinInput,
    HabitCreate,
    HabitOut,
    HabitUpdate,
    ImportResult,
    ScheduleOut,
    SettingsOut,
    SettingsPatch,
    StatsOut,
)

_HABIT_LOAD_OPTIONS = (
    selectinload(Habit.schedules),
    selectinload(Habit.pauses),
    selectinload(Habit.checkins),
)


def _utc(value: datetime) -> datetime:
    """Normalize SQLite's potentially naive DATETIME values to UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _settings_out(record: SettingsRecord) -> SettingsOut:
    return SettingsOut(
        display_name=record.display_name,
        timezone=record.timezone,
        onboarding_completed=record.onboarding_completed,
    )


def _ensure_settings(session: Session, now: datetime) -> tuple[SettingsRecord, bool]:
    record = session.get(SettingsRecord, 1)
    if record is not None:
        return record, False
    record = SettingsRecord(
        id=1,
        display_name="",
        timezone="Europe/Rome",
        onboarding_completed=False,
        created_at=now,
        updated_at=now,
    )
    session.add(record)
    session.flush()
    return record, True


def get_settings(session: Session, now: datetime) -> SettingsOut:
    record, created = _ensure_settings(session, now)
    if created:
        session.commit()
    return _settings_out(record)


def update_settings(session: Session, payload: SettingsPatch, now: datetime) -> SettingsOut:
    record, _ = _ensure_settings(session, now)
    for field_name in ("display_name", "timezone", "onboarding_completed"):
        if field_name in payload.model_fields_set:
            value = getattr(payload, field_name)
            if value is None:
                raise AppError("invalid_settings", f"{field_name} non può essere nullo", 422)
            setattr(record, field_name, value)
    record.updated_at = now
    session.commit()
    return _settings_out(record)


def _habit_query() -> Select[tuple[Habit]]:
    return select(Habit).options(*_HABIT_LOAD_OPTIONS)


def get_habit(session: Session, habit_id: str) -> Habit:
    habit = session.scalar(_habit_query().where(Habit.id == habit_id))
    if habit is None:
        raise NotFoundError("Abitudine non trovata")
    return habit


def _domain_schedule(record: ScheduleRecord) -> Schedule:
    return Schedule(
        effective_from=record.effective_from,
        kind=record.kind,
        weekdays=tuple(record.weekdays),
        target_per_week=record.target_per_week,
        timezone=record.timezone,
    )


def _calendar(habit: Habit) -> Calendar:
    pauses = [Pause(start=item.start_date, end=item.end_date) for item in habit.pauses]
    # An archive is an inactive interval too. The explicit open pause written by
    # archive_habit normally covers it; this fallback also protects imported
    # historical archived records created by an older client.
    if habit.status == "archived" and habit.archived_on is not None:
        covered = any(
            pause.start <= habit.archived_on
            and (pause.end is None or habit.archived_on < pause.end)
            for pause in pauses
        )
        if not covered:
            pauses.append(Pause(start=habit.archived_on, end=None))
    return Calendar(
        start_date=habit.start_date,
        schedules=tuple(_domain_schedule(item) for item in habit.schedules),
        pauses=tuple(pauses),
        completions=frozenset(item.occurrence_date for item in habit.checkins),
    )


def _record_for_date(habit: Habit, civil_date: date) -> ScheduleRecord:
    matching = [item for item in habit.schedules if item.effective_from <= civil_date]
    if not matching:
        raise AppError("schedule_not_started", "Il piano non è ancora iniziato", 409)
    return max(matching, key=lambda item: item.effective_from)


def _record_for_now(habit: Habit, now: datetime) -> ScheduleRecord:
    if not habit.schedules:
        raise AppError("invalid_habit", "L'abitudine non ha un piano", 500)
    selected = habit.schedules[0]
    for record in habit.schedules:
        if record.effective_from <= local_today(now, record.timezone):
            selected = record
    return selected


def habit_today(habit: Habit, now: datetime) -> date:
    """Return the civil day that uses the same schedule revision as runtime.

    Revision dates belong to the *incoming* schedule's timezone. During a
    cross-date-line transition an old-zone day can already be Monday while the
    incoming zone is still before Monday. In that narrow interval clamp to the
    last date of the old revision; this preserves monotonic civil display even
    for the 26-hour Kiritimati-to-Honolulu edge.
    """
    selected = _record_for_now(habit, now)
    selected_day = local_today(now, selected.timezone)
    pending = next(
        (item for item in habit.schedules if item.effective_from > selected.effective_from),
        None,
    )
    if pending is not None and selected_day >= pending.effective_from:
        pending_day = local_today(now, pending.timezone)
        if pending_day < pending.effective_from:
            return pending.effective_from - timedelta(days=1)
    return selected_day


def _record_for_output(habit: Habit, civil_date: date) -> ScheduleRecord:
    try:
        return _record_for_date(habit, civil_date)
    except AppError:
        return habit.schedules[0]


def _reload_after_commit(session: Session, habit_id: str) -> Habit:
    session.expire_all()
    return get_habit(session, habit_id)


def _schedule_out(record: ScheduleRecord) -> ScheduleOut:
    return ScheduleOut(
        kind=cast(Literal["daily", "weekdays", "times_per_week"], record.kind),
        weekdays=list(record.weekdays),
        target_per_week=record.target_per_week,
        timezone=record.timezone,
        effective_from=record.effective_from,
    )


def habit_out(
    habit: Habit,
    now: datetime,
    from_date: date | None = None,
    to_date: date | None = None,
) -> HabitOut:
    """Serialize a habit with metrics calculated solely in the domain module."""
    today = habit_today(habit, now)
    calendar = _calendar(habit)
    current = _record_for_output(habit, today)
    pending = next(
        (item for item in habit.schedules if item.effective_from > current.effective_from), None
    )
    completed_today = next((item for item in habit.checkins if item.occurrence_date == today), None)
    stats = StatsOut.model_validate(calculate_stats(calendar, today, from_date, to_date))
    is_due = habit.status == "active" and eligible(calendar, today)
    if (
        current.kind == "times_per_week"
        and completed_today is None
        and stats.week_completed >= stats.week_target
    ):
        is_due = False
    return HabitOut(
        id=habit.id,
        name=habit.name,
        goal=habit.goal,
        icon=habit.icon,
        color=habit.color,
        start_date=habit.start_date,
        status=cast(Literal["active", "paused", "archived"], habit.status),
        schedule=_schedule_out(current),
        pending_schedule=_schedule_out(pending) if pending is not None else None,
        today=today,
        is_due=is_due,
        completed_today=completed_today is not None,
        note_today=completed_today.note if completed_today is not None else "",
        stats=stats,
    )


def list_habits(
    session: Session,
    now: datetime,
    status: str | None = None,
    query: str | None = None,
) -> list[HabitOut]:
    statement = _habit_query().order_by(Habit.created_at.desc())
    if status is not None and status != "all":
        statement = statement.where(Habit.status == status)
    if query:
        escaped = (
            query.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        if escaped:
            statement = statement.where(func.lower(Habit.name).like(f"%{escaped}%", escape="\\"))
    return [habit_out(item, now) for item in session.scalars(statement).unique().all()]


def create_habit(
    session: Session,
    payload: HabitCreate,
    now: datetime,
    notifications: NotificationPort,
) -> HabitOut:
    habit = Habit(
        name=payload.name,
        goal=payload.goal,
        icon=payload.icon,
        color=payload.color,
        start_date=payload.start_date,
        status="active",
        created_at=now,
        updated_at=now,
    )
    schedule = ScheduleRecord(
        habit=habit,
        kind=payload.schedule.kind,
        weekdays=payload.schedule.weekdays,
        target_per_week=payload.schedule.target_per_week,
        timezone=payload.schedule.timezone,
        effective_from=payload.start_date,
        created_at=now,
    )
    session.add_all([habit, schedule])
    session.commit()
    notifications.schedule_changed(habit.id, schedule.effective_from)
    return habit_out(_reload_after_commit(session, habit.id), now)


def update_habit(
    session: Session,
    habit_id: str,
    payload: HabitUpdate,
    now: datetime,
    notifications: NotificationPort,
) -> HabitOut:
    habit = get_habit(session, habit_id)
    for field_name in ("name", "goal", "icon", "color"):
        if field_name in payload.model_fields_set:
            value = getattr(payload, field_name)
            if value is None:
                raise AppError("invalid_habit", f"{field_name} non può essere nullo", 422)
            setattr(habit, field_name, value)

    if payload.schedule is not None:
        today = habit_today(habit, now)
        effective_from = max(habit.start_date, next_monday(today))
        pending = next(
            (item for item in habit.schedules if item.effective_from == effective_from), None
        )
        if pending is None:
            pending = ScheduleRecord(
                habit=habit,
                kind=payload.schedule.kind,
                weekdays=payload.schedule.weekdays,
                target_per_week=payload.schedule.target_per_week,
                timezone=payload.schedule.timezone,
                effective_from=effective_from,
                created_at=now,
            )
            session.add(pending)
        else:
            pending.kind = payload.schedule.kind
            pending.weekdays = payload.schedule.weekdays
            pending.target_per_week = payload.schedule.target_per_week
            pending.timezone = payload.schedule.timezone
        notifications.schedule_changed(habit.id, effective_from)

    habit.updated_at = now
    session.commit()
    return habit_out(_reload_after_commit(session, habit.id), now)


def _open_pauses(habit: Habit) -> list[PauseRecord]:
    return [item for item in habit.pauses if item.end_date is None]


def pause_habit(session: Session, habit_id: str, now: datetime) -> HabitOut:
    habit = get_habit(session, habit_id)
    if habit.status == "archived":
        raise ForbiddenStateError(
            "habit_archived", "Ripristina l'abitudine prima di metterla in pausa"
        )
    if habit.status != "paused":
        today = habit_today(habit, now)
        if not _open_pauses(habit):
            session.add(PauseRecord(habit=habit, start_date=today, end_date=None, created_at=now))
        habit.status = "paused"
        habit.updated_at = now
        session.commit()
    return habit_out(_reload_after_commit(session, habit.id), now)


def resume_habit(session: Session, habit_id: str, now: datetime) -> HabitOut:
    habit = get_habit(session, habit_id)
    if habit.status == "archived":
        raise ForbiddenStateError("habit_archived", "Ripristina l'abitudine prima di riprenderla")
    if habit.status == "paused":
        today = habit_today(habit, now)
        for pause in _open_pauses(habit):
            if pause.start_date == today:
                session.delete(pause)
            else:
                pause.end_date = today
        habit.status = "active"
        habit.updated_at = now
        session.commit()
    return habit_out(_reload_after_commit(session, habit.id), now)


def archive_habit(
    session: Session,
    habit_id: str,
    now: datetime,
    notifications: NotificationPort,
) -> HabitOut:
    habit = get_habit(session, habit_id)
    if habit.status != "archived":
        archived_on = habit_today(habit, now)
        habit.archived_on = archived_on
        if not _open_pauses(habit):
            session.add(
                PauseRecord(habit=habit, start_date=archived_on, end_date=None, created_at=now)
            )
        habit.status = "archived"
        habit.updated_at = now
        session.commit()
        notifications.habit_archived(habit.id)
    return habit_out(_reload_after_commit(session, habit.id), now)


def restore_habit(session: Session, habit_id: str, now: datetime) -> HabitOut:
    habit = get_habit(session, habit_id)
    if habit.status == "archived":
        today = habit_today(habit, now)
        archived_on = habit.archived_on
        # Restoring after days of archive turns that interval into an explicit,
        # non-punitive pause so it never becomes a retrospective failure.
        open_pauses = _open_pauses(habit)
        if open_pauses:
            for pause in open_pauses:
                if pause.start_date == today:
                    session.delete(pause)
                else:
                    pause.end_date = today
        elif archived_on is not None and archived_on < today:
            # Backward compatibility for archived imports that predate the
            # persisted archive pause introduced above.
            session.add(
                PauseRecord(
                    habit=habit,
                    start_date=archived_on,
                    end_date=today,
                    created_at=now,
                )
            )
        habit.status = "active"
        habit.archived_on = None
        habit.updated_at = now
        session.commit()
    return habit_out(_reload_after_commit(session, habit.id), now)


def delete_habit(session: Session, habit_id: str) -> None:
    habit = get_habit(session, habit_id)
    session.delete(habit)
    session.commit()


def put_checkin(
    session: Session,
    habit_id: str,
    occurrence_date: date,
    payload: CheckinInput,
    now: datetime,
) -> HabitOut:
    habit = get_habit(session, habit_id)
    if habit.status == "archived":
        raise ForbiddenStateError("habit_archived", "Le abitudini archiviate sono in sola lettura")
    today = habit_today(habit, now)
    if occurrence_date > today:
        raise AppError("future_date", "Non puoi completare una data futura", 422)
    calendar = _calendar(habit)
    if not eligible(calendar, occurrence_date):
        raise ForbiddenStateError(
            "checkin_not_eligible", "Questa data non è disponibile per l'abitudine"
        )
    schedule = _record_for_date(habit, occurrence_date)
    # SQLite's upsert makes repeated clicks and concurrent retries one logical
    # command. On conflict it only changes the note: the original id, timezone
    # and completion timestamp remain audit history.
    statement = sqlite_insert(Checkin).values(
        id=new_id(),
        habit_id=habit.id,
        schedule_id=schedule.id,
        occurrence_date=occurrence_date,
        completed_at=now,
        timezone=schedule.timezone,
        note=payload.note,
    )
    session.execute(
        statement.on_conflict_do_update(
            index_elements=[Checkin.habit_id, Checkin.occurrence_date],
            set_={"note": payload.note},
        )
    )
    session.commit()
    return habit_out(_reload_after_commit(session, habit.id), now)


def delete_checkin(session: Session, habit_id: str, occurrence_date: date) -> None:
    habit = get_habit(session, habit_id)
    if habit.status == "archived":
        raise ForbiddenStateError("habit_archived", "Le abitudini archiviate sono in sola lettura")
    checkin = session.scalar(
        select(Checkin).where(
            Checkin.habit_id == habit.id,
            Checkin.occurrence_date == occurrence_date,
        )
    )
    if checkin is not None:
        session.delete(checkin)
        session.commit()


def analytics(
    session: Session,
    now: datetime,
    days: int,
    habit_id: str | None = None,
) -> AnalyticsOut:
    settings, settings_created = _ensure_settings(session, now)
    end_date = local_today(now, settings.timezone)
    from_date = end_date - timedelta(days=days - 1)

    if habit_id is not None:
        habits = [get_habit(session, habit_id)]
    else:
        habits = list(
            session.scalars(_habit_query().order_by(Habit.created_at.desc())).unique().all()
        )

    calendar_by_day: dict[date, dict[str, int]] = {
        from_date + timedelta(days=index): {"completed": 0, "expected": 0} for index in range(days)
    }
    serialized_habits: list[HabitOut] = []
    completed = 0
    expected = 0
    total_checkins = 0

    for habit in habits:
        today = habit_today(habit, now)
        calendar = _calendar(habit)
        stats = StatsOut.model_validate(calculate_stats(calendar, today, from_date, end_date))
        completed += stats.completed
        expected += stats.expected
        total_checkins += stats.total_checkins
        serialized_habits.append(habit_out(habit, now, from_date, end_date))
        for point in calendar_series(calendar, today, from_date, end_date):
            point_date = date.fromisoformat(str(point["date"]))
            calendar_by_day[point_date]["completed"] += int(point["completed"])
            calendar_by_day[point_date]["expected"] += int(point["expected"])

    calendar_points = [
        CalendarPoint(date=point_date, **values)
        for point_date, values in sorted(calendar_by_day.items())
    ]
    weekly = _aggregate_periods(calendar_points, "week")
    monthly = _aggregate_periods(calendar_points, "month")
    if settings_created:
        session.commit()
    return AnalyticsOut(
        from_date=from_date,
        to_date=end_date,
        completed=completed,
        expected=expected,
        completion_rate=round((min(completed, expected) / expected) * 100, 1) if expected else None,
        total_checkins=total_checkins,
        active_habits=sum(item.status == "active" for item in habits),
        calendar=calendar_points,
        weekly=weekly,
        monthly=monthly,
        habits=serialized_habits,
    )


def _aggregate_periods(calendar_points: list[CalendarPoint], period: str) -> list[AggregatePoint]:
    aggregated: dict[str, dict[str, int]] = {}
    for point in calendar_points:
        point_date = point.date
        if period == "week":
            year, week, _ = point_date.isocalendar()
            label = f"{year}-W{week:02d}"
        else:
            label = f"{point_date.year}-{point_date.month:02d}"
        bucket = aggregated.setdefault(label, {"completed": 0, "expected": 0})
        bucket["completed"] += point.completed
        bucket["expected"] += point.expected
    return [AggregatePoint(label=label, **values) for label, values in aggregated.items()]


def export_backup(session: Session, now: datetime) -> BackupPayload:
    settings, created = _ensure_settings(session, now)
    habits = session.scalars(_habit_query().order_by(Habit.created_at)).unique().all()
    if created:
        session.commit()
    return BackupPayload(
        format="habitflow-backup",
        version=1,
        exported_at=now,
        settings=BackupSettings(
            display_name=settings.display_name,
            timezone=settings.timezone,
            onboarding_completed=settings.onboarding_completed,
        ),
        habits=[_backup_habit(item) for item in habits],
        schedules=[_backup_schedule(schedule) for item in habits for schedule in item.schedules],
        pauses=[_backup_pause(pause) for item in habits for pause in item.pauses],
        checkins=[_backup_checkin(checkin) for item in habits for checkin in item.checkins],
    )


def _backup_habit(item: Habit) -> BackupHabit:
    return BackupHabit(
        id=item.id,
        name=item.name,
        goal=item.goal,
        icon=item.icon,
        color=item.color,
        start_date=item.start_date,
        status=cast(Literal["active", "paused", "archived"], item.status),
        archived_on=item.archived_on,
        created_at=_utc(item.created_at),
        updated_at=_utc(item.updated_at),
    )


def _backup_schedule(item: ScheduleRecord) -> BackupSchedule:
    return BackupSchedule(
        id=item.id,
        habit_id=item.habit_id,
        kind=cast(Literal["daily", "weekdays", "times_per_week"], item.kind),
        weekdays=list(item.weekdays),
        target_per_week=item.target_per_week,
        timezone=item.timezone,
        effective_from=item.effective_from,
        created_at=_utc(item.created_at),
    )


def _backup_pause(item: PauseRecord) -> BackupPause:
    return BackupPause(
        id=item.id,
        habit_id=item.habit_id,
        start_date=item.start_date,
        end_date=item.end_date,
        created_at=_utc(item.created_at),
    )


def _backup_checkin(item: Checkin) -> BackupCheckin:
    return BackupCheckin(
        id=item.id,
        habit_id=item.habit_id,
        schedule_id=item.schedule_id,
        occurrence_date=item.occurrence_date,
        completed_at=_utc(item.completed_at),
        timezone=item.timezone,
        note=item.note,
    )


def _unique_ids(items: Iterable[Any], entity: str) -> None:
    seen: set[str] = set()
    for item in items:
        if item.id in seen:
            raise AppError("invalid_backup", f"UUID duplicato in {entity}", 422)
        seen.add(item.id)


def _assert_backup_size(payload: BackupPayload) -> None:
    maximum = 50_000
    total = (
        len(payload.habits) + len(payload.schedules) + len(payload.pauses) + len(payload.checkins)
    )
    if total > maximum:
        raise AppError("backup_too_large", "Il backup supera il limite di 50.000 record", 413)
    _unique_ids(payload.habits, "habits")
    _unique_ids(payload.schedules, "schedules")
    _unique_ids(payload.pauses, "pauses")
    _unique_ids(payload.checkins, "checkins")


def _import_conflict(entity: str, identifier: str) -> ConflictError:
    return ConflictError(
        "import_conflict",
        "Esiste già un record con lo stesso UUID ma dati diversi",
        [{"entity": entity, "id": identifier}],
    )


def _same_habit(record: Habit, incoming: BackupHabit) -> bool:
    return (
        record.name,
        record.goal,
        record.icon,
        record.color,
        record.start_date,
        record.status,
        record.archived_on,
        _utc(record.created_at),
        _utc(record.updated_at),
    ) == (
        incoming.name,
        incoming.goal,
        incoming.icon,
        incoming.color,
        incoming.start_date,
        incoming.status,
        incoming.archived_on,
        incoming.created_at,
        incoming.updated_at,
    )


def _same_schedule(record: ScheduleRecord, incoming: BackupSchedule) -> bool:
    return (
        record.habit_id,
        record.kind,
        list(record.weekdays),
        record.target_per_week,
        record.timezone,
        record.effective_from,
        _utc(record.created_at),
    ) == (
        incoming.habit_id,
        incoming.kind,
        incoming.weekdays,
        incoming.target_per_week,
        incoming.timezone,
        incoming.effective_from,
        incoming.created_at,
    )


def _same_pause(record: PauseRecord, incoming: BackupPause) -> bool:
    return (
        record.habit_id,
        record.start_date,
        record.end_date,
        _utc(record.created_at),
    ) == (incoming.habit_id, incoming.start_date, incoming.end_date, incoming.created_at)


def _same_checkin(record: Checkin, incoming: BackupCheckin) -> bool:
    return (
        record.habit_id,
        record.schedule_id,
        record.occurrence_date,
        _utc(record.completed_at),
        record.timezone,
        record.note,
    ) == (
        incoming.habit_id,
        incoming.schedule_id,
        incoming.occurrence_date,
        incoming.completed_at,
        incoming.timezone,
        incoming.note,
    )


def _same_settings(record: SettingsRecord, incoming: BackupSettings) -> bool:
    return (
        record.display_name,
        record.timezone,
        record.onboarding_completed,
    ) == (
        incoming.display_name,
        incoming.timezone,
        incoming.onboarding_completed,
    )


def _is_default_settings(record: SettingsRecord) -> bool:
    return (
        record.display_name == ""
        and record.timezone == "Europe/Rome"
        and not record.onboarding_completed
    )


def _backup_validation_error(
    message: str, details: list[dict[str, object]] | None = None
) -> AppError:
    return AppError("invalid_backup", message, 422, details or [])


def import_backup(session: Session, payload: BackupPayload, now: datetime) -> ImportResult:
    """Merge a versioned backup atomically, rejecting all ambiguous records."""
    _assert_backup_size(payload)
    imported = 0
    skipped = 0

    # This service is the request's first database operation. Keeping all
    # validation and inserts within one begin block guarantees no partial merge.
    with session.begin():
        incoming_habits = {item.id: item for item in payload.habits}
        incoming_schedules = {item.id: item for item in payload.schedules}
        incoming_pauses = {item.id: item for item in payload.pauses}
        incoming_checkins = {item.id: item for item in payload.checkins}
        related_habit_ids = (
            set(incoming_habits)
            | {item.habit_id for item in payload.schedules}
            | {item.habit_id for item in payload.pauses}
            | {item.habit_id for item in payload.checkins}
        )

        existing_habits = {
            item.id: item
            for item in session.scalars(select(Habit).where(Habit.id.in_(incoming_habits))).all()
        }
        existing_schedules = {
            item.id: item
            for item in session.scalars(
                select(ScheduleRecord).where(ScheduleRecord.id.in_(incoming_schedules))
            ).all()
        }
        existing_pauses = {
            item.id: item
            for item in session.scalars(
                select(PauseRecord).where(PauseRecord.id.in_(incoming_pauses))
            ).all()
        }
        existing_checkins = {
            item.id: item
            for item in session.scalars(
                select(Checkin).where(Checkin.id.in_(incoming_checkins))
            ).all()
        }

        for habit_identifier, incoming_habit in incoming_habits.items():
            existing_habit = existing_habits.get(habit_identifier)
            if existing_habit is not None and not _same_habit(existing_habit, incoming_habit):
                raise _import_conflict("habit", habit_identifier)
        for schedule_identifier, incoming_schedule in incoming_schedules.items():
            existing_schedule = existing_schedules.get(schedule_identifier)
            if existing_schedule is not None and not _same_schedule(
                existing_schedule, incoming_schedule
            ):
                raise _import_conflict("schedule", schedule_identifier)
        for pause_identifier, incoming_pause in incoming_pauses.items():
            existing_pause = existing_pauses.get(pause_identifier)
            if existing_pause is not None and not _same_pause(existing_pause, incoming_pause):
                raise _import_conflict("pause", pause_identifier)
        for checkin_identifier, incoming_checkin in incoming_checkins.items():
            existing_checkin = existing_checkins.get(checkin_identifier)
            if existing_checkin is not None and not _same_checkin(
                existing_checkin, incoming_checkin
            ):
                raise _import_conflict("checkin", checkin_identifier)

        all_existing_habits = {
            item.id: item
            for item in session.scalars(select(Habit).where(Habit.id.in_(related_habit_ids))).all()
        }
        habit_starts: dict[str, date] = {
            identifier: item.start_date for identifier, item in all_existing_habits.items()
        }
        habit_starts.update(
            {identifier: item.start_date for identifier, item in incoming_habits.items()}
        )
        missing_habit_references = related_habit_ids - set(habit_starts)
        if missing_habit_references:
            raise _backup_validation_error(
                "Il backup contiene un riferimento a un'abitudine assente",
                [{"habit_id": next(iter(missing_habit_references))}],
            )

        for imported_habit in payload.habits:
            if imported_habit.status == "archived" and imported_habit.archived_on is None:
                raise _backup_validation_error("Un'abitudine archiviata richiede archived_on")
            if imported_habit.status != "archived" and imported_habit.archived_on is not None:
                raise _backup_validation_error(
                    "archived_on è ammesso solo per abitudini archiviate"
                )

        all_schedule_records = session.scalars(
            select(ScheduleRecord).where(ScheduleRecord.habit_id.in_(related_habit_ids))
        ).all()
        schedule_views: dict[str, BackupSchedule] = {
            item.id: _backup_schedule(item) for item in all_schedule_records
        }
        schedule_views.update(incoming_schedules)
        schedules_by_habit: dict[str, list[BackupSchedule]] = defaultdict(list)
        for schedule_item in schedule_views.values():
            if schedule_item.habit_id not in habit_starts:
                raise _backup_validation_error("Un piano fa riferimento a un'abitudine assente")
            if schedule_item.effective_from < habit_starts[schedule_item.habit_id]:
                raise _backup_validation_error("Un piano non può precedere l'inizio dell'abitudine")
            schedules_by_habit[schedule_item.habit_id].append(schedule_item)

        for scheduled_habit_id, schedule_items in schedules_by_habit.items():
            schedule_items.sort(key=lambda item: item.effective_from)
            seen_effective: set[date] = set()
            for index, revision in enumerate(schedule_items):
                if revision.effective_from in seen_effective:
                    raise _backup_validation_error(
                        "Esistono revisioni con la stessa data di efficacia"
                    )
                seen_effective.add(revision.effective_from)
                if index > 0 and revision.effective_from.weekday() != 0:
                    raise _backup_validation_error(
                        "Le revisioni successive devono iniziare di lunedì",
                        [{"habit_id": scheduled_habit_id, "schedule_id": revision.id}],
                    )
        for habit_id in incoming_habits:
            if not schedules_by_habit.get(habit_id):
                raise _backup_validation_error(
                    "Ogni abitudine importata deve avere almeno un piano"
                )

        for imported_pause in payload.pauses:
            if imported_pause.habit_id not in habit_starts:
                raise _backup_validation_error("Una pausa fa riferimento a un'abitudine assente")
            if imported_pause.start_date < habit_starts[imported_pause.habit_id]:
                raise _backup_validation_error(
                    "Una pausa non può precedere l'inizio dell'abitudine"
                )

        existing_for_pairs = session.scalars(
            select(Checkin).where(Checkin.habit_id.in_(related_habit_ids))
        ).all()
        checkin_pairs: dict[tuple[str, date], str] = {
            (item.habit_id, item.occurrence_date): item.id for item in existing_for_pairs
        }
        incoming_pairs: set[tuple[str, date]] = set()
        for imported_checkin in payload.checkins:
            pair = (imported_checkin.habit_id, imported_checkin.occurrence_date)
            if pair in incoming_pairs:
                raise _backup_validation_error(
                    "Il backup contiene due completamenti per la stessa data"
                )
            incoming_pairs.add(pair)
            existing_pair_id = checkin_pairs.get(pair)
            if existing_pair_id is not None and existing_pair_id != imported_checkin.id:
                raise _import_conflict("checkin", imported_checkin.id)

            resolved_schedule = schedule_views.get(imported_checkin.schedule_id)
            if resolved_schedule is None or resolved_schedule.habit_id != imported_checkin.habit_id:
                raise _backup_validation_error(
                    "Un completamento fa riferimento a un piano non valido"
                )
            if imported_checkin.timezone != resolved_schedule.timezone:
                raise _backup_validation_error(
                    "La timezone del completamento non coincide con il suo piano"
                )
            if imported_checkin.occurrence_date < habit_starts[imported_checkin.habit_id]:
                raise _backup_validation_error("Un completamento precede l'inizio dell'abitudine")
            active_schedule = max(
                (
                    item
                    for item in schedules_by_habit[imported_checkin.habit_id]
                    if item.effective_from <= imported_checkin.occurrence_date
                ),
                key=lambda item: item.effective_from,
                default=None,
            )
            if active_schedule is None or active_schedule.id != imported_checkin.schedule_id:
                raise _backup_validation_error(
                    "Il completamento non usa la revisione attiva per quella data"
                )

        # Validate every imported completion against its complete imported/local
        # calendar. This catches non-scheduled days while retaining the documented
        # completed-day override for pauses.
        all_pause_records = session.scalars(
            select(PauseRecord).where(PauseRecord.habit_id.in_(related_habit_ids))
        ).all()
        pauses_by_habit: dict[str, list[BackupPause]] = defaultdict(list)
        for persisted_pause in all_pause_records:
            pauses_by_habit[persisted_pause.habit_id].append(_backup_pause(persisted_pause))
        for imported_pause in payload.pauses:
            pauses_by_habit[imported_pause.habit_id] = [
                item
                for item in pauses_by_habit[imported_pause.habit_id]
                if item.id != imported_pause.id
            ]
            pauses_by_habit[imported_pause.habit_id].append(imported_pause)
        # A lifecycle flag without its interval would silently create expected
        # days during a pause. Validate the merged graph, not only incoming rows.
        lifecycle_habits = {
            identifier: _backup_habit(record) for identifier, record in all_existing_habits.items()
        }
        lifecycle_habits.update(incoming_habits)
        for identifier, lifecycle_habit in lifecycle_habits.items():
            intervals = sorted(pauses_by_habit[identifier], key=lambda item: item.start_date)
            open_intervals = [item for item in intervals if item.end_date is None]
            if lifecycle_habit.status in {"paused", "archived"} and len(open_intervals) != 1:
                raise _backup_validation_error(
                    "Un'abitudine in pausa o archiviata richiede una pausa aperta"
                )
            if lifecycle_habit.status == "active" and open_intervals:
                raise _backup_validation_error("Un'abitudine attiva non può avere una pausa aperta")
            for previous, following in zip(intervals, intervals[1:], strict=False):
                if previous.end_date is None or following.start_date < previous.end_date:
                    raise _backup_validation_error(
                        "Gli intervalli di pausa non possono sovrapporsi"
                    )
        checkin_dates_by_habit: dict[str, set[date]] = defaultdict(set)
        for persisted_checkin in existing_for_pairs:
            checkin_dates_by_habit[persisted_checkin.habit_id].add(
                persisted_checkin.occurrence_date
            )
        for imported_checkin in payload.checkins:
            checkin_dates_by_habit[imported_checkin.habit_id].add(imported_checkin.occurrence_date)
        for imported_checkin in payload.checkins:
            calendar = Calendar(
                start_date=habit_starts[imported_checkin.habit_id],
                schedules=tuple(
                    Schedule(
                        effective_from=item.effective_from,
                        kind=item.kind,
                        weekdays=tuple(item.weekdays),
                        target_per_week=item.target_per_week,
                        timezone=item.timezone,
                    )
                    for item in schedules_by_habit[imported_checkin.habit_id]
                ),
                pauses=tuple(
                    Pause(start=item.start_date, end=item.end_date)
                    for item in pauses_by_habit[imported_checkin.habit_id]
                ),
                completions=frozenset(checkin_dates_by_habit[imported_checkin.habit_id]),
            )
            if not eligible(calendar, imported_checkin.occurrence_date):
                raise _backup_validation_error("Il completamento non è eleggibile per il suo piano")

        settings = session.get(SettingsRecord, 1)
        if settings is None:
            session.add(
                SettingsRecord(
                    id=1,
                    display_name=payload.settings.display_name,
                    timezone=payload.settings.timezone,
                    onboarding_completed=payload.settings.onboarding_completed,
                    created_at=now,
                    updated_at=now,
                )
            )
            imported += 1
        elif _same_settings(settings, payload.settings):
            skipped += 1
        elif _is_default_settings(settings):
            settings.display_name = payload.settings.display_name
            settings.timezone = payload.settings.timezone
            settings.onboarding_completed = payload.settings.onboarding_completed
            settings.updated_at = now
            imported += 1
        else:
            raise _import_conflict("settings", "1")

        for imported_habit in payload.habits:
            if imported_habit.id in existing_habits:
                skipped += 1
                continue
            session.add(
                Habit(
                    id=imported_habit.id,
                    name=imported_habit.name,
                    goal=imported_habit.goal,
                    icon=imported_habit.icon,
                    color=imported_habit.color,
                    start_date=imported_habit.start_date,
                    status=imported_habit.status,
                    archived_on=imported_habit.archived_on,
                    created_at=imported_habit.created_at,
                    updated_at=imported_habit.updated_at,
                )
            )
            imported += 1
        for imported_schedule in payload.schedules:
            if imported_schedule.id in existing_schedules:
                skipped += 1
                continue
            session.add(
                ScheduleRecord(
                    id=imported_schedule.id,
                    habit_id=imported_schedule.habit_id,
                    kind=imported_schedule.kind,
                    weekdays=imported_schedule.weekdays,
                    target_per_week=imported_schedule.target_per_week,
                    timezone=imported_schedule.timezone,
                    effective_from=imported_schedule.effective_from,
                    created_at=imported_schedule.created_at,
                )
            )
            imported += 1
        for imported_pause in payload.pauses:
            if imported_pause.id in existing_pauses:
                skipped += 1
                continue
            session.add(
                PauseRecord(
                    id=imported_pause.id,
                    habit_id=imported_pause.habit_id,
                    start_date=imported_pause.start_date,
                    end_date=imported_pause.end_date,
                    created_at=imported_pause.created_at,
                )
            )
            imported += 1
        for imported_checkin in payload.checkins:
            if imported_checkin.id in existing_checkins:
                skipped += 1
                continue
            session.add(
                Checkin(
                    id=imported_checkin.id,
                    habit_id=imported_checkin.habit_id,
                    schedule_id=imported_checkin.schedule_id,
                    occurrence_date=imported_checkin.occurrence_date,
                    completed_at=imported_checkin.completed_at,
                    timezone=imported_checkin.timezone,
                    note=imported_checkin.note,
                )
            )
            imported += 1

    return ImportResult(imported=imported, skipped=skipped)


_DEMO_NAMESPACE = "https://habitflow.local/demo/"


@dataclass(frozen=True, slots=True)
class _DemoTemplate:
    key: str
    name: str
    goal: str
    icon: str
    color: str
    start: date
    kind: Literal["daily", "weekdays", "times_per_week"]
    weekdays: tuple[int, ...]
    target: int
    completed_offsets: tuple[int, ...]


def _demo_id(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"{_DEMO_NAMESPACE}{name}"))


def seed_demo(session: Session, now: datetime, notifications: NotificationPort) -> int:
    """Create a small additive demo dataset without touching user records.

    IDs are deterministic. A second call sees the same habits and returns zero;
    it never overwrites notes, plans, settings, or any user-created item.
    """
    today = local_today(now, "Europe/Rome")
    templates = (
        _DemoTemplate(
            key="walk",
            name="Camminata consapevole",
            goal="Dieci minuti all'aria aperta, senza recuperare i giorni saltati.",
            icon="🌿",
            color="#4F7A5C",
            start=today - timedelta(days=35),
            kind="daily",
            weekdays=(),
            target=1,
            completed_offsets=(-8, -7, -6, -4, -3, -2, 0),
        ),
        _DemoTemplate(
            key="focus",
            name="Blocco di concentrazione",
            goal="Un blocco breve nei giorni scelti.",
            icon="◐",
            color="#64748B",
            start=today - timedelta(days=42),
            kind="weekdays",
            weekdays=(1, 3, 5),
            target=1,
            completed_offsets=(),
        ),
        _DemoTemplate(
            key="read",
            name="Leggere per piacere",
            goal="Tre momenti alla settimana, con flessibilità.",
            icon="◌",
            color="#A35F45",
            start=today - timedelta(days=56),
            kind="times_per_week",
            weekdays=(),
            target=3,
            completed_offsets=(-15, -13, -11, -8, -6, -5, -3, -1),
        ),
    )
    created = 0
    for template in templates:
        habit_id = _demo_id(f"habit/{template.key}")
        if session.get(Habit, habit_id) is not None:
            continue
        schedule_id = _demo_id(f"schedule/{template.key}/1")
        habit = Habit(
            id=habit_id,
            name=template.name,
            goal=template.goal,
            icon=template.icon,
            color=template.color,
            start_date=template.start,
            status="active",
            created_at=now,
            updated_at=now,
        )
        schedule = ScheduleRecord(
            id=schedule_id,
            habit=habit,
            kind=template.kind,
            weekdays=list(template.weekdays),
            target_per_week=template.target,
            timezone="Europe/Rome",
            effective_from=template.start,
            created_at=now,
        )
        offsets = list(template.completed_offsets)
        if template.key == "focus":
            offsets = [
                -offset
                for offset in range(1, 22)
                if (today - timedelta(days=offset)).isoweekday() in {1, 3, 5}
            ][:7]
        session.add_all([habit, schedule])
        for offset in offsets:
            occurrence = today + timedelta(days=int(offset))
            session.add(
                Checkin(
                    id=_demo_id(f"checkin/{template.key}/{occurrence.isoformat()}"),
                    habit=habit,
                    schedule_id=schedule_id,
                    occurrence_date=occurrence,
                    completed_at=now,
                    timezone="Europe/Rome",
                    note="Dataset demo locale",
                )
            )
        created += 1
        notifications.schedule_changed(habit_id, schedule.effective_from)
    if created:
        session.commit()
    return created
