"""Regressions found by the final read-only Terra review and root integration."""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient


def make_habit(client: TestClient) -> str:
    response = client.post(
        "/api/v1/habits",
        json={
            "name": "Un passo",
            "goal": "",
            "icon": "leaf",
            "color": "#314e42",
            "start_date": "2026-03-01",
            "schedule": {"kind": "daily", "timezone": "Europe/Rome"},
        },
    )
    assert response.status_code == 201
    return str(response.json()["id"])


@pytest.mark.parametrize("state,with_pause", [("paused", False), ("active", True)])
def test_import_rejects_lifecycle_interval_mismatch_atomically(
    client: TestClient, state: str, with_pause: bool
) -> None:
    habit_id = make_habit(client)
    backup = client.get("/api/v1/data/export").json()
    assert client.delete(f"/api/v1/habits/{habit_id}").status_code == 204
    backup["habits"][0]["status"] = state
    if with_pause:
        backup["pauses"] = [
            {
                "id": str(uuid4()),
                "habit_id": habit_id,
                "start_date": "2026-03-18",
                "end_date": None,
                "created_at": "2026-03-18T12:00:00Z",
            }
        ]
    result = client.post("/api/v1/data/import", json=backup)
    assert result.status_code == 422, result.text
    assert client.get("/api/v1/habits").json() == []
    assert client.get("/api/v1/data/export").json()["schedules"] == []


def test_valid_paused_backup_restores_neutral_days_and_blocks_current_checkin(
    client: TestClient,
) -> None:
    habit_id = make_habit(client)
    assert client.post(f"/api/v1/habits/{habit_id}/pause").status_code == 200
    backup = client.get("/api/v1/data/export").json()
    assert client.delete(f"/api/v1/habits/{habit_id}").status_code == 204
    result = client.post("/api/v1/data/import", json=backup)
    assert result.status_code == 200, result.text
    restored = client.get(f"/api/v1/habits/{habit_id}").json()
    assert restored["status"] == "paused"
    assert restored["is_due"] is False
    assert (
        client.put(f"/api/v1/habits/{habit_id}/checkins/2026-03-18", json={"note": ""}).status_code
        == 409
    )


def test_concurrent_duplicate_completions_are_both_successful_and_unique(
    client: TestClient,
) -> None:
    habit_id = make_habit(client)

    def complete(_: int) -> int:
        return client.put(
            f"/api/v1/habits/{habit_id}/checkins/2026-03-18", json={"note": "un solo gesto"}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(complete, range(2))) == [200, 200]
    backup = client.get("/api/v1/data/export").json()
    assert len(backup["checkins"]) == 1
