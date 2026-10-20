"""Pipeline de processamento dos posts.

Ordem: validação estrutural, remoção de contas ignoradas, cálculo de
relevância, ordenação e — opcionalmente — filtros de data, janela de tempo e
limite de quantidade.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from hashpanel.constants import IGNORED_ACCOUNTS
from hashpanel.errors import DataProcessingError
from hashpanel.services.relevance import RelevanceCalculator, get_relevance_calculator
from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import (
    convert_date_between_timezones,
    day_of_week,
    get_current_datetime,
    to_datetime,
)

logger = get_logger()

ALLOWED_TIMEFRAMES = ("today", "week", "month", "all")

# Janelas, em dias, para cada timeframe.
TIMEFRAME_DAYS = {"week": 7, "month": 30}


class TootProcessor:
    """Aplica o pipeline completo a uma lista de posts."""

    def __init__(self, relevance_calculator: RelevanceCalculator | None = None) -> None:
        self.relevance_calculator = relevance_calculator or get_relevance_calculator()
        self.total_processed = 0
        self.valid_toots = 0
        self.ignored_toots = 0
        self.errors = 0

    # --- pipeline ---
    def process(self, toots: list[dict[str, Any]], **options: Any) -> list[dict[str, Any]]:
        """Processa os posts e devolve a lista final, ordenada por relevância."""
        if not isinstance(toots, list):
            raise DataProcessingError("Input must be an array of toots", step="pipeline_processing")

        stats = {
            "totalProcessed": len(toots),
            "validToots": 0,
            "ignoredToots": 0,
            "errors": 0,
        }

        try:
            processed = self.filter_valid(toots, stats)
            processed = self.remove_ignored_accounts(processed, stats)
            processed = self.calculate_relevance(processed, stats)
            processed = self.sort_by_relevance(processed)

            timezone = options.get("timezone")

            if options.get("filter_by_date"):
                processed = self.filter_by_date(processed, options["filter_by_date"], timezone)

            if options.get("timeframe"):
                processed = self.filter_by_timeframe(processed, options["timeframe"], timezone)

            limit = options.get("limit")
            if limit:
                processed = processed[: int(limit)]

            self.total_processed += stats["totalProcessed"]
            self.valid_toots += stats["validToots"]
            self.ignored_toots += stats["ignoredToots"]
            self.errors += stats["errors"]

            return processed
        except DataProcessingError:
            raise
        except Exception as exc:
            raise DataProcessingError(
                f"Toot processing failed: {exc}",
                step="pipeline_processing",
                details={"inputCount": len(toots)},
            ) from exc

    # --- etapas ---
    def filter_valid(
        self, toots: list[dict[str, Any]], stats: dict[str, int] | None = None
    ) -> list[dict[str, Any]]:
        """Remove posts com estrutura inválida."""
        counters = stats if stats is not None else {}
        valid: list[dict[str, Any]] = []

        for toot in toots:
            if self.is_valid(toot):
                valid.append(toot)
                counters["validToots"] = counters.get("validToots", 0) + 1
            else:
                counters["errors"] = counters.get("errors", 0) + 1

        return valid

    @staticmethod
    def is_valid(toot: Any) -> bool:
        """Indica se o post tem os campos obrigatórios."""
        if not isinstance(toot, dict):
            return False

        for field in ("id", "created_at", "content"):
            if field not in toot:
                return False

        account = toot.get("account")
        if not isinstance(account, dict):
            return False

        for field in ("id", "username"):
            if field not in account:
                return False

        for field in ("favourites_count", "reblogs_count"):
            if field in toot:
                value = toot[field]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                    return False

        return True

    def remove_ignored_accounts(
        self, toots: list[dict[str, Any]], stats: dict[str, int] | None = None
    ) -> list[dict[str, Any]]:
        """Remove posts de contas de trending automatizado."""
        counters = stats if stats is not None else {}
        kept: list[dict[str, Any]] = []

        for toot in toots:
            account = toot.get("account") or {}
            if account.get("username") in IGNORED_ACCOUNTS:
                counters["ignoredToots"] = counters.get("ignoredToots", 0) + 1
                continue
            kept.append(toot)

        return kept

    def calculate_relevance(
        self, toots: list[dict[str, Any]], stats: dict[str, int] | None = None
    ) -> list[dict[str, Any]]:
        """Calcula a relevância de cada post (descarta os que falham)."""
        counters = stats if stats is not None else {}
        scored: list[dict[str, Any]] = []

        for toot in toots:
            try:
                scored.append(self.relevance_calculator.calculate_relevance(toot))
            except DataProcessingError:
                counters["errors"] = counters.get("errors", 0) + 1

        return scored

    @staticmethod
    def sort_by_relevance(toots: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Ordena por relevância decrescente."""
        return sorted(toots, key=lambda toot: toot.get("relevanceScore") or 0, reverse=True)

    # --- filtros ---
    def filter_by_date(
        self,
        toots: list[dict[str, Any]],
        target_date: str,
        timezone: str | None = None,
    ) -> list[dict[str, Any]]:
        """Mantém apenas os posts do dia informado, no fuso escolhido."""
        if not target_date:
            raise DataProcessingError(
                "Target date is required for date filtering", step="filter_date"
            )

        from hashpanel.utils.timezone import parse_and_validate_timezone

        zone = parse_and_validate_timezone(timezone)
        normalized = target_date.strip()

        kept: list[dict[str, Any]] = []
        for toot in toots:
            try:
                created = to_datetime(toot.get("created_at"))
                local_date = convert_date_between_timezones(created, "UTC", zone).strftime(
                    "%Y-%m-%d"
                )
            except (TypeError, ValueError):
                continue
            if local_date == normalized:
                kept.append(toot)

        return kept

    def filter_by_timeframe(
        self,
        toots: list[dict[str, Any]],
        timeframe: str,
        timezone: str | None = None,
    ) -> list[dict[str, Any]]:
        """Mantém os posts dentro da janela (hoje, 7 dias, 30 dias ou tudo)."""
        if not timeframe or timeframe == "all":
            return toots

        from hashpanel.utils.timezone import parse_and_validate_timezone

        zone = parse_and_validate_timezone(timezone)
        normalized = timeframe.lower()

        if normalized not in TIMEFRAME_DAYS:
            logger.warning("Unknown timeframe, returning all toots", timeframe=timeframe)
            return toots

        cutoff = get_current_datetime(zone).date() - _timedelta_days(TIMEFRAME_DAYS[normalized])

        kept: list[dict[str, Any]] = []
        for toot in toots:
            try:
                created = to_datetime(toot.get("created_at"))
            except (TypeError, ValueError):
                continue
            local_date = convert_date_between_timezones(created, "UTC", zone).date()
            if local_date >= cutoff:
                kept.append(toot)

        return kept

    # --- estatísticas ---
    def get_stats(self) -> dict[str, Any]:
        """Estatísticas do pipeline."""
        return {
            "totalProcessed": self.total_processed,
            "validToots": self.valid_toots,
            "ignoredToots": self.ignored_toots,
            "errors": self.errors,
            "relevanceCalculator": self.relevance_calculator.get_stats(),
        }

    def reset_stats(self) -> None:
        """Zera as estatísticas."""
        self.total_processed = 0
        self.valid_toots = 0
        self.ignored_toots = 0
        self.errors = 0


def _timedelta_days(days: int) -> Any:
    from datetime import timedelta

    return timedelta(days=days)


def day_of_week_for(moment: datetime, timezone: str) -> int:
    """Dia da semana (0 = domingo) de um instante no fuso indicado."""
    return day_of_week(moment, timezone)


_processor: TootProcessor | None = None


def get_toot_processor() -> TootProcessor:
    """Instância única do processador."""
    global _processor
    if _processor is None:
        _processor = TootProcessor()
    return _processor
