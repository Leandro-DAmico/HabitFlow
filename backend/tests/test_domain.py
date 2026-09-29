from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.domain import (
    Calendar,
    Pause,
    Schedule,
    calculate_stats,
    calendar_series,
    eligible,
    local_today,
    next_monday,
    schedule_at,
)

ROME = "Europe/Rome"


def plan(
    effective_from: date,
    *,
    kind: str = "daily",
    weekdays: tuple[int, ...] = (),
    target: int = 1,
    timezone: str = ROME,
) -> Schedule:
    return Schedule(
        effective_from=effective_from,
        kind=kind,
        weekdays=weekdays,
        target_per_week=target,
        timezone=timezone,
    )


def calendar(
    start: date,
    schedules: tuple[Schedule, ...] | None = None,
    pauses: tuple[Pause, ...] = (),
    completions: frozenset[date] = frozenset(),
) -> Calendar:
    return Calendar(
        start_date=start,
        schedules=schedules or (plan(start),),
        pauses=pauses,
        completions=completions,
    )


def test_next_monday_is_strictly_after_input() -> None:
    assert next_monday(date(2026, 9, 14)) == date(2026, 9, 21)  # Monday
    assert next_monday(date(2026, 9, 16)) == date(2026, 9, 21)


def test_local_today_uses_iana_timezone_across_dst_boundary() -> None:
    # Rome has already crossed into the next civil day while UTC has not.
    instant = datetime(2026, 3, 29, 22, 30, tzinfo=UTC)
    assert local_today(instant, ROME) == date(2026, 3, 30)
    # The spring-forward hour is still one civil date, not two occurrences.
    assert local_today(datetime(2026, 3, 29, 1, 30, tzinfo=UTC), ROME) == date(2026, 3, 29)


@pytest.mark.parametrize("timezone", ["Not/AZone", ""])
def test_local_today_rejects_unknown_timezone(timezone: str) -> None:
    with pytest.raises(ValueError, match="timezone"):
        local_today(datetime(2026, 1, 1, tzinfo=UTC), timezone)


def test_local_today_rejects_naive_clock() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        local_today(datetime(2026, 1, 1), ROME)


def test_schedule_revision_resolves_without_rewriting_prior_dates() -> None:
    start = date(2026, 1, 7)  # Wednesday
    changed = next_monday(start)
    value = calendar(
        start,
        schedules=(
            plan(start, timezone="Europe/Rome"),
            plan(
                changed,
                kind="weekdays",
                weekdays=(1, 3, 5),
                timezone="America/New_York",
            ),
        ),
    )

    assert schedule_at(value, changed - timedelta(days=1)).timezone == ROME
    assert schedule_at(value, changed).timezone == "America/New_York"
    assert eligible(value, date(2026, 1, 8))  # old daily schedule
    assert not eligible(value, date(2026, 1, 13))  # Tuesday in new plan
    assert eligible(value, date(2026, 1, 14))  # Wednesday in new plan


def test_schedule_at_before_first_revision_is_explicit() -> None:
    start = date(2026, 2, 2)
    value = calendar(start)
    with pytest.raises(ValueError, match="no schedule"):
        schedule_at(value, start - timedelta(days=1))
    assert not eligible(value, start - timedelta(days=1))


def test_daily_miss_breaks_current_streak_and_open_day_does_not() -> None:
    monday = date(2026, 1, 5)
    value = calendar(monday, completions=frozenset({monday}))

    stats = calculate_stats(value, date(2026, 1, 7))  # Wed is open; Tue was missed.

    assert stats == {
        "current_streak": 0,
        "best_streak": 1,
        "streak_unit": "sessions",
        "completed": 1,
        "expected": 2,
        "completion_rate": 50.0,
        "total_checkins": 1,
        "week_completed": 1,
        "week_target": 7,
    }


def test_open_daily_completion_extends_streak_but_not_closed_rate() -> None:
    monday = date(2026, 1, 5)
    wednesday = date(2026, 1, 7)
    value = calendar(monday, completions=frozenset({monday, monday.replace(day=6), wednesday}))

    stats = calculate_stats(value, wednesday)

    assert stats["current_streak"] == 3
    assert stats["best_streak"] == 3
    assert stats["completed"] == 2
    assert stats["expected"] == 2
    assert stats["completion_rate"] == 100.0
    assert stats["total_checkins"] == 3


def test_weekday_plan_skips_non_due_dates_in_rate_and_streak() -> None:
    monday = date(2026, 1, 5)
    value = calendar(
        monday,
        schedules=(plan(monday, kind="weekdays", weekdays=(1, 3, 5)),),
        completions=frozenset({monday, date(2026, 1, 7)}),
    )

    stats = calculate_stats(value, date(2026, 1, 8))

    assert stats["current_streak"] == 2
    assert stats["best_streak"] == 2
    assert stats["completed"] == 2
    assert stats["expected"] == 2
    assert stats["week_completed"] == 2
    assert stats["week_target"] == 3


def test_completed_pause_start_day_remains_eligible_and_pause_bridges_streak() -> None:
    monday = date(2026, 1, 5)
    tuesday = date(2026, 1, 6)
    thursday = date(2026, 1, 8)
    value = calendar(
        monday,
        pauses=(Pause(start=tuesday, end=thursday),),
        completions=frozenset({monday, tuesday, thursday}),
    )

    assert eligible(value, tuesday)  # check-in predates pause action that day
    assert not eligible(value, date(2026, 1, 7))
    assert eligible(value, thursday)  # resume end is exclusive / active today

    stats = calculate_stats(value, date(2026, 1, 9))
    assert stats["current_streak"] == 3
    assert stats["best_streak"] == 3
    assert stats["expected"] == 3
    assert stats["completed"] == 3
    # Mon, the preserved Tue check-in, Thu--Sun are all attainable capacity.
    assert stats["week_target"] == 6


def test_open_pause_protects_today_and_remaining_week_capacity() -> None:
    monday = date(2026, 1, 5)
    # Thursday onward is paused. Wed is still open, and only Mon-Wed capacity
    # remains for the weekly target.
    value = calendar(
        monday,
        schedules=(plan(monday, kind="times_per_week", target=3),),
        pauses=(Pause(start=date(2026, 1, 8), end=None),),
    )

    stats = calculate_stats(value, date(2026, 1, 7))

    assert stats["week_completed"] == 0
    assert stats["week_target"] == 3
    assert stats["expected"] == 0  # open target week is never a failure
    assert stats["completion_rate"] is None


def test_three_times_week_succeeds_only_when_week_is_finalized() -> None:
    monday = date(2026, 1, 5)
    completions = frozenset({monday, date(2026, 1, 7), date(2026, 1, 9)})
    value = calendar(
        monday,
        schedules=(plan(monday, kind="times_per_week", target=3),),
        completions=completions,
    )

    open_stats = calculate_stats(value, date(2026, 1, 11))  # Sunday remains open
    assert open_stats["streak_unit"] == "weeks"
    assert open_stats["current_streak"] == 1
    assert open_stats["best_streak"] == 1
    assert open_stats["completed"] == 0
    assert open_stats["expected"] == 0
    assert open_stats["week_completed"] == 3
    assert open_stats["week_target"] == 3

    closed_stats = calculate_stats(value, date(2026, 1, 12))
    assert closed_stats["completed"] == 3
    assert closed_stats["expected"] == 3
    assert closed_stats["completion_rate"] == 100.0
    # The new open week cannot break last week's success.
    assert closed_stats["current_streak"] == 1


def test_weekly_miss_breaks_only_after_the_week_closes() -> None:
    monday = date(2026, 1, 5)
    value = calendar(
        monday,
        schedules=(plan(monday, kind="times_per_week", target=3),),
        completions=frozenset({monday, date(2026, 1, 7)}),
    )

    during_week = calculate_stats(value, date(2026, 1, 8))
    assert during_week["current_streak"] == 0
    assert during_week["completion_rate"] is None

    after_week = calculate_stats(value, date(2026, 1, 12))
    assert after_week["current_streak"] == 0
    assert after_week["best_streak"] == 0
    assert after_week["completed"] == 2
    assert after_week["expected"] == 3
    assert after_week["completion_rate"] == 66.7


def test_weekly_extra_checkins_stay_visible_but_rate_is_capped() -> None:
    monday = date(2026, 1, 5)
    value = calendar(
        monday,
        schedules=(plan(monday, kind="times_per_week", target=3),),
        completions=frozenset({monday, date(2026, 1, 6), date(2026, 1, 7), date(2026, 1, 8)}),
    )

    stats = calculate_stats(value, date(2026, 1, 12))

    assert stats["completed"] == 3
    assert stats["expected"] == 3
    assert stats["completion_rate"] == 100.0
    assert stats["total_checkins"] == 4


def test_partial_first_week_caps_weekly_target_to_available_dates() -> None:
    saturday = date(2026, 1, 10)
    value = calendar(
        saturday,
        schedules=(plan(saturday, kind="times_per_week", target=3),),
        completions=frozenset({saturday, date(2026, 1, 11)}),
    )

    stats = calculate_stats(value, date(2026, 1, 12))

    assert stats["expected"] == 2
    assert stats["completed"] == 2
    assert stats["week_target"] == 3  # new, open Mon-Sun week has seven days


def test_month_and_year_boundary_use_iso_week_not_calendar_year() -> None:
    monday = date(2025, 12, 29)
    value = calendar(
        monday,
        schedules=(plan(monday, kind="times_per_week", target=1),),
        completions=frozenset({date(2025, 12, 31)}),
    )

    stats = calculate_stats(value, date(2026, 1, 5))

    assert stats["expected"] == 1
    assert stats["completed"] == 1
    assert stats["current_streak"] == 1


def test_cadence_family_change_starts_new_streak_segment() -> None:
    monday = date(2026, 1, 5)
    following_monday = next_monday(monday)
    value = calendar(
        monday,
        schedules=(
            plan(monday),
            plan(following_monday, kind="times_per_week", target=3),
        ),
        completions=frozenset(
            {
                monday,
                date(2026, 1, 6),
                date(2026, 1, 7),
                date(2026, 1, 8),
                date(2026, 1, 9),
                date(2026, 1, 10),
                date(2026, 1, 11),
                following_monday,
            }
        ),
    )

    stats = calculate_stats(value, date(2026, 1, 13))

    assert stats["streak_unit"] == "weeks"
    assert stats["current_streak"] == 0
    assert stats["best_streak"] == 0


def test_daily_to_weekdays_stays_in_sessions_streak_family() -> None:
    monday = date(2026, 1, 5)
    next_week = next_monday(monday)
    value = calendar(
        monday,
        schedules=(
            plan(monday),
            plan(next_week, kind="weekdays", weekdays=(1, 3, 5)),
        ),
        completions=frozenset(
            {
                monday,
                date(2026, 1, 6),
                date(2026, 1, 7),
                date(2026, 1, 8),
                date(2026, 1, 9),
                date(2026, 1, 10),
                date(2026, 1, 11),
                next_week,
            }
        ),
    )

    stats = calculate_stats(value, date(2026, 1, 13))

    assert stats["streak_unit"] == "sessions"
    assert stats["current_streak"] == 8
    assert stats["best_streak"] == 8


def test_calendar_series_reports_daily_capacity_not_weekly_fraction() -> None:
    monday = date(2026, 1, 5)
    wednesday = date(2026, 1, 7)
    value = calendar(
        monday,
        schedules=(plan(monday, kind="times_per_week", target=3),),
        completions=frozenset({monday}),
    )

    series = calendar_series(value, wednesday, monday, wednesday)

    assert series == [
        {"date": "2026-01-05", "completed": 1, "expected": 1},
        {"date": "2026-01-06", "completed": 0, "expected": 1},
        {"date": "2026-01-07", "completed": 0, "expected": 1},
    ]


def test_calendar_series_never_makes_future_slots_due() -> None:
    monday = date(2026, 1, 5)
    value = calendar(monday)

    series = calendar_series(value, monday, monday, date(2026, 1, 7))

    assert series[-1] == {"date": "2026-01-07", "completed": 0, "expected": 0}


def test_unscheduled_or_pre_start_completion_does_not_count() -> None:
    monday = date(2026, 1, 5)
    value = calendar(
        monday,
        schedules=(plan(monday, kind="weekdays", weekdays=(1,)),),
        completions=frozenset({date(2026, 1, 4), date(2026, 1, 6)}),
    )

    stats = calculate_stats(value, date(2026, 1, 7))

    assert stats["total_checkins"] == 0
    assert stats["completed"] == 0
    assert stats["expected"] == 1
    assert not eligible(value, date(2026, 1, 6))


def test_selected_period_is_inclusive_and_excludes_its_open_units() -> None:
    monday = date(2026, 1, 5)
    value = calendar(
        monday,
        completions=frozenset({monday, date(2026, 1, 6), date(2026, 1, 7)}),
    )

    stats = calculate_stats(
        value,
        date(2026, 1, 7),
        from_date=date(2026, 1, 6),
        to_date=date(2026, 1, 7),
    )

    assert stats["completed"] == 1
    assert stats["expected"] == 1
    assert stats["total_checkins"] == 2


def test_weekly_period_rate_uses_the_whole_bucket_ending_in_range() -> None:
    monday = date(2026, 1, 5)
    sunday = date(2026, 1, 11)
    value = calendar(
        monday,
        schedules=(plan(monday, kind="times_per_week", target=3),),
        completions=frozenset({monday, date(2026, 1, 6), date(2026, 1, 7)}),
    )

    # The report starts on Saturday, but its Sunday closes the Mon--Sun goal.
    # The rate must remain 3/3 rather than lowering the target to Saturday and
    # Sunday capacity.
    stats = calculate_stats(
        value,
        date(2026, 1, 12),
        from_date=date(2026, 1, 10),
        to_date=sunday,
    )

    assert stats["expected"] == 3
    assert stats["completed"] == 3
    assert stats["completion_rate"] == 100.0
    # Raw check-ins still describe the selected dates, not an invented range.
    assert stats["total_checkins"] == 0


def test_future_start_is_an_empty_history_not_an_invalid_range() -> None:
    next_week = date(2026, 1, 12)
    value = calendar(next_week)

    stats = calculate_stats(value, date(2026, 1, 5))

    assert stats == {
        "current_streak": 0,
        "best_streak": 0,
        "streak_unit": "sessions",
        "completed": 0,
        "expected": 0,
        "completion_rate": None,
        "total_checkins": 0,
        "week_completed": 0,
        "week_target": 0,
    }


@pytest.mark.parametrize(
    ("bad_schedule", "message"),
    [
        (Schedule(date(2026, 1, 5), "weekdays", (), 1, ROME), "weekday"),
        (Schedule(date(2026, 1, 5), "times_per_week", (), 8, ROME), "target"),
        (Schedule(date(2026, 1, 5), "daily", (1,), 1, ROME), "weekdays"),
    ],
)
def test_invalid_schedule_is_rejected(bad_schedule: Schedule, message: str) -> None:
    value = Calendar(date(2026, 1, 5), (bad_schedule,), (), frozenset())
    with pytest.raises(ValueError, match=message):
        calculate_stats(value, date(2026, 1, 5))


def test_invalid_pause_and_range_are_rejected() -> None:
    monday = date(2026, 1, 5)
    invalid_pause = calendar(monday, pauses=(Pause(monday, monday),))
    with pytest.raises(ValueError, match="pause"):
        calculate_stats(invalid_pause, monday)
    with pytest.raises(ValueError, match="from_date"):
        calendar_series(calendar(monday), monday, date(2026, 1, 7), monday)
