"""Hierarquia de erros do HashPanel.

Cada erro carrega um ``code`` estável e um ``status_code`` HTTP. O handler
centralizado em :mod:`hashpanel.server.errors` usa esses campos para montar a
resposta de erro, então o formato ``{"error": {...}}`` é consistente em todas
as rotas.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


class HashpanelError(Exception):
    """Base de todos os erros do HashPanel."""

    code = "UNKNOWN_ERROR"
    status_code = 500

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}
        self.timestamp = datetime.now(UTC).isoformat()

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "message": self.message,
            "code": self.code,
            "details": self.details,
            "timestamp": self.timestamp,
        }
        return payload


class ConfigurationError(HashpanelError):
    """Configuração ausente ou inválida."""

    code = "CONFIG_ERROR"
    status_code = 500


class ApiError(HashpanelError):
    """Falha ao falar com a API do Mastodon."""

    code = "API_ERROR"
    status_code = 502

    def __init__(
        self,
        message: str,
        *,
        original_error: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        merged = dict(details or {})
        if original_error is not None:
            merged.setdefault("originalError", original_error)
        super().__init__(message, details=merged)


class ValidationError(HashpanelError):
    """Entrada do usuário inválida."""

    code = "VALIDATION_ERROR"
    status_code = 400

    def __init__(
        self,
        message: str,
        *,
        field: str | None = None,
        value: Any = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        merged = dict(details or {})
        merged.setdefault("field", field)
        merged.setdefault("value", value)
        super().__init__(message, details=merged)


class RateLimitError(HashpanelError):
    """Limite de requisições da API do Mastodon atingido."""

    code = "RATE_LIMIT_ERROR"
    status_code = 429

    def __init__(
        self, message: str = "Rate limit exceeded", *, retry_after: int | None = None
    ) -> None:
        super().__init__(message, details={"retryAfter": retry_after})


class DataProcessingError(HashpanelError):
    """Dados recebidos não puderam ser processados."""

    code = "DATA_PROCESSING_ERROR"
    status_code = 422

    def __init__(
        self,
        message: str,
        *,
        step: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        merged = dict(details or {})
        merged.setdefault("step", step)
        super().__init__(message, details=merged)


class AuthenticationError(HashpanelError):
    """Credenciais ausentes, inválidas ou expiradas."""

    code = "AUTH_ERROR"
    status_code = 401


class BusinessError(HashpanelError):
    """Regra de negócio impediu a operação."""

    code = "BUSINESS_ERROR"
    status_code = 422

    def __init__(
        self,
        message: str,
        *,
        operation: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        merged = dict(details or {})
        merged.setdefault("operation", operation)
        super().__init__(message, details=merged)


class NotFoundError(HashpanelError):
    """Recurso não encontrado."""

    code = "NOT_FOUND"
    status_code = 404

    def __init__(self, message: str = "Resource not found", *, resource: str | None = None) -> None:
        super().__init__(message, details={"resource": resource})
