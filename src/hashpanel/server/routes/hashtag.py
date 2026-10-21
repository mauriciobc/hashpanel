"""Rotas de hashtag — o núcleo do dashboard."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query, Response

from hashpanel.constants import (
    DAY_NAMES,
    HASHTAGS,
    MAX_PAGES_BY_TIMEFRAME,
    get_first_hashtag_for_day,
    get_hashtags_for_day,
)
from hashpanel.database.repository import HashtagHistoryRepository
from hashpanel.errors import NotFoundError, RateLimitError
from hashpanel.server.errors import error_response
from hashpanel.services.hashtags import get_hashtag_service
from hashpanel.utils.jscompat import js_round_1, parse_int
from hashpanel.utils.logger import get_logger
from hashpanel.utils.validators import validate_timezone_parameter

logger = get_logger()

router = APIRouter()
repository = HashtagHistoryRepository()


def _max_pages_for_timeframe(timeframe: str) -> int:
    """Quantas páginas buscar para um timeframe."""
    from hashpanel.config import get_settings

    base = MAX_PAGES_BY_TIMEFRAME.get(timeframe, 1)
    return min(base, get_settings().max_api_pages)


def _normalize_hashtag(hashtag: str) -> str:
    """Remove o ``#`` inicial e valida o formato."""
    clean = hashtag[1:] if hashtag.startswith("#") else hashtag
    if not clean:
        raise NotFoundError("Hashtag not found", resource=hashtag)
    return clean


@router.get("/current")
async def current_hashtag(
    timezone: str | None = Query(None),
) -> dict[str, Any]:
    """Hashtag do dia, calculada no fuso do cliente (ou do servidor)."""
    from hashpanel.utils.timezone import day_of_week, get_current_datetime

    validated = validate_timezone_parameter(timezone)
    now = get_current_datetime(validated)

    return {
        "hashtag": get_hashtag_service().get_daily_hashtag(timezone=validated),
        "date": now.strftime("%Y-%m-%d"),
        "dayOfWeek": day_of_week(now, validated),
        "timezone": validated,
        "serverTimezone": _server_timezone(),
    }


@router.get("/daily")
async def daily_hashtags(
    timezone: str | None = Query(None),
) -> dict[str, Any]:
    """Grade semanal de hashtags, com a marcação do dia atual no fuso pedido."""
    from hashpanel.utils.timezone import day_of_week, get_current_datetime

    validated = validate_timezone_parameter(timezone)
    now = get_current_datetime(validated)
    today_index = day_of_week(now, validated)

    schedule = []
    for index, entry in enumerate(HASHTAGS):
        hashtags = get_hashtags_for_day(entry)
        schedule.append(
            {
                "day": index,
                "name": DAY_NAMES[index],
                "hashtag": get_first_hashtag_for_day(entry),
                "hashtags": hashtags,
                "isToday": index == today_index,
            }
        )

    return {
        "dailySchedule": schedule,
        "current": {
            "day": today_index,
            "hashtag": get_first_hashtag_for_day(HASHTAGS[today_index]),
        },
        "generatedAt": now.isoformat(),
        "timezone": validated,
    }


@router.get("/history/weekly")
async def all_hashtags_weekly_history(
    year: int | None = Query(None, ge=2020, le=2100),
    response: Response = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    """Histórico semanal de todas as hashtags num ano."""
    target_year = year or datetime.now().year
    data = repository.get_all_hashtags_weekly_history(target_year)

    if response is not None:
        response.headers["Cache-Control"] = "public, max-age=300"
        response.headers["Vary"] = "Accept-Encoding"

    return {
        "year": target_year,
        "data": data,
        "summary": {
            "year": target_year,
            "totalHashtags": len(data),
            "hashtags": list(data.keys()),
        },
    }


@router.get("/{hashtag}/stats")
async def hashtag_stats(
    hashtag: str,
    timeframe: str = Query("today", pattern="^(today|week|month|all)$"),
    timezone: str | None = Query(None),
    response: Response = None,  # type: ignore[assignment]
) -> Any:
    """Estatísticas de uma hashtag (o que o dashboard exibe)."""
    normalized = _normalize_hashtag(hashtag)
    validated_timezone = validate_timezone_parameter(timezone)

    try:
        analysis = await get_hashtag_service().analyze_hashtag_async(
            normalized,
            max_pages=_max_pages_for_timeframe(timeframe),
            timeframe=timeframe,
            timezone=validated_timezone,
        )
    except RateLimitError:
        return error_response(
            "Limite de requisições da API do Mastodon atingido. Aguarde alguns minutos.",
            "RATE_LIMIT_EXCEEDED",
            429,
        )
    except NotFoundError:
        return error_response(
            f"A hashtag #{normalized} não foi encontrada ou não possui dados recentes.",
            "HASHTAG_NOT_FOUND",
            404,
            details={
                "hashtag": normalized,
                "suggestion": "Tente outra hashtag ou aguarde novos posts.",
            },
        )

    if response is not None:
        response.headers["Cache-Control"] = "public, max-age=120"
        response.headers["Vary"] = "Accept-Encoding"

    return {
        "hashtag": normalized,
        "timeframe": timeframe,
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
                "content": _truncate(toot.get("content") or "", 300),
                "favorites": toot.get("favourites_count"),
                "boosts": toot.get("reblogs_count"),
                "replies": toot.get("replies_count"),
                "relevance": toot.get("relevanceScore"),
                "createdAt": toot.get("created_at"),
                "link": toot.get("url"),
                "followers": (toot.get("account") or {}).get("followers_count"),
                "media": toot.get("media_attachments") or [],
            }
            for toot in analysis.get_top_toots(10)
        ],
        "mostActiveUsers": analysis.get_most_active_users(10),
        "metadata": {
            "generatedAt": analysis.created_at,
            "timezone": validated_timezone,
            "serverTimezone": _server_timezone(),
            "clientTimezone": timezone,
        },
    }


@router.get("/{hashtag}/timeline")
async def hashtag_timeline(
    hashtag: str,
    days: int = Query(7, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Série temporal de uso da hashtag nos últimos dias."""
    normalized = _normalize_hashtag(hashtag)
    service = get_hashtag_service()

    history = await service.get_hashtag_history_async(normalized)
    analysis = await service.analyze_hashtag_async(normalized, limit=limit)

    timeline = [
        {
            "date": day.get("day"),
            "uses": parse_int(day.get("uses")),
            "accounts": day.get("accounts") or 0,
            "averageRelevance": 0,
        }
        for day in history[-days:]
    ]

    total_uses = sum(day["uses"] for day in timeline)
    average_daily = round(total_uses / len(timeline)) if timeline else 0

    peak_day = {"date": None, "uses": 0, "accounts": 0, "averageRelevance": 0}
    for day in timeline:
        if day["uses"] > peak_day["uses"]:
            peak_day = day

    return {
        "hashtag": normalized,
        "period": f"last {days} days",
        "timeline": timeline,
        "summary": {
            "totalUses": total_uses,
            "averageDaily": average_daily,
            "peakDay": peak_day,
            "activeDays": len([day for day in timeline if day["uses"] > 0]),
        },
        "recentActivity": {
            "tootCount": analysis.get_today_count(),
            "uniqueUsers": analysis.get_unique_user_count(),
            "topToots": [
                {
                    "id": toot.get("id"),
                    "author": (toot.get("account") or {}).get("username"),
                    "relevance": toot.get("relevanceScore"),
                }
                for toot in analysis.get_top_toots(5)
            ],
        },
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.get("/{hashtag}/analysis")
async def hashtag_analysis(
    hashtag: str,
    include_toots: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    """Análise completa de uma hashtag."""
    normalized = _normalize_hashtag(hashtag)
    analysis = await get_hashtag_service().analyze_hashtag_async(normalized, limit=limit)

    payload = analysis.to_dict()
    if include_toots:
        payload["allToots"] = [
            {
                "id": toot.get("id"),
                "author": (toot.get("account") or {}).get("username"),
                "content": toot.get("content"),
                "favorites": toot.get("favourites_count"),
                "boosts": toot.get("reblogs_count"),
                "replies": toot.get("replies_count"),
                "relevance": toot.get("relevanceScore"),
                "createdAt": toot.get("created_at"),
            }
            for toot in analysis.toots
        ]

    return payload


@router.get("/{hashtag}/users")
async def hashtag_users(hashtag: str, limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    """Participantes mais ativos de uma hashtag."""
    normalized = _normalize_hashtag(hashtag)
    analysis = await get_hashtag_service().analyze_hashtag_async(normalized)

    enriched = []
    for user in analysis.get_most_active_users(limit):
        username = user["username"]
        user_toots = [
            toot
            for toot in analysis.toots
            if (toot.get("account") or {}).get("username") == username
        ]
        total_favorites = sum(toot.get("favourites_count") or 0 for toot in user_toots)
        total_boosts = sum(toot.get("reblogs_count") or 0 for toot in user_toots)
        average_relevance = (
            sum(toot.get("relevanceScore") or 0 for toot in user_toots) / len(user_toots)
            if user_toots
            else 0
        )
        top_post = max(user_toots, key=lambda toot: toot.get("relevanceScore") or 0, default=None)

        enriched.append(
            {
                "username": username,
                "postCount": user["count"],
                "totalFavorites": total_favorites,
                "totalBoosts": total_boosts,
                "averageRelevance": js_round_1(average_relevance),
                "topPost": top_post.get("id") if top_post else None,
            }
        )

    return {
        "hashtag": normalized,
        "users": enriched,
        "totalUsers": len(enriched),
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.get("/{hashtag}/history/weekly")
async def hashtag_weekly_history(
    hashtag: str,
    year: int | None = Query(None, ge=2020, le=2100),
    week: int | None = Query(None, ge=1, le=53),
    date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    daily: bool = Query(False),
    response: Response = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    """Histórico de uma hashtag: por dia, por semana ou o ano inteiro."""
    normalized = _normalize_hashtag(hashtag)
    target_year = year or datetime.now().year

    def _set_cache() -> None:
        if response is not None:
            response.headers["Cache-Control"] = "public, max-age=300"
            response.headers["Vary"] = "Accept-Encoding"

    # Um dia específico.
    if date:
        daily_data = repository.get_daily_data(normalized, date)
        if not daily_data:
            return {
                "hashtag": normalized,
                "date": date,
                "uses": 0,
                "accounts": 0,
                "year": target_year,
                "weekNumber": None,
                "type": "daily",
            }
        _set_cache()
        return {
            "hashtag": normalized,
            "date": daily_data["date"],
            "uses": daily_data["uses"],
            "accounts": daily_data["accounts"],
            "year": daily_data["year"],
            "weekNumber": daily_data["weekNumber"],
            "type": "daily",
        }

    # Uma semana específica.
    if week:
        weekly_data = repository.get_weekly_history_by_week(normalized, target_year, week)
        if not weekly_data:
            return {
                "hashtag": normalized,
                "year": target_year,
                "weekNumber": week,
                "weeklyData": [],
                "dailyData": [],
                "summary": {
                    "totalWeeks": 0,
                    "totalUses": 0,
                    "totalAccounts": 0,
                    "averageWeekly": 0,
                    "peakWeek": None,
                },
                "type": "daily" if daily else "weekly",
            }

        week_data = weekly_data[0]

        if daily and week_data["weekStart"] and week_data["weekEnd"]:
            daily_rows = repository.get_daily_history(
                normalized, week_data["weekStart"], week_data["weekEnd"]
            )
            _set_cache()
            return {
                "hashtag": normalized,
                "year": target_year,
                "weekNumber": week_data["weekNumber"],
                "weekStart": week_data["weekStart"],
                "weekEnd": week_data["weekEnd"],
                "dailyData": daily_rows,
                "summary": {
                    "totalUses": week_data["totalUses"],
                    "totalAccounts": week_data["totalAccounts"],
                    "averageDaily": week_data["dailyAverage"],
                },
                "type": "daily",
            }

        _set_cache()
        return {
            "hashtag": normalized,
            "year": target_year,
            "weeklyData": weekly_data,
            "summary": {
                "totalWeeks": 1,
                "totalUses": week_data["totalUses"],
                "totalAccounts": week_data["totalAccounts"],
                "averageWeekly": week_data["totalUses"],
                "peakWeek": {
                    "weekNumber": week_data["weekNumber"],
                    "weekStart": week_data["weekStart"],
                    "weekEnd": week_data["weekEnd"],
                    "totalUses": week_data["totalUses"],
                    "totalAccounts": week_data["totalAccounts"],
                },
            },
            "type": "weekly",
        }

    # Ano inteiro.
    result = repository.aggregate_weekly_data(normalized, target_year)
    result["type"] = "weekly"
    _set_cache()
    return result


def _truncate(text: str, limit: int) -> str:
    """Corta o texto e sinaliza com reticências quando necessário."""
    if len(text) > limit:
        return f"{text[:limit]}..."
    return text


def _server_timezone() -> str:
    """Fuso configurado no servidor."""
    from hashpanel.config import get_settings

    return get_settings().preferred_timezone
