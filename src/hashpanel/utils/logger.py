"""Logging estruturado em JSON.

Cada registro é uma linha JSON com ``timestamp``, ``level``, ``message`` e os
campos extras informados na chamada. Os logs vão para o console e para
``logs/combined.log`` / ``logs/error.log``.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import sys
from pathlib import Path
from typing import Any

LOG_DIR = Path("logs")
MAX_BYTES = 5 * 1024 * 1024
MAX_FILES = 5

_VALID_LEVELS = {"error", "warn", "info", "debug"}


class JsonFormatter(logging.Formatter):
    """Serializa o registro como JSON de uma linha."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "message": record.getMessage(),
        }
        context = getattr(record, "context", None)
        if isinstance(context, dict):
            payload.update(context)
        if record.exc_info:
            payload["stack"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class ConsoleFormatter(logging.Formatter):
    """Formato legível para o console durante o desenvolvimento."""

    def format(self, record: logging.LogRecord) -> str:
        stamp = self.formatTime(record, "%Y-%m-%d %H:%M:%S")
        base = f"{stamp} [{record.levelname}] {record.getMessage()}"
        context = getattr(record, "context", None)
        if isinstance(context, dict) and context:
            base = f"{base} {json.dumps(context, ensure_ascii=False, default=str)}"
        if record.exc_info:
            base = f"{base}\n{self.formatException(record.exc_info)}"
        return base


class StructuredLogger:
    """Envoltório do logger padrão que aceita contexto estruturado.

    Uso::

        logger.info("Coleta concluída", hashtag="tercinema", total=12)
    """

    __slots__ = ("_logger",)

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger

    def _emit(self, level: int, message: str, context: dict[str, Any]) -> None:
        self._logger.log(level, message, extra={"context": context})

    def debug(self, message: str, **context: Any) -> None:
        """Registra em nível debug."""
        self._emit(logging.DEBUG, message, context)

    def info(self, message: str, **context: Any) -> None:
        """Registra em nível info."""
        self._emit(logging.INFO, message, context)

    def warning(self, message: str, **context: Any) -> None:
        """Registra em nível warning."""
        self._emit(logging.WARNING, message, context)

    warn = warning

    def error(self, message: str, **context: Any) -> None:
        """Registra em nível error."""
        self._emit(logging.ERROR, message, context)

    def exception(self, message: str, **context: Any) -> None:
        """Registra em nível error com o traceback da exceção atual."""
        self._logger.error(message, exc_info=True, extra={"context": context})

    def log(self, level: str, message: str, **context: Any) -> None:
        """Registra em um nível arbitrário."""
        self._emit(getattr(logging, level.upper(), logging.INFO), message, context)


def _build_logger(level: str, environment: str) -> logging.Logger:
    """Monta o logger com os transports de console e arquivo."""
    logger = logging.getLogger("hashpanel")
    logger.setLevel(logging.DEBUG if environment == "development" else logging.INFO)
    logger.propagate = False

    resolved = level.lower() if level.lower() in _VALID_LEVELS else "info"

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(getattr(logging, resolved.upper(), logging.INFO))
    console.setFormatter(ConsoleFormatter())
    logger.addHandler(console)

    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        logger.warning("Não foi possível criar o diretório de logs")

    file_format = JsonFormatter()

    combined = logging.handlers.RotatingFileHandler(
        LOG_DIR / "combined.log", maxBytes=MAX_BYTES, backupCount=MAX_FILES, encoding="utf-8"
    )
    combined.setLevel(logging.DEBUG)
    combined.setFormatter(file_format)
    logger.addHandler(combined)

    errors = logging.handlers.RotatingFileHandler(
        LOG_DIR / "error.log", maxBytes=MAX_BYTES, backupCount=MAX_FILES, encoding="utf-8"
    )
    errors.setLevel(logging.ERROR)
    errors.setFormatter(file_format)
    logger.addHandler(errors)

    return logger


_logger: StructuredLogger | None = None


def get_logger() -> StructuredLogger:
    """Retorna o logger da aplicação, construindo-o na primeira chamada."""
    global _logger
    if _logger is None:
        from hashpanel.config import get_settings

        settings = get_settings()
        _logger = StructuredLogger(_build_logger(settings.log_level, settings.node_env))
    return _logger


def reset_logger() -> None:
    """Descarta o logger (usado nos testes)."""
    global _logger
    _logger = None
