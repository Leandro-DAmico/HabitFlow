from __future__ import annotations

from collections.abc import Iterator

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    database_path = tmp_path / "habitflow-test.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("HABITFLOW_DATABASE_URL", database_url)
    monkeypatch.setenv("HABITFLOW_NOW", "2026-03-18T12:00:00Z")
    alembic_config = Config("alembic.ini")
    command.upgrade(alembic_config, "head")
    settings = Settings(
        HABITFLOW_DATABASE_URL=database_url,
        HABITFLOW_NOW="2026-03-18T12:00:00Z",
    )
    application = create_app(settings)
    with TestClient(application) as test_client:
        yield test_client
    application.state.engine.dispose()
