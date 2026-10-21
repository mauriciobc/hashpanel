"""Coleta do histórico diário de hashtags.

O job roda por cron: para cada hashtag configurada busca o uso na API do
Mastodon e grava uma linha por dia. Já coletado não é repetido.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from hashpanel.config import get_settings
from hashpanel.constants import all_configured_hashtags
from hashpanel.database.repository import HashtagHistoryRepository
from hashpanel.services.mastodon import get_mastodon_service
from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import get_current_date_in_timezone

logger = get_logger()


class HistoryCollector:
    """Coleta e persiste o histórico de uso das hashtags."""

    def __init__(self, repository: HashtagHistoryRepository | None = None) -> None:
        self.repository = repository or HashtagHistoryRepository()
        self.mastodon = get_mastodon_service()
        self.settings = get_settings()
        self.stats: dict[str, dict[str, Any]] = {
            "allHashtags": self._empty_bucket(),
            "hashtagData": self._empty_bucket(),
            "dateRange": self._empty_bucket(),
        }

    @staticmethod
    def _empty_bucket() -> dict[str, Any]:
        return {"collected": 0, "skipped": 0, "errors": 0, "lastRun": None, "lastReset": None}

    def _reset_stats(self, operation: str) -> None:
        bucket = self.stats.get(operation)
        if bucket is None:
            return
        bucket["collected"] = 0
        bucket["skipped"] = 0
        bucket["errors"] = 0
        bucket["lastReset"] = datetime.now().astimezone().isoformat()

    def _update_stats(self, operation: str, kind: str) -> None:
        bucket = self.stats.get(operation)
        if bucket is None or kind not in bucket:
            return
        bucket[kind] += 1
        bucket["lastRun"] = datetime.now().astimezone().isoformat()

    # --- coleta ---
    def collect_hashtag_data(
        self, hashtag: str, date: str | None = None, *, operation: str = "hashtagData"
    ) -> bool:
        """Coleta o uso de uma hashtag num dia. Devolve ``True`` se gravou.

        O dia é o do fuso configurado: ``#tercinema`` é de terça-feira no
        fuso da comunidade, não no UTC.
        """
        timezone = self.settings.preferred_timezone
        target_date = date or get_current_date_in_timezone(timezone)

        try:
            if self.repository.has_data_for_date(hashtag, target_date):
                self._update_stats(operation, "skipped")
                return False

            usage = self._usage_for_local_day(hashtag, target_date, timezone)
            if usage is None:
                logger.warning(
                    "No data found for the requested day",
                    hashtag=hashtag,
                    target_date=target_date,
                    timezone=timezone,
                )
                return False

            self.repository.save_daily_data(hashtag, target_date, usage)
            self._update_stats(operation, "collected")
            logger.info(
                "Collected hashtag data",
                hashtag=hashtag,
                date=target_date,
                uses=usage["uses"],
                accounts=usage["accounts"],
            )
            return True
        except Exception as exc:
            self._update_stats(operation, "errors")
            logger.error("Failed to collect hashtag data", hashtag=hashtag, error=str(exc))
            return False

    def _usage_for_local_day(
        self, hashtag: str, target_date: str, timezone: str
    ) -> dict[str, int] | None:
        """Uso de uma hashtag num dia local, contado a partir dos posts.

        O histórico agregado da API é por dia **UTC**, e um dia UTC nunca é
        igual a um dia local (o dia local atravessa dois baldes UTC). Usar o
        agregado gravaria o número do dia vizinho, e o ``INSERT OR IGNORE``
        o congelaria. Por isso contamos os posts do dia com o mesmo pipeline
        do painel — mesmas regras, mesmo fuso, mesmas páginas — para que o
        histórico e a tela concordem.

        Sem posts do dia nas páginas buscadas, devolvemos ``None``: não há
        número confiável para gravar, e o chamador pula o dia. Uma falha de
        leitura da timeline propaga e é contada como erro pelo chamador.
        """
        from hashpanel.server.routes.hashtag import MAX_PAGES_BY_TIMEFRAME
        from hashpanel.services.processor import get_toot_processor

        # O painel busca o timeframe "today" com este mesmo teto de páginas:
        # contar os mesmos posts exige a mesma janela.
        max_pages = min(MAX_PAGES_BY_TIMEFRAME["today"], self.settings.max_api_pages)
        toots = self.mastodon.fetch_all_toots(hashtag, max_pages=max_pages)

        processed = get_toot_processor().process(
            toots, timezone=timezone, filter_by_date=target_date
        )
        if not processed:
            return None

        accounts = {
            (toot.get("account") or {}).get("id")
            for toot in processed
            if (toot.get("account") or {}).get("id")
        }
        return {"uses": len(processed), "accounts": len(accounts)}

    def collect_all_hashtags(self, date: str | None = None) -> dict[str, Any]:
        """Coleta todas as hashtags configuradas para um dia."""
        target_date = date or get_current_date_in_timezone(self.settings.preferred_timezone)
        self._reset_stats("allHashtags")

        hashtags = all_configured_hashtags()
        logger.info("Collecting history for all hashtags", count=len(hashtags), date=target_date)

        for hashtag in hashtags:
            self.collect_hashtag_data(hashtag, target_date, operation="allHashtags")

        stats = self.stats["allHashtags"]
        summary = {
            "date": target_date,
            "totalHashtags": len(hashtags),
            "collected": stats["collected"],
            "skipped": stats["skipped"],
            "errors": stats["errors"],
            "success": stats["errors"] == 0,
        }
        logger.info("History collection completed", **summary)
        return summary

    def collect_date_range(self, start_date: str, end_date: str) -> dict[str, Any]:
        """Coleta um intervalo de datas (inclusive nas duas pontas)."""
        try:
            start = date.fromisoformat(start_date)
            end = date.fromisoformat(end_date)
        except ValueError as exc:
            raise ValueError("Invalid date range provided") from exc

        if start > end:
            raise ValueError("Start date must be before end date")

        self._reset_stats("dateRange")
        summaries: list[dict[str, Any]] = []
        current = start

        while current <= end:
            date_str = current.isoformat()
            summary = self.collect_all_hashtags(date_str)
            summaries.append(summary)

            self.stats["dateRange"]["collected"] += summary["collected"]
            self.stats["dateRange"]["skipped"] += summary["skipped"]
            self.stats["dateRange"]["errors"] += summary["errors"]
            self.stats["dateRange"]["lastRun"] = datetime.now().astimezone().isoformat()

            current += timedelta(days=1)

        stats = self.stats["dateRange"]
        return {
            "dateRange": {"start": start_date, "end": end_date},
            "totalDays": len(summaries),
            "totalCollected": stats["collected"],
            "totalSkipped": stats["skipped"],
            "totalErrors": stats["errors"],
            "dailySummaries": summaries,
        }

    def get_stats(self) -> dict[str, Any]:
        """Estatísticas por operação."""
        return {"byOperation": {name: dict(bucket) for name, bucket in self.stats.items()}}
