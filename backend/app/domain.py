"""Pure calendar and adherence rules for HabitFlow.

This module deliberately has no framework or persistence imports.  It works on
``date`` values rather than timestamps: an occurrence keeps the civil date on
which it was intended, while :func:`local_today` is the single boundary where a
clock is converted through an IANA timezone.

``Calendar`` is a projection of one habit's immutable schedule revisions,
pause intervals and check-ins.  Schedule revisions are expected to be created
for :func:`next_monday`; the resolver still handles any ordered effective dates
defensively.  A check-in made before a pause starts on the same civil date stays
valid: it is an eligible completed occurrence, not erased by a later lifecycle
action.

The ``expected`` value in :func:`calendar_series` is *daily capacity*, not a
distributed weekly target.  Therefore a ``times_per_week`` habit reports one
available capacity unit on every active day; the weekly target is applied only
by :func:`calculate_stats` and the streak algorithm.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

__all__ = [
    "Calendar",
    "Pause",
    "Schedule",
    "calendar_series",
    "calculate_stats",
    "eligible",
    "local_today",
    "next_monday",
    "schedule_at",
]


_ONE_DAY = timedelta(days=1)
_ONE_WEEK = timedelta(days=7)
_SESSION_KINDS = frozenset({"daily", "weekdays"})
_WEEKLY_KIND = "times_per_week"
_VALID_KINDS = _SESSION_KINDS | {_WEEKLY_KIND}


@dataclass(frozen=True, slots=True)
class Schedule:
    """An immutable frequency and timezone revision for a habit.

    ``weekdays`` contains ISO weekday numbers (Monday=1 through Sunday=7).
    For a daily schedule it is empty; for a weekly-target schedule it is also
    empty and ``target_per_week`` is in the inclusive range 1..7.
    """

    effective_from: date
    kind: str
    weekdays: tuple[int, ...]
    target_per_week: int
    timezone: str


@dataclass(frozen=True, slots=True)
class Pause:
    """An inactivity interval with an inclusive start and exclusive end."""

    start: date
    end: date | None


@dataclass(frozen=True, slots=True)
class Calendar:
    """The domain data needed to calculate one habit's calendar metrics."""

    start_date: date
    schedules: tuple[Schedule, ...]
    pauses: tuple[Pause, ...]
    completions: frozenset[date]


def local_today(now: datetime, timezone: str) -> date:
    """Return today's civil date in ``timezone`` from an aware instant.

    A naive datetime is rejected rather than silently being interpreted in the
    machine timezone.  This makes DST and local-development behaviour
    deterministic.
    """

    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(_zone(timezone)).date()


def next_monday(day: date) -> date:
    """Return the strictly next ISO Monday (including when ``day`` is Monday)."""

    return day + timedelta(days=7 - day.weekday())


def schedule_at(calendar: Calendar, day: date) -> Schedule:
    """Resolve the latest schedule revision in effect on ``day``.

    A date earlier than the first revision has no plan and is rejected.  Public
    consumers that merely need a boolean should use :func:`eligible`, which
    returns ``False`` for that case.
    """

    schedules = _validated_schedules(calendar)
    current: Schedule | None = None
    for schedule in schedules:
        if schedule.effective_from > day:
            break
        current = schedule
    if current is None:
        raise ValueError("no schedule is effective on this date")
    return current


def eligible(calendar: Calendar, day: date) -> bool:
    """Whether ``day`` is an available/valid occurrence in this calendar.

    A completion can keep a due occurrence valid when a pause was started on
    that same date afterwards.  It never turns a date before the habit start or
    an intrinsically non-scheduled weekday into an occurrence.
    """

    _validate_calendar_shape(calendar)
    if day < calendar.start_date:
        return False

    try:
        schedule = schedule_at(calendar, day)
    except ValueError:
        return False

    if not _is_scheduled_day(schedule, day):
        return False
    if day in calendar.completions:
        return True
    return not _is_paused(calendar, day)


def calendar_series(
    calendar: Calendar,
    today: date,
    from_date: date,
    to_date: date,
) -> list[dict[str, Any]]:
    """Return an inclusive, date-ordered heatmap series.

    ``expected`` means one available daily capacity unit.  In particular it is
    ``1`` for every active day of a ``times_per_week`` plan, rather than an
    artificial fraction of its weekly target.  Future dates are returned for a
    stable caller-facing shape but have ``completed=expected=0``: the domain
    never treats a future slot as due.
    """

    _validate_calendar_shape(calendar)
    _validate_range(from_date, to_date)

    result: list[dict[str, Any]] = []
    for day in _days(from_date, to_date):
        if day > today:
            result.append({"date": day.isoformat(), "completed": 0, "expected": 0})
            continue

        is_eligible = eligible(calendar, day)
        is_completed = is_eligible and day in calendar.completions
        result.append(
            {
                "date": day.isoformat(),
                "completed": int(is_completed),
                "expected": int(is_eligible),
            }
        )
    return result


def calculate_stats(
    calendar: Calendar,
    today: date,
    from_date: date | None = None,
    to_date: date | None = None,
) -> dict[str, Any]:
    """Calculate the API ``Stats`` object for a calendar projection.

    The selected period defaults to the habit's full history through ``today``.
    Its completion rate only includes finalized units: a session on ``today``
    and the whole current ISO week for a weekly-target schedule are in progress,
    never failures.  ``total_checkins`` is the raw valid check-in count in the
    selected period (including in-progress units); ``completed`` is capped to
    finalized expected units for the rate.

    Streaks always use all history through ``today`` and are limited to the
    current cadence-family segment.  Daily and weekday schedules use
    ``sessions``; ``times_per_week`` uses successful ISO ``weeks``.
    """

    _validate_calendar_shape(calendar)
    period_start = calendar.start_date if from_date is None else from_date
    requested_end = today if to_date is None else to_date
    # A habit can legitimately start in the future.  That is an empty history,
    # not an invalid requested range.  Only an explicitly inverted range is a
    # caller error.
    if from_date is not None and to_date is not None:
        _validate_range(from_date, to_date)
    period_end = min(requested_end, today)

    completed = 0
    expected = 0
    total_checkins = 0

    if period_start <= period_end:
        for day in _days(period_start, period_end):
            schedule = _schedule_or_none(calendar, day)
            if schedule is None or not eligible(calendar, day):
                continue

            is_completed = day in calendar.completions
            if is_completed:
                total_checkins += 1

            if _family(schedule) == "sessions":
                # A civil day is open until the next local date is reached.
                if day < today:
                    expected += 1
                    completed += int(is_completed)
                continue

    weekly_expected, weekly_completed = _finalized_weekly_period_stats(
        calendar, today, period_start, period_end
    )
    expected += weekly_expected
    completed += weekly_completed

    current_schedule = _schedule_or_none(calendar, today)
    if current_schedule is None:
        # A future-start habit still has a useful unit label but no progress.
        schedules = _validated_schedules(calendar)
        current_schedule = schedules[0] if schedules else None

    if current_schedule is None:
        streak_unit = "sessions"
        current_streak = 0
        best_streak = 0
        week_completed = 0
        week_target = 0
    else:
        streak_unit = _family(current_schedule)
        segment_start = _segment_start(calendar, today, streak_unit)
        if streak_unit == "sessions":
            current_streak, best_streak = _session_streaks(calendar, today, segment_start)
        else:
            current_streak, best_streak = _weekly_streaks(calendar, today, segment_start)
        week_completed, week_target = _current_week_progress(
            calendar, today, current_schedule, streak_unit
        )

    completion_rate = round((completed / expected) * 100, 1) if expected else None
    return {
        "current_streak": current_streak,
        "best_streak": best_streak,
        "streak_unit": streak_unit,
        "completed": completed,
        "expected": expected,
        "completion_rate": completion_rate,
        "total_checkins": total_checkins,
        "week_completed": week_completed,
        "week_target": week_target,
    }


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"unknown IANA timezone: {name}") from exc


def _validated_schedules(calendar: Calendar) -> tuple[Schedule, ...]:
    schedules = tuple(sorted(calendar.schedules, key=lambda item: item.effective_from))
    previous: date | None = None
    for schedule in schedules:
        if previous == schedule.effective_from:
            raise ValueError("schedule revisions must have distinct effective_from dates")
        previous = schedule.effective_from
        _validate_schedule(schedule)
    return schedules


def _validate_schedule(schedule: Schedule) -> None:
    if schedule.kind not in _VALID_KINDS:
        raise ValueError(f"unsupported schedule kind: {schedule.kind}")
    _zone(schedule.timezone)

    weekdays = schedule.weekdays
    if any(day < 1 or day > 7 for day in weekdays):
        raise ValueError("weekdays must use ISO values from 1 through 7")
    if len(set(weekdays)) != len(weekdays):
        raise ValueError("weekdays must not contain duplicates")

    if schedule.kind == "weekdays" and not weekdays:
        raise ValueError("a weekday schedule needs at least one weekday")
    if schedule.kind != "weekdays" and weekdays:
        raise ValueError("only weekday schedules may define weekdays")

    if schedule.kind == _WEEKLY_KIND:
        if not 1 <= schedule.target_per_week <= 7:
            raise ValueError("target_per_week must be between 1 and 7")
    elif schedule.target_per_week != 1:
        raise ValueError("non-weekly schedules must use target_per_week=1")


def _validate_calendar_shape(calendar: Calendar) -> None:
    _validated_schedules(calendar)
    for pause in calendar.pauses:
        if pause.end is not None and pause.end <= pause.start:
            raise ValueError("a pause end must be after its start")


def _validate_range(from_date: date, to_date: date) -> None:
    if from_date > to_date:
        raise ValueError("from_date must not be after to_date")


def _schedule_or_none(calendar: Calendar, day: date) -> Schedule | None:
    if day < calendar.start_date:
        return None
    try:
        return schedule_at(calendar, day)
    except ValueError:
        return None


def _is_scheduled_day(schedule: Schedule, day: date) -> bool:
    if schedule.kind == "daily" or schedule.kind == _WEEKLY_KIND:
        return True
    return day.isoweekday() in schedule.weekdays


def _is_paused(calendar: Calendar, day: date) -> bool:
    return any(
        pause.start <= day and (pause.end is None or day < pause.end) for pause in calendar.pauses
    )


def _family(schedule: Schedule) -> str:
    return "weeks" if schedule.kind == _WEEKLY_KIND else "sessions"


def _segment_start(calendar: Calendar, today: date, family: str) -> date:
    """Find the start of the current sessions/weeks cadence-family segment."""

    schedules = tuple(
        schedule for schedule in _validated_schedules(calendar) if schedule.effective_from <= today
    )
    if not schedules:
        return calendar.start_date

    # The last schedule is the current one.  Scan back to the closest revision
    # in another family; daily <-> weekdays deliberately remain one segment.
    for index in range(len(schedules) - 1, -1, -1):
        if _family(schedules[index]) != family:
            return max(calendar.start_date, schedules[index + 1].effective_from)
    return calendar.start_date


def _session_streaks(calendar: Calendar, today: date, segment_start: date) -> tuple[int, int]:
    current = 0
    for day in _days_reverse(segment_start, today):
        schedule = _schedule_or_none(calendar, day)
        if schedule is None or _family(schedule) != "sessions" or not eligible(calendar, day):
            continue
        if day == today and day not in calendar.completions:
            # The local day is still in progress, not a broken streak.
            continue
        if day in calendar.completions:
            current += 1
            continue
        break

    running = 0
    best = 0
    for day in _days(segment_start, today):
        schedule = _schedule_or_none(calendar, day)
        if schedule is None or _family(schedule) != "sessions" or not eligible(calendar, day):
            continue
        if day == today and day not in calendar.completions:
            continue
        if day in calendar.completions:
            running += 1
            best = max(best, running)
        else:
            running = 0
    return current, best


def _weekly_streaks(calendar: Calendar, today: date, segment_start: date) -> tuple[int, int]:
    first_week = _monday(max(calendar.start_date, segment_start))
    current_week = _monday(today)
    if first_week > current_week:
        return 0, 0

    buckets = [
        _weekly_bucket(calendar, week_start, today, segment_start)
        for week_start in _weeks(first_week, current_week)
    ]

    current = 0
    for bucket in reversed(buckets):
        if bucket.target == 0:
            continue
        if bucket.is_open and bucket.completed < bucket.target:
            continue
        if bucket.completed >= bucket.target:
            current += 1
            continue
        break

    running = 0
    best = 0
    for bucket in buckets:
        if bucket.target == 0:
            continue
        if bucket.is_open and bucket.completed < bucket.target:
            continue
        if bucket.completed >= bucket.target:
            running += 1
            best = max(best, running)
        else:
            running = 0
    return current, best


def _finalized_weekly_period_stats(
    calendar: Calendar,
    today: date,
    period_start: date,
    period_end: date,
) -> tuple[int, int]:
    """Return rate units for complete weekly buckets ending in the period.

    A weekly goal belongs to an ISO week, not to an arbitrary slice of it.
    For example, a Wed--Sun report includes the complete Mon--Sun bucket when
    that Sunday is in the requested range; its target and completions are read
    from the whole bucket.  This avoids reducing a 3/week goal to 1 merely
    because the report started on Saturday.  The still-open current week is
    excluded regardless of the report end date.
    """

    if period_start > period_end:
        return 0, 0

    first_week_end = _sunday_on_or_after(period_start)
    last_week_end = min(period_end, today - _ONE_DAY)
    if first_week_end > last_week_end:
        return 0, 0

    expected = 0
    completed = 0
    week_end = first_week_end
    while week_end <= last_week_end:
        week_start = week_end - timedelta(days=6)
        bucket = _weekly_bucket(calendar, week_start, today, calendar.start_date)
        expected += bucket.target
        completed += min(bucket.completed, bucket.target)
        week_end += _ONE_WEEK
    return expected, completed


@dataclass(frozen=True, slots=True)
class _WeeklyBucket:
    target: int
    completed: int
    is_open: bool


def _weekly_bucket(
    calendar: Calendar,
    week_start: date,
    today: date,
    segment_start: date,
) -> _WeeklyBucket:
    """Resolve one ISO weekly-target bucket within a cadence segment."""

    week_end = _week_end(week_start)
    applicable_start = max(week_start, calendar.start_date, segment_start)
    target_per_week: int | None = None
    capacity = 0
    completed = 0

    for day in _days(applicable_start, week_end):
        schedule = _schedule_or_none(calendar, day)
        if schedule is None or _family(schedule) != "weeks":
            continue

        # Valid revisions are Monday-aligned.  This guard makes malformed
        # midweek data deterministic: each bucket uses its first weekly plan.
        if target_per_week is None:
            target_per_week = schedule.target_per_week
        if schedule.target_per_week != target_per_week:
            continue

        if not eligible(calendar, day):
            continue
        capacity += 1
        if day <= today and day in calendar.completions:
            completed += 1

    target = min(target_per_week or 0, capacity)
    return _WeeklyBucket(
        target=target,
        completed=completed,
        is_open=week_start <= today <= week_end,
    )


def _current_week_progress(
    calendar: Calendar,
    today: date,
    current_schedule: Schedule,
    family: str,
) -> tuple[int, int]:
    """Return raw completed and attainable capacity for today's ISO week."""

    if today < calendar.start_date:
        return 0, 0

    week_start = _monday(today)
    week_end = _week_end(week_start)
    capacity = 0
    completed = 0
    for day in _days(week_start, week_end):
        schedule = _schedule_or_none(calendar, day)
        if schedule is None or _family(schedule) != family:
            continue
        if not eligible(calendar, day):
            continue
        capacity += 1
        if day <= today and day in calendar.completions:
            completed += 1

    if family == "weeks":
        return completed, min(current_schedule.target_per_week, capacity)
    return completed, capacity


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _sunday_on_or_after(day: date) -> date:
    return day + timedelta(days=6 - day.weekday())


def _week_end(week_start: date) -> date:
    return week_start + timedelta(days=6)


def _days(start: date, end: date) -> Iterator[date]:
    current = start
    while current <= end:
        yield current
        current += _ONE_DAY


def _days_reverse(start: date, end: date) -> Iterator[date]:
    current = end
    while current >= start:
        yield current
        current -= _ONE_DAY


def _weeks(start: date, end: date) -> Iterator[date]:
    current = start
    while current <= end:
        yield current
        current += _ONE_WEEK
