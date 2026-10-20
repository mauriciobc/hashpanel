"""Tratamento centralizado de erros.

Toda resposta de erro segue o mesmo formato::

    {"error": {"message": ..., "code": ..., "details": ..., "timestamp": ...}}
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from hashpanel.errors import HashpanelError
from hashpanel.utils.logger import get_logger

logger = get_logger()


def error_response(
    message: str,
    code: str,
    status_code: int,
    *,
    details: dict[str, Any] | None = None,
    timestamp: str | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Monta uma resposta de erro no formato padrão da API."""
    from datetime import UTC, datetime

    payload = {
        "error": {
            "message": message,
            "code": code,
            "details": details or {},
            "timestamp": timestamp or datetime.now(UTC).isoformat(),
        }
    }
    return JSONResponse(status_code=status_code, content=payload, headers=headers)


async def hashpanel_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handler dos erros do domínio."""
    error = exc if isinstance(exc, HashpanelError) else None
    if error is None:
        return await generic_error_handler(request, exc)

    logger.error(
        "Request error",
        error=error.message,
        code=error.code,
        method=request.method,
        url=str(request.url),
    )
    return error_response(
        error.message,
        error.code,
        error.status_code,
        details=error.details,
        timestamp=error.timestamp,
    )


async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handler para qualquer erro não previsto."""
    logger.error(
        "Unhandled request error",
        error=str(exc),
        error_type=type(exc).__name__,
        method=request.method,
        url=str(request.url),
        exc_info=True,
    )
    return error_response("Internal server error", "INTERNAL_ERROR", 500)


async def not_found_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handler das rotas inexistentes."""
    logger.warning("Route not found", method=request.method, url=str(request.url))
    return error_response(
        "Route not found",
        "NOT_FOUND",
        404,
        details={"method": request.method, "url": str(request.url)},
    )
