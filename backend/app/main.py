"""Local-only HTTP adapter. Business rules live in domain and services."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, Literal, cast
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import services
from app.config import Settings, load_settings
from app.db import get_session, make_engine, make_session_factory
from app.errors import AppError
from app.notifications import NoopNotificationAdapter, NotificationPort
from app.schemas import (
    AnalyticsOut,
    BackupPayload,
    CheckinInput,
    DemoResult,
    ErrorResponse,
    HabitCreate,
    HabitOut,
    HabitUpdate,
    HealthOut,
    ImportResult,
    SettingsOut,
    SettingsPatch,
)

MAX_BODY_BYTES = 5 * 1024 * 1024
SessionDep = Annotated[Session, Depends(get_session)]


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status, content={"error": {"code": code, "message": message, "details": []}}
    )


class LocalBoundaryMiddleware:
    """Reject foreign origins/hosts and bound request bodies, including chunked imports."""

    def __init__(self, app: ASGIApp, origins: list[str]) -> None:
        self.app = app
        self.origins = frozenset(origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        try:
            hostname = urlsplit("//" + headers.get("host", "")).hostname
        except ValueError:
            hostname = None
        if hostname not in {"127.0.0.1", "localhost", "testserver", "backend"}:
            await error_response(400, "invalid_host", "Host non consentito")(scope, receive, send)
            return
        origin = headers.get("origin")
        if origin is not None and origin not in self.origins:
            await error_response(403, "invalid_origin", "Origine non consentita")(
                scope, receive, send
            )
            return
        if scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}:
            try:
                declared_size = int(headers.get("content-length", "0"))
            except ValueError:
                declared_size = -1
            if declared_size < 0:
                await error_response(400, "invalid_length", "Lunghezza non valida")(
                    scope, receive, send
                )
                return
            if declared_size > MAX_BODY_BYTES:
                await error_response(413, "body_too_large", "Limite richiesta: 5 MiB")(
                    scope, receive, send
                )
                return
            chunks: list[bytes] = []
            size = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > MAX_BODY_BYTES:
                    await error_response(413, "body_too_large", "Limite richiesta: 5 MiB")(
                        scope, receive, send
                    )
                    return
                chunks.append(chunk)
                if not message.get("more_body", False):
                    break
            delivered = False

            async def bounded_receive() -> Message:
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
                return await receive()

            await self.app(scope, bounded_receive, send)
        else:
            await self.app(scope, receive, send)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or load_settings()
    engine = make_engine(config.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        engine.dispose()

    application = FastAPI(
        title="HabitFlow · Local-first habit API",
        version="0.1.0",
        description=(
            "Single-user, loopback-only API. Civil dates are immutable; cadence revisions "
            "start next Monday. PUT checkins is idempotent. Streaks and finalized adherence "
            "are calculated server-side. No authentication or cloud service is implied."
        ),
        lifespan=lifespan,
        responses={
            status: {"model": ErrorResponse} for status in (400, 403, 404, 409, 413, 422, 500)
        },
    )
    application.state.settings = config
    application.state.engine = engine
    application.state.session_factory = make_session_factory(engine)
    application.state.notifications = NoopNotificationAdapter()
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.allowed_origins,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )
    application.add_middleware(LocalBoundaryMiddleware, origins=config.allowed_origins)

    @application.exception_handler(AppError)
    async def application_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"location": list(error["loc"]), "message": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Controlla i campi inviati.",
                    "details": details,
                }
            },
        )

    @application.exception_handler(IntegrityError)
    async def integrity_error(_: Request, __: IntegrityError) -> JSONResponse:
        return error_response(409, "data_conflict", "Dati in conflitto. Ricarica e riprova.")

    @application.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return error_response(exc.status_code, "http_error", str(exc.detail))

    @application.exception_handler(Exception)
    async def unexpected_error(_: Request, __: Exception) -> JSONResponse:
        return error_response(
            500, "internal_error", "Errore locale inatteso. Consulta i log del server."
        )

    def clock(request: Request) -> Settings:
        return cast(Settings, request.app.state.settings)

    def notifications(request: Request) -> NotificationPort:
        return cast(NotificationPort, request.app.state.notifications)

    prefix = "/api/v1"

    @application.get(prefix + "/health", tags=["System"], response_model=HealthOut)
    def health(session: SessionDep) -> HealthOut:
        session.execute(text("SELECT 1"))
        return HealthOut(status="ok")

    @application.get(prefix + "/settings", tags=["Settings"], response_model=SettingsOut)
    def settings_get(request: Request, session: SessionDep) -> SettingsOut:
        return services.get_settings(session, clock(request).now_utc())

    @application.patch(prefix + "/settings", tags=["Settings"], response_model=SettingsOut)
    def settings_patch(
        payload: SettingsPatch, request: Request, session: SessionDep
    ) -> SettingsOut:
        return services.update_settings(session, payload, clock(request).now_utc())

    @application.get(prefix + "/habits", tags=["Habits"], response_model=list[HabitOut])
    def habits_list(
        request: Request,
        session: SessionDep,
        status: Literal["active", "paused", "archived", "all"] | None = None,
        q: Annotated[str | None, Query(max_length=80)] = None,
    ) -> list[HabitOut]:
        return services.list_habits(session, clock(request).now_utc(), status=status, query=q)

    @application.post(prefix + "/habits", tags=["Habits"], response_model=HabitOut, status_code=201)
    def habits_create(payload: HabitCreate, request: Request, session: SessionDep) -> HabitOut:
        return services.create_habit(
            session, payload, clock(request).now_utc(), notifications(request)
        )

    @application.get(prefix + "/habits/{habit_id}", tags=["Habits"], response_model=HabitOut)
    def habit_get(habit_id: str, request: Request, session: SessionDep) -> HabitOut:
        return services.habit_out(services.get_habit(session, habit_id), clock(request).now_utc())

    @application.patch(prefix + "/habits/{habit_id}", tags=["Habits"], response_model=HabitOut)
    def habit_patch(
        habit_id: str, payload: HabitUpdate, request: Request, session: SessionDep
    ) -> HabitOut:
        return services.update_habit(
            session, habit_id, payload, clock(request).now_utc(), notifications(request)
        )

    @application.delete(prefix + "/habits/{habit_id}", tags=["Habits"], status_code=204)
    def habit_delete(habit_id: str, session: SessionDep) -> Response:
        services.delete_habit(session, habit_id)
        return Response(status_code=204)

    @application.post(
        prefix + "/habits/{habit_id}/pause", tags=["Lifecycle"], response_model=HabitOut
    )
    def habit_pause(habit_id: str, request: Request, session: SessionDep) -> HabitOut:
        return services.pause_habit(session, habit_id, clock(request).now_utc())

    @application.post(
        prefix + "/habits/{habit_id}/resume", tags=["Lifecycle"], response_model=HabitOut
    )
    def habit_resume(habit_id: str, request: Request, session: SessionDep) -> HabitOut:
        return services.resume_habit(session, habit_id, clock(request).now_utc())

    @application.post(
        prefix + "/habits/{habit_id}/archive", tags=["Lifecycle"], response_model=HabitOut
    )
    def habit_archive(habit_id: str, request: Request, session: SessionDep) -> HabitOut:
        return services.archive_habit(
            session, habit_id, clock(request).now_utc(), notifications(request)
        )

    @application.post(
        prefix + "/habits/{habit_id}/restore", tags=["Lifecycle"], response_model=HabitOut
    )
    def habit_restore(habit_id: str, request: Request, session: SessionDep) -> HabitOut:
        return services.restore_habit(session, habit_id, clock(request).now_utc())

    @application.put(
        prefix + "/habits/{habit_id}/checkins/{day}", tags=["Check-ins"], response_model=HabitOut
    )
    def checkin_put(
        habit_id: str, day: date, payload: CheckinInput, request: Request, session: SessionDep
    ) -> HabitOut:
        return services.put_checkin(session, habit_id, day, payload, clock(request).now_utc())

    @application.delete(
        prefix + "/habits/{habit_id}/checkins/{day}", tags=["Check-ins"], status_code=204
    )
    def checkin_delete(habit_id: str, day: date, session: SessionDep) -> Response:
        services.delete_checkin(session, habit_id, day)
        return Response(status_code=204)

    @application.get(prefix + "/analytics", tags=["Analytics"], response_model=AnalyticsOut)
    def analytics_get(
        request: Request,
        session: SessionDep,
        days: Annotated[int, Query(ge=7, le=366)] = 84,
        habit_id: str | None = None,
    ) -> AnalyticsOut:
        return services.analytics(session, clock(request).now_utc(), days, habit_id)

    @application.get(prefix + "/data/export", tags=["Data"], response_model=BackupPayload)
    def data_export(request: Request, session: SessionDep) -> BackupPayload:
        return services.export_backup(session, clock(request).now_utc())

    @application.post(prefix + "/data/import", tags=["Data"], response_model=ImportResult)
    def data_import(payload: BackupPayload, request: Request, session: SessionDep) -> ImportResult:
        return services.import_backup(session, payload, clock(request).now_utc())

    @application.post(prefix + "/data/demo", tags=["Data"], response_model=DemoResult)
    def data_demo(request: Request, session: SessionDep) -> DemoResult:
        return DemoResult(
            created=services.seed_demo(session, clock(request).now_utc(), notifications(request))
        )

    return application


app = create_app()
