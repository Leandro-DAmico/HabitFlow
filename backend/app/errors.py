"""Small, stable error vocabulary shared by HTTP endpoints and services."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class AppError(Exception):
    code: str
    message: str
    status_code: int = 400
    details: list[dict[str, object]] = field(default_factory=list)


class NotFoundError(AppError):
    def __init__(self, message: str = "Risorsa non trovata") -> None:
        super().__init__("not_found", message, 404)


class ConflictError(AppError):
    def __init__(
        self, code: str, message: str, details: list[dict[str, object]] | None = None
    ) -> None:
        super().__init__(code, message, 409, details or [])


class ForbiddenStateError(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, 409)
