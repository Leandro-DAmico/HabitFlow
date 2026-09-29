"""Configuration for the local-only HabitFlow API."""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ORIGINS = (
    "http://127.0.0.1:5173,"
    "http://localhost:5173,"
    "http://127.0.0.1:5174,"
    "http://localhost:5174,"
    "http://localhost:8080,"
    "http://127.0.0.1:8080"
)


class Settings(BaseSettings):
    """Environment-driven settings with deliberately small public surface."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="sqlite:///./data/habitflow.db",
        validation_alias="HABITFLOW_DATABASE_URL",
    )
    allowed_origins_raw: str = Field(
        default=DEFAULT_ORIGINS,
        validation_alias="HABITFLOW_ALLOWED_ORIGINS",
    )
    now_raw: str | None = Field(default=None, validation_alias="HABITFLOW_NOW")
    environment: str = Field(default="development", validation_alias="HABITFLOW_ENV")

    @field_validator("allowed_origins_raw")
    @classmethod
    def origins_are_http_urls(cls, value: str) -> str:
        origins = [origin.strip() for origin in value.split(",") if origin.strip()]
        if not origins or any(not origin.startswith(("http://", "https://")) for origin in origins):
            raise ValueError(
                "HABITFLOW_ALLOWED_ORIGINS must be a comma-separated list of HTTP origins"
            )
        return ",".join(origins)

    @field_validator("now_raw")
    @classmethod
    def now_is_utc(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() != UTC.utcoffset(parsed):
            raise ValueError("HABITFLOW_NOW must be an ISO-8601 UTC timestamp")
        return value

    @property
    def allowed_origins(self) -> list[str]:
        return self.allowed_origins_raw.split(",")

    def now_utc(self) -> datetime:
        """Return a UTC clock value; HABITFLOW_NOW exists for deterministic tests/demo."""
        if self.now_raw:
            return datetime.fromisoformat(self.now_raw.replace("Z", "+00:00")).astimezone(UTC)
        return datetime.now(UTC)


def load_settings() -> Settings:
    return Settings()
