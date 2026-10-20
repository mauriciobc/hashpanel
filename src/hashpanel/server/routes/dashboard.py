"""Rotas do painel: visão geral do dia e sinais do sistema."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query

from hashpanel.errors import ValidationError
from hashpanel.services.hashtags import get_hashtag_service
from hashpanel.services.telemetry import get_telemetry_service
from hashpanel.utils.jscompat import parse_int
from hashpanel.utils.logger import get_logger
from hashpanel.utils.validators import validate_days_parameter, validate_timezone_parameter

logger = get_logger()

router = APIRouter()

VALID_TIMEFRAMES = ("today", "week", "month", "all")


def _instance_hashtag() -> str:
    """Hashtag do dia no fuso da instância (o painel é consistente por padrão)."""
    from hashpanel.config import get_settings

    settings = get_settings()
    return get_hashtag_service().get_daily_hashtag(timezone=settings.preferred_timezone)


@router.get("/stats")
async def dashboard_stats(
    timeframe: str = Query("today"),
    timezone: str | None = Query(None),
) -> dict[str, Any]:
    """Estatísticas completas da hashtag do dia."""
    if not isinstance(timeframe, str):
        raise ValidationError(
            f"Invalid timeframe. Must be a string, got {type(timeframe).__name__}.",
            field="timeframe",
            value=timeframe,
        )

    normalized = timeframe.lower()
    if normalized not in VALID_TIMEFRAMES:
        raise ValidationError(
            f"Invalid timeframe. Must be one of: {', '.join(VALID_TIMEFRAMES)}",
            field="timeframe",
            value=timeframe,
        )

    validate_timezone_parameter(timezone)

    from hashpanel.config import get_settings

    settings = get_settings()
    instance_timezone = settings.preferred_timezone
    hashtag = _instance_hashtag()

    analysis = await get_hashtag_service().analyze_hashtag_async(
        hashtag,
        max_pages=3,
        timeframe=normalized,
        timezone=instance_timezone,
    )

    return {
        "hashtag": hashtag,
        "timeframe": normalized,
        "date": analysis.today,
        "summary": {
            "tootCount": analysis.get_today_count(),
            "uniqueUsers": analysis.get_unique_user_count(),
            "weeklyTotal": analysis.get_weekly_total(),
            "averageRelevance": analysis.get_average_relevance(),
        },
        "engagement": analysis.get_engagement_stats(),
        "topToots": [
            {
                "id": toot.get("id"),
                "author": (toot.get("account") or {}).get("username"),
                "content": f"{(toot.get('content') or '')[:200]}...",
                "favorites": toot.get("favourites_count"),
                "boosts": toot.get("reblogs_count"),
                "relevance": toot.get("relevanceScore"),
                "link": toot.get("url"),
                "followers": (toot.get("account") or {}).get("followers_count"),
                "media": toot.get("media_attachments") or [],
            }
            for toot in analysis.get_top_toots(5)
        ],
        "mostActiveUsers": analysis.get_most_active_users(5),
        "metadata": {
            "generatedAt": datetime.now().astimezone().isoformat(),
            "timezone": instance_timezone,
        },
    }


@router.get("/summary")
async def dashboard_summary(timezone: str | None = Query(None)) -> dict[str, Any]:
    """Resumo rápido do dia."""
    validate_timezone_parameter(timezone)

    from hashpanel.config import get_settings

    instance_timezone = get_settings().preferred_timezone
    hashtag = _instance_hashtag()
    analysis = await get_hashtag_service().analyze_hashtag_async(
        hashtag, max_pages=3, timezone=instance_timezone
    )

    top_toots = analysis.get_top_toots(1)

    return {
        "hashtag": hashtag,
        "date": analysis.today,
        "hasActivity": analysis.has_today_toots(),
        "summary": {
            "tootCount": analysis.get_today_count(),
            "uniqueUsers": analysis.get_unique_user_count(),
            "weeklyTotal": analysis.get_weekly_total(),
        },
        "topPost": (
            {
                "author": (top_toots[0].get("account") or {}).get("username"),
                "relevance": top_toots[0].get("relevanceScore"),
            }
            if top_toots
            else None
        ),
        "lastUpdated": datetime.now().astimezone().isoformat(),
    }


@router.get("/timeline")
async def dashboard_timeline(
    days: int | None = Query(None),
    timezone: str | None = Query(None),
) -> dict[str, Any]:
    """Série de uso dos últimos dias da hashtag do dia."""
    validate_timezone_parameter(timezone)
    window = validate_days_parameter(days, 7, 1, 365)

    hashtag = _instance_hashtag()
    history = await get_hashtag_service().get_hashtag_history_async(hashtag)

    timeline = [
        {
            "date": day.get("day"),
            "uses": parse_int(day.get("uses")),
            "accounts": day.get("accounts") or 0,
        }
        for day in history[-window:]
    ]

    return {
        "hashtag": hashtag,
        "period": f"last {window} days",
        "timeline": timeline,
        "totalUses": sum(day["uses"] for day in timeline),
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.get("/performance")
async def dashboard_performance() -> dict[str, Any]:
    """Métricas do processo e do cache."""
    import os
    import time

    from hashpanel.config import get_settings
    from hashpanel.server.health import _memory_usage

    stats = get_hashtag_service().get_stats()

    version = ".".join(str(part) for part in os.sys.version_info[:3])

    return {
        "system": {
            "uptime": round(time.monotonic(), 3),
            "memory": _memory_usage(),
            "pid": os.getpid(),
            "pythonVersion": version,
            "environment": get_settings().node_env,
        },
        "services": {
            "hashtag": stats,
            "mastodon": "unknown",
        },
        "cache": {"hashtagService": stats["cacheSize"]},
        "timestamp": datetime.now().astimezone().isoformat(),
    }


@router.get("/alerts")
async def dashboard_alerts(timezone: str | None = Query(None)) -> dict[str, Any]:
    """Alertas do sistema: atividade do dia, cache e memória."""
    alerts: list[dict[str, Any]] = []

    hashtag = _instance_hashtag()
    analysis = await get_hashtag_service().analyze_hashtag_async(hashtag, max_pages=3)

    if not analysis.has_today_toots():
        alerts.append(
            {
                "type": "info",
                "category": "activity",
                "message": f"No activity for today's hashtag: #{hashtag}",
                "timestamp": datetime.now().astimezone().isoformat(),
                "severity": "info",
            }
        )

    cache_stats = get_hashtag_service().get_stats()
    if cache_stats["cacheSize"] > 100:
        alerts.append(
            {
                "type": "warning",
                "category": "cache",
                "message": f"Large cache size: {cache_stats['cacheSize']} items",
                "timestamp": datetime.now().astimezone().isoformat(),
                "severity": "warning",
            }
        )

    return {
        "alerts": alerts,
        "count": len(alerts),
        "timestamp": datetime.now().astimezone().isoformat(),
    }


@router.get("/telemetry")
async def dashboard_telemetry() -> dict[str, Any]:
    """Estatísticas de fuso horário dos visitantes."""
    return {
        "success": True,
        "data": get_telemetry_service().get_stats(),
        "timestamp": datetime.now().astimezone().isoformat(),
    }
