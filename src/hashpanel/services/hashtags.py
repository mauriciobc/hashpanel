"""Análise de hashtags: posts, estatísticas e tags em alta."""

from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import Any

from hashpanel.config import get_settings
from hashpanel.constants import HASHTAGS, get_first_hashtag_for_day, get_hashtags_for_day
from hashpanel.errors import BusinessError, NotFoundError
from hashpanel.services.mastodon import get_mastodon_service
from hashpanel.services.processor import get_toot_processor
from hashpanel.utils.jscompat import js_round_1, parse_int
from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import (
    day_of_week,
    get_current_date_in_timezone,
    parse_and_validate_timezone,
)

logger = get_logger()

ALLOWED_TIMEFRAMES = ("today", "week", "month", "all")


class TTLCache:
    """Cache em memória com TTL, thread-safe."""

    def __init__(self, ttl_seconds: int = 300) -> None:
        self.ttl_seconds = ttl_seconds
        self._data: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                self.misses += 1
                return None
            expires_at, value = entry
            if expires_at < time.monotonic():
                del self._data[key]
                self.misses += 1
                return None
            self.hits += 1
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = (time.monotonic() + self.ttl_seconds, value)

    def flush(self) -> None:
        with self._lock:
            self._data.clear()
            self.hits = 0
            self.misses = 0

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._data)


class HashtagAnalysis:
    """Resultado da análise de uma hashtag."""

    def __init__(
        self,
        hashtag: str,
        today: str,
        toots: list[dict[str, Any]],
        history: list[dict[str, Any]] | None = None,
        timeframe: str = "today",
    ) -> None:
        self.hashtag = hashtag
        self.today = today
        self.toots = toots
        self.history = history or []
        self.timeframe = timeframe
        self.created_at = datetime.now().astimezone().isoformat()
        self._stats: dict[str, Any] | None = None

    def _calculate_stats(self) -> dict[str, Any]:
        """Estatísticas agregadas dos posts (calculadas uma vez)."""
        if self._stats is not None:
            return self._stats

        user_counts: dict[str, int] = {}
        total_favorites = total_boosts = total_replies = 0
        total_relevance = 0.0

        for toot in self.toots:
            total_relevance += toot.get("relevanceScore") or 0
            username = (toot.get("account") or {}).get("username") or ""
            user_counts[username] = user_counts.get(username, 0) + 1
            total_favorites += toot.get("favourites_count") or 0
            total_boosts += toot.get("reblogs_count") or 0
            total_replies += toot.get("replies_count") or 0

        count = len(self.toots)
        self._stats = {
            "totalRelevance": total_relevance,
            "userCounts": user_counts,
            "engagement": {
                "totalFavorites": total_favorites,
                "totalBoosts": total_boosts,
                "totalReplies": total_replies,
            },
            "averageRelevance": js_round_1(total_relevance / count) if count else 0,
            "averageFavorites": js_round_1(total_favorites / count) if count else 0,
            "averageBoosts": js_round_1(total_boosts / count) if count else 0,
            "averageReplies": js_round_1(total_replies / count) if count else 0,
            "mostActiveUsers": [
                {"username": username, "count": count_}
                for username, count_ in sorted(
                    user_counts.items(), key=lambda item: item[1], reverse=True
                )
            ],
        }
        return self._stats

    def has_today_toots(self) -> bool:
        """Há posts no timeframe corrente?"""
        return len(self.toots) > 0

    def get_today_count(self) -> int:
        """Quantidade de posts do dia (no fuso configurado).

        Contamos a partir dos posts já filtrados pelo dia local — é a mesma
        métrica que o coletor grava, então painel e histórico não divergem.
        """
        return len(self.toots)

    def get_unique_user_count(self) -> int:
        """Participantes únicos do dia (no fuso configurado).

        Contamos por **id da conta**, não por nome: o mesmo nome pode existir
        em instâncias diferentes (``@joao@exemplo.com`` e
        ``@joao@outro.com`` são pessoas distintas).
        """
        accounts = {
            (toot.get("account") or {}).get("id")
            for toot in self.toots
            if (toot.get("account") or {}).get("id")
        }
        if accounts:
            return len(accounts)

        # Sem posts no dia, cai no histórico agregado da API.
        if self.history:
            return parse_int(self.history[0].get("accounts"))
        return 0

    def get_weekly_total(self) -> int:
        """Total de usos na janela do histórico."""
        if not self.history:
            return 0
        return sum(parse_int(day.get("uses")) for day in self.history)

    def get_top_toots(self, count: int = 5) -> list[dict[str, Any]]:
        """Posts mais relevantes (já vêm ordenados)."""
        return self.toots[:count]

    def get_average_relevance(self) -> float:
        """Relevância média dos posts."""
        if not self.toots:
            return 0
        return self._calculate_stats()["averageRelevance"]

    def get_most_active_users(self, count: int = 5) -> list[dict[str, Any]]:
        """Participantes que mais postaram."""
        return self._calculate_stats()["mostActiveUsers"][:count]

    def get_engagement_stats(self) -> dict[str, Any]:
        """Métricas de engajamento."""
        if not self.toots:
            return {
                "totalFavorites": 0,
                "totalBoosts": 0,
                "totalReplies": 0,
                "averageFavorites": 0,
                "averageBoosts": 0,
                "averageReplies": 0,
            }
        stats = self._calculate_stats()
        return {
            "totalFavorites": stats["engagement"]["totalFavorites"],
            "totalBoosts": stats["engagement"]["totalBoosts"],
            "totalReplies": stats["engagement"]["totalReplies"],
            "averageFavorites": stats["averageFavorites"],
            "averageBoosts": stats["averageBoosts"],
            "averageReplies": stats["averageReplies"],
        }

    def to_dict(self) -> dict[str, Any]:
        """Representação serializável da análise."""
        return {
            "hashtag": self.hashtag,
            "today": self.today,
            "summary": {
                "tootCount": self.get_today_count(),
                "uniqueUsers": self.get_unique_user_count(),
                "weeklyTotal": self.get_weekly_total(),
                "averageRelevance": self.get_average_relevance(),
            },
            "topToots": [
                {
                    "id": toot.get("id"),
                    "username": (toot.get("account") or {}).get("username"),
                    "relevanceScore": toot.get("relevanceScore"),
                    "favorites": toot.get("favourites_count"),
                    "boosts": toot.get("reblogs_count"),
                }
                for toot in self.get_top_toots(5)
            ],
            "mostActiveUsers": self.get_most_active_users(5),
            "engagement": self.get_engagement_stats(),
            "createdAt": self.created_at,
        }


class HashtagService:
    """Consultas de hashtags usadas pelo dashboard e pelo bot."""

    def __init__(self) -> None:
        settings = get_settings()
        self.cache = TTLCache(settings.cache_ttl_seconds if settings.enable_cache else 0)
        self.mastodon = get_mastodon_service()
        self.processor = get_toot_processor()

    # --- hashtags do dia ---
    def get_daily_hashtag(self, *, timezone: str | None = None) -> str:
        """Primeira hashtag configurada para o dia de hoje."""
        zone = parse_and_validate_timezone(timezone)
        weekday = day_of_week(datetime.now(), zone)
        entry = HASHTAGS[weekday]
        if not entry:
            raise BusinessError(f"No hashtag configured for day {weekday}")
        return get_first_hashtag_for_day(entry)

    def get_daily_hashtags(self, *, timezone: str | None = None) -> list[str]:
        """Todas as hashtags configuradas para o dia de hoje."""
        zone = parse_and_validate_timezone(timezone)
        weekday = day_of_week(datetime.now(), zone)
        return get_hashtags_for_day(HASHTAGS[weekday])

    # --- análise ---
    async def analyze_hashtag_async(
        self,
        hashtag: str,
        *,
        max_pages: int | None = None,
        timeframe: str = "today",
        timezone: str | None = None,
        limit: int | None = None,
    ) -> HashtagAnalysis:
        """Analisa uma hashtag sem bloquear o event loop do servidor.

        A biblioteca do Mastodon é síncrona, então a análise roda em uma thread.
        """
        import asyncio

        return await asyncio.to_thread(
            self.analyze_hashtag,
            hashtag,
            max_pages=max_pages,
            timeframe=timeframe,
            timezone=timezone,
            limit=limit,
        )

    async def get_hashtag_history_async(self, hashtag: str) -> list[dict[str, Any]]:
        """Histórico de uma hashtag, sem bloquear o event loop."""
        import asyncio

        return await asyncio.to_thread(self.get_hashtag_history, hashtag)

    async def get_trending_tags_async(self, limit: int = 10, offset: int = 0) -> dict[str, Any]:
        """Tags em alta, sem bloquear o event loop."""
        import asyncio

        return await asyncio.to_thread(self.get_trending_tags, limit, offset)

    def analyze_hashtag(
        self,
        hashtag: str,
        *,
        max_pages: int | None = None,
        timeframe: str = "today",
        timezone: str | None = None,
        limit: int | None = None,
    ) -> HashtagAnalysis:
        """Analisa uma hashtag e devolve posts, métricas e histórico."""
        if not hashtag:
            raise BusinessError("Hashtag is required")

        settings = get_settings()
        zone = parse_and_validate_timezone(timezone, fallback=settings.preferred_timezone)

        normalized_timeframe = timeframe if timeframe in ALLOWED_TIMEFRAMES else "all"
        if normalized_timeframe != timeframe:
            logger.warning("Invalid timeframe provided, normalizing to 'all'", timeframe=timeframe)

        pages = max_pages or settings.max_api_pages
        cache_key = f"analysis_{hashtag}_{pages}_{normalized_timeframe}_{zone}"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        today = get_current_date_in_timezone(zone)

        toots = self.fetch_all_toots(hashtag, max_pages=pages)
        history = self.get_hashtag_history(hashtag)

        process_options: dict[str, Any] = {"timezone": zone}
        if limit:
            process_options["limit"] = limit
        if normalized_timeframe == "today":
            process_options["filter_by_date"] = today
        elif normalized_timeframe != "all":
            process_options["timeframe"] = normalized_timeframe

        processed = self.processor.process(toots, **process_options)
        analysis = HashtagAnalysis(hashtag, today, processed, history, normalized_timeframe)

        self.cache.set(cache_key, analysis)
        return analysis

    def fetch_all_toots(
        self, hashtag: str, *, max_pages: int | None = None
    ) -> list[dict[str, Any]]:
        """Posts de uma hashtag, com cache diário."""
        settings = get_settings()
        cache_key = f"toots_{hashtag}_{get_current_date_in_timezone(settings.preferred_timezone)}"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        toots = self.mastodon.fetch_all_toots(hashtag, max_pages or settings.max_api_pages)
        self.cache.set(cache_key, toots)
        return toots

    def get_hashtag_history(self, hashtag: str) -> list[dict[str, Any]]:
        """Série de uso de uma hashtag (vazia em caso de falha)."""
        try:
            return self.mastodon.get_hashtag_history(hashtag)
        except Exception as exc:
            logger.warning("Failed to get hashtag history", hashtag=hashtag, error=str(exc))
            return []

    # --- tags em alta ---
    def get_trending_tags(self, limit: int = 10, offset: int = 0) -> dict[str, Any]:
        """Tags em alta, paginadas sobre um cache local.

        A API só oferece um total confiável quando buscamos o limite máximo,
        então buscamos tudo uma vez e paginamos em memória.
        """
        tags_key = "trending_tags_all"
        total_key = "trending_tags_total"

        all_tags = self.cache.get(tags_key)
        total_count = self.cache.get(total_key)

        if all_tags is None or total_count is None:
            try:
                all_tags = self.mastodon.get_trending_tags(100, 0)
            except Exception as exc:
                logger.warning("Failed to fetch trending tags", error=str(exc))
                return {"tags": [], "totalCount": None}

            total_count = len(all_tags)
            self.cache.set(tags_key, all_tags)
            self.cache.set(total_key, total_count)

        return {
            "tags": all_tags[offset : offset + limit],
            "totalCount": total_count,
        }

    def get_weekly_stats(self, hashtag: str) -> dict[str, Any]:
        """Estatísticas dos últimos 7 dias a partir do histórico da API."""
        history = self.get_hashtag_history(hashtag)
        if not history:
            raise NotFoundError(f"No history found for hashtag: {hashtag}")

        weekly = history[-7:]
        total_uses = sum(parse_int(day.get("uses")) for day in weekly)

        return {
            "hashtag": hashtag,
            "period": "7 days",
            "totalUses": total_uses,
            "dailyAverage": round(total_uses / len(weekly)) if weekly else 0,
            "history": weekly,
        }

    # --- diagnóstico ---
    def clear_cache(self) -> None:
        """Limpa o cache do serviço."""
        self.cache.flush()

    def get_stats(self) -> dict[str, Any]:
        """Estatísticas do cache."""
        return {
            "cacheSize": self.cache.size,
            "cacheTTL": get_settings().cache_ttl_seconds,
            "hits": self.cache.hits,
            "misses": self.cache.misses,
        }


_service: HashtagService | None = None


def get_hashtag_service() -> HashtagService:
    """Instância única do serviço de hashtags."""
    global _service
    if _service is None:
        _service = HashtagService()
    return _service


def reset_hashtag_service() -> None:
    """Descarta a instância (usado nos testes)."""
    global _service
    _service = None
