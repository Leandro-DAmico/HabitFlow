from __future__ import annotations

from copy import deepcopy

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from alembic import command
from app.config import Settings
from app.db import make_engine


def _habit_payload(
    *,
    name: str = "Bere acqua",
    start_date: str = "2026-03-01",
    kind: str = "daily",
    weekdays: list[int] | None = None,
    target_per_week: int = 1,
    timezone: str = "Europe/Rome",
) -> dict[str, object]:
    return {
        "name": name,
        "goal": "Un gesto piccolo e realistico",
        "icon": "💧",
        "color": "#2563EB",
        "start_date": start_date,
        "schedule": {
            "kind": kind,
            "weekdays": weekdays or [],
            "target_per_week": target_per_week,
            "timezone": timezone,
        },
    }


def _create_habit(client: TestClient, **kwargs: object) -> dict[str, object]:
    response = client.post("/api/v1/habits", json=_habit_payload(**kwargs))
    assert response.status_code == 201, response.text
    return response.json()


def _set_now(client: TestClient, timestamp: str) -> None:
    client.app.state.settings.now_raw = timestamp


def test_real_migration_creates_required_tables(client: TestClient) -> None:
    tables = set(inspect(client.app.state.engine).get_table_names())
    assert {"settings", "habits", "schedules", "pauses", "checkins"} <= tables
    assert client.get("/api/v1/health").json() == {"status": "ok"}


def test_schema_validation_and_habit_filters(client: TestClient) -> None:
    invalid = _habit_payload()
    invalid["schedule"] = {
        "kind": "daily",
        "weekdays": [],
        "target_per_week": 2,
        "timezone": "Europe/Rome",
    }
    response = client.post("/api/v1/habits", json=invalid)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"

    _create_habit(client, name="Bere acqua")
    _create_habit(client, name="Fare stretching")
    filtered = client.get("/api/v1/habits", params={"status": "active", "q": "acqua"})
    assert filtered.status_code == 200
    assert [item["name"] for item in filtered.json()] == ["Bere acqua"]


def test_checkin_put_and_delete_are_idempotent(client: TestClient) -> None:
    habit = _create_habit(client)
    habit_id = str(habit["id"])

    first = client.put(f"/api/v1/habits/{habit_id}/checkins/2026-03-18", json={"note": "prima"})
    second = client.put(
        f"/api/v1/habits/{habit_id}/checkins/2026-03-18", json={"note": "aggiornata"}
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["completed_today"] is True
    assert second.json()["note_today"] == "aggiornata"

    backup = client.get("/api/v1/data/export").json()
    assert len(backup["checkins"]) == 1
    assert backup["checkins"][0]["note"] == "aggiornata"
    assert client.delete(f"/api/v1/habits/{habit_id}/checkins/2026-03-18").status_code == 204
    assert client.delete(f"/api/v1/habits/{habit_id}/checkins/2026-03-18").status_code == 204


def test_lifecycle_preserves_today_completion_and_archive_is_read_only(client: TestClient) -> None:
    habit = _create_habit(client)
    habit_id = str(habit["id"])
    assert (
        client.put(f"/api/v1/habits/{habit_id}/checkins/2026-03-18", json={"note": ""}).status_code
        == 200
    )

    paused = client.post(f"/api/v1/habits/{habit_id}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert paused.json()["completed_today"] is True
    resumed = client.post(f"/api/v1/habits/{habit_id}/resume")
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "active"
    assert resumed.json()["completed_today"] is True

    archived = client.post(f"/api/v1/habits/{habit_id}/archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"
    assert (
        client.put(
            f"/api/v1/habits/{habit_id}/checkins/2026-03-18", json={"note": "no"}
        ).status_code
        == 409
    )
    assert client.delete(f"/api/v1/habits/{habit_id}/checkins/2026-03-18").status_code == 409

    _set_now(client, "2026-03-20T12:00:00Z")
    restored = client.post(f"/api/v1/habits/{habit_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"
    # The archived interval is transformed into a pause; it cannot be filled in later.
    assert (
        client.put(f"/api/v1/habits/{habit_id}/checkins/2026-03-19", json={"note": ""}).status_code
        == 409
    )
    assert (
        client.put(f"/api/v1/habits/{habit_id}/checkins/2026-03-20", json={"note": ""}).status_code
        == 200
    )


def test_weekly_target_hides_today_after_target_but_keeps_history_available(
    client: TestClient,
) -> None:
    habit = _create_habit(client, name="Leggere", kind="times_per_week", target_per_week=3)
    habit_id = str(habit["id"])
    _set_now(client, "2026-03-19T12:00:00Z")
    for day in ("2026-03-16", "2026-03-17", "2026-03-18"):
        assert (
            client.put(f"/api/v1/habits/{habit_id}/checkins/{day}", json={"note": ""}).status_code
            == 200
        )
    today = client.get(f"/api/v1/habits/{habit_id}")
    assert today.status_code == 200
    assert today.json()["is_due"] is False
    # A legitimate historical extra remains representable for heatmap/history.
    assert (
        client.put(
            f"/api/v1/habits/{habit_id}/checkins/2026-03-14", json={"note": "extra"}
        ).status_code
        == 200
    )


def test_import_is_atomic_idempotent_and_rejects_conflicts(client: TestClient) -> None:
    _create_habit(client)
    backup = client.get("/api/v1/data/export").json()
    repeated = client.post("/api/v1/data/import", json=backup)
    assert repeated.status_code == 200
    assert repeated.json()["imported"] == 0
    assert repeated.json()["skipped"] >= 2

    conflict = deepcopy(backup)
    conflict["habits"][0]["name"] = "Dati diversi"
    response = client.post("/api/v1/data/import", json=conflict)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "import_conflict"

    malformed = deepcopy(backup)
    bad_schedule = deepcopy(malformed["schedules"][0])
    bad_schedule["id"] = "00000000-0000-0000-0000-000000000111"
    bad_schedule["habit_id"] = "00000000-0000-0000-0000-000000000000"
    malformed["schedules"].append(bad_schedule)
    response = client.post("/api/v1/data/import", json=malformed)
    assert response.status_code == 422
    after = client.get("/api/v1/data/export").json()
    assert after["habits"] == backup["habits"]
    assert after["schedules"] == backup["schedules"]


def test_import_restores_a_valid_backup_into_an_empty_database(client: TestClient) -> None:
    habit_id = "11111111-1111-4111-8111-111111111111"
    schedule_id = "22222222-2222-4222-8222-222222222222"
    payload = {
        "format": "habitflow-backup",
        "version": 1,
        "exported_at": "2026-03-18T12:00:00Z",
        "settings": {
            "display_name": "Ada",
            "timezone": "Europe/Rome",
            "onboarding_completed": True,
        },
        "habits": [
            {
                "id": habit_id,
                "name": "Scrivere",
                "goal": "Due righe quando serve",
                "icon": "✍️",
                "color": "#4F7A5C",
                "start_date": "2026-03-01",
                "status": "active",
                "archived_on": None,
                "created_at": "2026-03-01T08:00:00Z",
                "updated_at": "2026-03-01T08:00:00Z",
            }
        ],
        "schedules": [
            {
                "id": schedule_id,
                "habit_id": habit_id,
                "kind": "daily",
                "weekdays": [],
                "target_per_week": 1,
                "timezone": "Europe/Rome",
                "effective_from": "2026-03-01",
                "created_at": "2026-03-01T08:00:00Z",
            }
        ],
        "pauses": [],
        "checkins": [],
    }
    response = client.post("/api/v1/data/import", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["imported"] == 3
    assert client.get("/api/v1/settings").json()["display_name"] == "Ada"
    assert client.get("/api/v1/habits").json()[0]["name"] == "Scrivere"


def test_demo_is_additive_and_repeatable(client: TestClient) -> None:
    first = client.post("/api/v1/data/demo")
    second = client.post("/api/v1/data/demo")
    assert first.status_code == 200
    assert first.json()["created"] == 3
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert len(client.get("/api/v1/habits").json()) == 3


def test_timezone_transition_keeps_date_and_schedule_snapshot_consistent(
    client: TestClient,
) -> None:
    _set_now(client, "2026-10-05T12:00:00Z")
    habit = _create_habit(client, start_date="2026-10-01", timezone="Europe/Rome")
    habit_id = str(habit["id"])
    patch = client.patch(
        f"/api/v1/habits/{habit_id}",
        json={
            "schedule": {
                "kind": "daily",
                "weekdays": [],
                "target_per_week": 1,
                "timezone": "America/New_York",
            }
        },
    )
    assert patch.status_code == 200
    assert patch.json()["pending_schedule"]["effective_from"] == "2026-10-12"

    # It is Monday in Rome but still Sunday in New York. The API uses the
    # canonical last date of the old revision, not a mixed schedule/date pair.
    _set_now(client, "2026-10-12T00:30:00Z")
    before = client.get(f"/api/v1/habits/{habit_id}").json()
    assert before["today"] == "2026-10-11"
    assert before["schedule"]["timezone"] == "Europe/Rome"
    assert (
        client.put(f"/api/v1/habits/{habit_id}/checkins/2026-10-12", json={"note": ""}).status_code
        == 422
    )

    _set_now(client, "2026-10-12T04:30:00Z")
    after = client.put(f"/api/v1/habits/{habit_id}/checkins/2026-10-12", json={"note": "fuso"})
    assert after.status_code == 200
    assert after.json()["schedule"]["timezone"] == "America/New_York"
    checkin = client.get("/api/v1/data/export").json()["checkins"][0]
    assert checkin["occurrence_date"] == "2026-10-12"
    assert checkin["timezone"] == "America/New_York"


def test_local_boundary_rejects_foreign_origin_host_and_oversize_body(client: TestClient) -> None:
    assert client.get("/api/v1/health", headers={"host": "example.invalid"}).status_code == 400
    assert (
        client.get("/api/v1/health", headers={"origin": "https://example.invalid"}).status_code
        == 403
    )
    assert (
        client.get("/api/v1/health", headers={"origin": "http://localhost:5173"}).status_code == 200
    )
    oversized = client.post(
        "/api/v1/data/import",
        content=b"x" * (5 * 1024 * 1024 + 1),
        headers={"content-type": "application/json"},
    )
    assert oversized.status_code == 413


def test_migration_can_downgrade_and_upgrade_again(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_path = tmp_path / "roundtrip.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("HABITFLOW_DATABASE_URL", database_url)
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    engine = make_engine(Settings(HABITFLOW_DATABASE_URL=database_url).database_url)
    try:
        assert "checkins" in inspect(engine).get_table_names()
    finally:
        engine.dispose()
