"""Start a real migrated API with disposable, isolated data for Playwright."""

import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


def main() -> None:
    backend = Path(__file__).resolve().parents[1] / "backend"
    os.chdir(backend)
    sys.path.insert(0, str(backend))
    with TemporaryDirectory(
        prefix="habitflow-e2e-", ignore_cleanup_errors=True
    ) as directory:
        database = Path(directory) / "e2e.db"
        os.environ["HABITFLOW_DATABASE_URL"] = f"sqlite:///{database.as_posix()}"
        os.environ["HABITFLOW_ALLOWED_ORIGINS"] = (
            "http://127.0.0.1:5174,http://localhost:5174"
        )
        import uvicorn
        from alembic import command
        from alembic.config import Config

        command.upgrade(Config(str(backend / "alembic.ini")), "head")
        uvicorn.run("app.main:app", host="127.0.0.1", port=8001, log_level="warning")


if __name__ == "__main__":
    main()
