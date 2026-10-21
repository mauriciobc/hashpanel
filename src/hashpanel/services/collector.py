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
            self._validate_date(target_date)

            if self.repository.has_data_for_date(hashtag, target_date):
                self._update_stats(operation, "skipped")
                return False

            usage = self._usage_for_local_day(hashtag, target_date, timezone)
            if usage is None:
                # Sem número confiável não se grava nada. A contagem sai do
                # zero para que o resumo não anuncie uma coleta que não houve.
                self._update_stats(operation, "skipped")
                logger.warning(
                    "No posts collected for the day",
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

    @staticmethod
    def _validate_date(target_date: str) -> None:
        """Recusa uma data que não seja ``YYYY-MM-DD`` válida."""
        try:
            date.fromisoformat(target_date)
        except ValueError as exc:
            raise ValueError(f"Data inválida: {target_date!r}") from exc

    def _usage_for_local_day(
        self, hashtag: str, target_date: str, timezone: str
    ) -> dict[str, int] | None:
        """Uso de uma hashtag num dia local, contado a partir dos posts.

        O histórico agregado da API é por dia **UTC**, e um dia UTC nunca é
        igual a um dia local (o dia local atravessa dois baldes UTC). Usar o
        agregado gravaria o número do dia vizinho, e o ``INSERT OR IGNORE``
        o congelaria. Por isso contamos os posts do dia com o mesmo pipeline
        do painel — mesmas regras, mesmo fuso — para que o histórico e a
        tela concordem.

        Para o dia corrente a janela é a do painel (mesmo orçamento de
        páginas). Para um dia passado, que o painel não mostra, pagina-se
        fundo até alcançá-lo, dentro do teto configurado.

        Devolve ``None`` quando não há número confiável para gravar: dia em
        curso sem posts (um zero agora congelaria a coleta) ou dia que a
        timeline não alcança. Uma falha de leitura propaga e é contada como
        erro pelo chamador.
        """
        from hashpanel.constants import MAX_PAGES_BY_TIMEFRAME
        from hashpanel.services.processor import get_toot_processor

        target = date.fromisoformat(target_date)
        today = date.fromisoformat(get_current_date_in_timezone(timezone))

        if target >= today:
            pages = min(MAX_PAGES_BY_TIMEFRAME["today"], self.settings.max_api_pages)
        else:
            pages = self.settings.max_api_pages

        toots = self.mastodon.fetch_all_toots(hashtag, max_pages=pages)

        processed = get_toot_processor().process(
            toots, timezone=timezone, filter_by_date=target_date
        )
        if processed:
            accounts = {
                (toot.get("account") or {}).get("id")
                for toot in processed
                if (toot.get("account") or {}).get("id")
            }
            return {"uses": len(processed), "accounts": len(accounts)}

        if target >= today:
            return None

        if not self._window_reaches_day(toots, target, timezone):
            return None

        # Dia encerrado que a janela cobre por inteiro: não houve uso.
        return {"uses": 0, "accounts": 0}

    @staticmethod
    def _window_reaches_day(toots: list[dict[str, Any]], target: date, timezone: str) -> bool:
        """Indica se a janela buscada alcança o fim do dia pedido.

        Com a timeline ordenada do mais novo para o mais antigo, ver o
        post mais antigo em ``target`` ou antes significa que todos os
        posts do dia foram vistos.
        """
        from zoneinfo import ZoneInfo

        from hashpanel.utils.timezone import to_datetime

        zone = ZoneInfo(timezone)
        moments = []
        for toot in toots:
            created_at = toot.get("created_at")
            if not created_at:
                continue
            try:
                moments.append(to_datetime(created_at).astimezone(zone))
            except (TypeError, ValueError):
                continue

        if not moments:
            # Timeline vazia: não houve post em dia nenhum.
            return True
        return min(moments).date() <= target

    def collect_all_hashtags(self, date: str | None = None) -> dict[str, Any]:
        """Coleta todas as hashtags configuradas para um dia."""
        target_date = date or get_current_date_in_timezone(self.settings.preferred_timezone)
        # Valida antes de falar com a API: um erro de digitação na data
        # precisa falhar de imediato, e não virar uma coleta vazia.
        self._validate_date(target_date)
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
