"""Aplicação FastAPI do HashPanel.

A cadeia de middlewares reproduz o comportamento esperado:

1. log de requisição,
2. CORS,
3. limite de requisições (apenas em ``/api``),
4. telemetria de fuso horário (apenas em ``/api``),
5. rotas.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from hashpanel.config import get_settings
from hashpanel.errors import HashpanelError
from hashpanel.server.errors import (
    error_response,
    generic_error_handler,
    hashpanel_error_handler,
    not_found_handler,
)
from hashpanel.server.rate_limit import (
    API_RULE,
    api_limiter,
    client_key,
    rate_limit_headers,
)
from hashpanel.server.routes import register_routes
from hashpanel.services.listener import get_mention_listener
from hashpanel.services.telemetry import track_timezone_from_request
from hashpanel.utils.logger import get_logger

logger = get_logger()

PUBLIC_DIR = Path("public")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicia e encerra o bot de menções junto com o servidor."""
    settings = get_settings()
    listener = get_mention_listener()

    # Em testes não abrimos conexão de streaming com o Mastodon.
    if settings.node_env != "test":
        listener.start()
        logger.info("Web server started", host=settings.host, port=settings.port)

    try:
        yield
    finally:
        listener.stop()
        logger.info("Web server stopped")


def create_app() -> FastAPI:
    """Constrói a aplicação FastAPI."""
    settings = get_settings()

    app = FastAPI(
        title="HashPanel API",
        version="1.0.0",
        description="Mastodon hashtag monitoring and analysis API",
        lifespan=lifespan,
    )

    _register_middleware(app, settings)
    _register_error_handlers(app)

    register_routes(app)

    if PUBLIC_DIR.exists():
        app.mount("/assets", StaticFiles(directory=PUBLIC_DIR), name="assets")

    return app


def _register_middleware(app: FastAPI, settings: Any) -> None:
    """Instala os middlewares na ordem correta."""

    @app.middleware("http")
    async def request_logging(request: Request, call_next: Any) -> Any:
        start = time.monotonic()
        logger.info(
            "Request started",
            method=request.method,
            url=str(request.url),
            ip=request.client.host if request.client else None,
        )
        response = await call_next(request)
        duration_ms = round((time.monotonic() - start) * 1000, 2)
        logger.info(
            "Request completed",
            method=request.method,
            url=str(request.url),
            status_code=response.status_code,
            duration=duration_ms,
        )
        return response

    allowed_origins = settings.allowed_origins
    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
        )
    else:
        # Em desenvolvimento aceitamos apenas origens locais.
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"^https?://localhost(:\d+)?$",
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
        )

    @app.middleware("http")
    async def rate_limiting(request: Request, call_next: Any) -> Any:
        if not request.url.path.startswith("/api"):
            return await call_next(request)

        key = client_key(request)
        allowed, remaining, reset_seconds = api_limiter.check(key)

        if not allowed:
            logger.warning("Rate limit exceeded", ip=key, url=str(request.url))
            response = error_response(
                API_RULE.message,
                API_RULE.error_code,
                429,
                details={
                    "retryAfter": int(reset_seconds) + 1,
                    "resetTime": _reset_iso(reset_seconds),
                },
            )
            response.headers["Retry-After"] = str(int(reset_seconds) + 1)
            for header, value in rate_limit_headers(API_RULE, 0, reset_seconds).items():
                response.headers[header] = value
            return response

        response = await call_next(request)
        for header, value in rate_limit_headers(API_RULE, remaining, reset_seconds).items():
            response.headers[header] = value
        return response

    @app.middleware("http")
    async def timezone_telemetry(request: Request, call_next: Any) -> Any:
        if request.url.path.startswith("/api"):
            timezone = request.query_params.get("timezone")
            if timezone:
                track_timezone_from_request(
                    timezone,
                    {
                        "endpoint": request.url.path,
                        "method": request.method,
                        "userAgent": request.headers.get("user-agent"),
                    },
                )
        return await call_next(request)


def _reset_iso(reset_seconds: float) -> str:
    """Instante (ISO) em que a janela de limite se renova."""
    from datetime import UTC, datetime, timedelta

    return (datetime.now(UTC) + timedelta(seconds=reset_seconds)).isoformat()


def _register_error_handlers(app: FastAPI) -> None:
    """Registra os handlers de erro."""

    @app.exception_handler(HashpanelError)
    async def _domain(request: Request, exc: Exception) -> JSONResponse:
        return await hashpanel_error_handler(request, exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: Exception) -> JSONResponse:
        fields = [
            {
                "field": ".".join(str(part) for part in error.get("loc", []) if part != "body"),
                "message": error.get("msg", ""),
                "code": error.get("type", ""),
            }
            for error in exc.errors()
        ]
        return error_response(
            "Validation failed", "VALIDATION_ERROR", 400, details={"fields": fields}
        )

    @app.exception_handler(404)
    async def _not_found(request: Request, exc: Exception) -> JSONResponse:
        return await not_found_handler(request, exc)

    @app.exception_handler(Exception)
    async def _generic(request: Request, exc: Exception) -> JSONResponse:
        return await generic_error_handler(request, exc)


async def serve_frontend(request: Request) -> Any:
    """Serve o ``index.html`` do dashboard para qualquer rota da SPA."""
    index = PUBLIC_DIR / "index.html"
    if not index.exists():
        return error_response("Frontend not found", "FRONTEND_ERROR", 500)
    return FileResponse(index)


app = create_app()
