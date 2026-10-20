"""Relatório de saúde do serviço."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import UTC, datetime
from typing import Any

from hashpanel.config import get_settings
from hashpanel.database.connection import get_database
from hashpanel.services.listener import get_mention_listener
from hashpanel.services.mastodon import get_mastodon_service
from hashpanel.utils.logger import get_logger

logger = get_logger()

_STARTED_AT = time.monotonic()


async def build_health_report() -> dict[str, Any]:
    """Monta o relatório de saúde e o status HTTP correspondente."""
    settings = get_settings()

    report: dict[str, Any] = {
        "status": "healthy",
        "timestamp": datetime.now(UTC).isoformat(),
        "uptime": round(time.monotonic() - _STARTED_AT, 3),
        "environment": settings.node_env,
        "version": "1.0.0",
        "services": {"mastodon": "unknown", "database": "unknown", "websocket": "unknown"},
        "memory": _memory_usage(),
    }

    try:
        # A biblioteca do Mastodon é síncrona, então a chamada acontece em uma
        # thread para não bloquear o event loop do servidor.
        await asyncio.wait_for(
            asyncio.to_thread(get_mastodon_service().get_trending_tags, 1),
            timeout=settings.healthcheck_timeout_ms / 1000,
        )
        report["services"]["mastodon"] = "healthy"
    except Exception as exc:
        logger.warning("Mastodon health check failed", error=str(exc))
        report["services"]["mastodon"] = "unhealthy"
        report["status"] = "degraded"
    try:
        db_health = get_database().health_check()
        report["services"]["database"] = db_health["status"]
        if db_health["status"] != "healthy":
            report["status"] = "degraded"
    except Exception as exc:
        logger.warning("Database health check failed", error=str(exc))
        report["services"]["database"] = "unhealthy"
        report["status"] = "degraded"

    try:
        ws_status = get_mention_listener().get_status()
        if ws_status["connected"]:
            report["services"]["websocket"] = "healthy"
            report["websocket"] = {
                "connected": True,
                "readyState": ws_status["readyState"],
                "connectionDurationMs": ws_status["connectionDurationMs"],
                "eventCount": ws_status["eventCount"],
                "timeSinceLastEventMs": ws_status["timeSinceLastEventMs"],
            }
        else:
            report["services"]["websocket"] = "unhealthy"
            report["status"] = "degraded"
            report["websocket"] = {
                "connected": False,
                "readyState": ws_status["readyState"],
                "reconnectAttempts": ws_status["reconnectAttempts"],
            }
    except Exception as exc:
        logger.debug("WebSocket status check failed", error=str(exc))
        report["services"]["websocket"] = "unknown"
        report["status"] = "degraded"
        report["websocket"] = {"connected": False}

    return report


def _memory_usage() -> dict[str, int]:
    """Uso de memória do processo, em megabytes."""
    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux devolve kilobytes; convertemos para megabytes.
        total_mb = int(usage / 1024)
    except Exception:  # pragma: no cover - dependente da plataforma
        total_mb = 0

    return {"used": total_mb, "total": total_mb, "rss": total_mb, "pid": os.getpid()}
