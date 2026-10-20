"""Coleta do histórico diário de hashtags.

O job roda por cron: para cada hashtag configurada busca o uso na API do
Mastodon e grava uma linha por dia. Já coletado não é repetido.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from hashpanel.config import get_settings
from hashpanel.constants import IGNORED_ACCOUNTS, all_configured_hashtags
from hashpanel.database.repository import HashtagHistoryRepository
from hashpanel.services.mastodon import get_mastodon_service
from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import get_current_date_in_timezone

logger = get_logger()


def _day_to_date_string(day: Any, timezone: str | None = None) -> str:
    """Converte o ``day`` do histórico em ``YYYY-MM-DD`` **no fuso local**.

    A API do Mastodon agrega por dia UTC, mas o HashPanel acompanha o dia
    da comunidade no fuso configurado (``#tercinema`` é de terça-feira
    *aqui*). Entre 21:00 e 03:00 UTC os dois dias não coincidem, então a
    conversão precisa ser feita no fuso local — senão gravamos o número do
    dia errado.

    O valor chega em três formas, dependendo de como a resposta foi
    interpretada:

    * ``datetime`` — como a biblioteca ``Mastodon.py`` converte;
    * ``int``/``str`` numérico — timestamp Unix em segundos;
    * ``str`` — data em ISO 8601.
    """
    raw = day.get("day") if isinstance(day, dict) else day

    if isinstance(raw, datetime):
        return _to_local_date(raw, timezone)

    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return _to_local_date(datetime.fromtimestamp(float(raw), tz=UTC), timezone)

    text = str(raw).strip()
    if text.isdigit():
        return _to_local_date(datetime.fromtimestamp(int(text), tz=UTC), timezone)

    # Data em ISO 8601: o dia já vem em UTC (a API sempre devolve meia-noite
    # UTC), então convertemos para o fuso local antes de tomar a data.
    if "T" in text:
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return text.split("T", 1)[0]
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return _to_local_date(parsed, timezone)

    return text


def _to_local_date(moment: datetime, timezone: str | None) -> str:
    """Data (YYYY-MM-DD) de um instante no fuso configurado."""
    from zoneinfo import ZoneInfo

    from hashpanel.utils.timezone import parse_and_validate_timezone

    zone = ZoneInfo(parse_and_validate_timezone(timezone, fallback="UTC"))
    return moment.astimezone(zone).strftime("%Y-%m-%d")


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
        # Ids das contas de trending automatizado, descobertos sob demanda.
        self._ignored_account_ids: set[str] = set()

    def _ignored_ids_for(self, toots: list[dict[str, Any]]) -> set[str]:
        """Ids das contas ignoradas presentes nesta lista de posts.

        O ``IGNORED_ACCOUNTS`` é uma lista de nomes; a mesma pessoa pode estar
        em instâncias diferentes, então casamos pelo nome e guardamos o id
        encontrado.
        """
        if not self._ignored_account_ids:
            for toot in toots:
                account = toot.get("account") or {}
                if account.get("username") in IGNORED_ACCOUNTS and account.get("id"):
                    self._ignored_account_ids.add(str(account["id"]))
        return self._ignored_account_ids

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

        A API devolve o histórico agregado por dia **UTC**, o que não serve
        para o nosso dia local: entre 21:00 e 03:00 UTC os dias não
        coincidem. Por isso contamos os posts do dia ourselves — assim o
        número gravado é sempre o do dia da comunidade, e a mesma métrica
        que o painel mostra.

        Quando não há posts (dia sem uso), devolvemos zero, que é o que a
        API também informa nesse caso.
        """
        from zoneinfo import ZoneInfo

        from hashpanel.utils.timezone import to_datetime

        zone = ZoneInfo(timezone)
        target = date.fromisoformat(target_date)

        try:
            toots = self.mastodon.fetch_all_toots(hashtag, max_pages=1)
        except Exception:
            # Sem acesso à timeline, cai no histórico agregado da API.
            return self._usage_from_api_history(hashtag, target_date, timezone)

        todays = [
            toot
            for toot in toots
            if to_datetime(toot.get("created_at")).astimezone(zone).date() == target
        ]

        if not todays:
            # Confirma se o dia realmente não teve uso antes de gravar zero.
            history = self._usage_from_api_history(hashtag, target_date, timezone)
            if history is None:
                return None
            return {"uses": history["uses"], "accounts": history["accounts"]}

        ignored = self._ignored_ids_for(toots)
        accounts = {
            str((toot.get("account") or {}).get("id"))
            for toot in todays
            if (toot.get("account") or {}).get("id")
            and str((toot.get("account") or {}).get("id")) not in ignored
        }
        uses = len(
            [toot for toot in todays if str((toot.get("account") or {}).get("id")) not in ignored]
        )
        return {"uses": uses, "accounts": len(accounts)}

    def _usage_from_api_history(
        self, hashtag: str, target_date: str, timezone: str
    ) -> dict[str, int] | None:
        """Uso pelo histórico agregado da API, convertido para o dia local."""
        from hashpanel.utils.jscompat import parse_int

        history = self.mastodon.get_hashtag_history(hashtag)
        if not history:
            return None

        day_data = next(
            (day for day in history if _day_to_date_string(day, timezone) == target_date),
            None,
        )
        if day_data is None:
            return None

        return {
            "uses": parse_int(day_data.get("uses")),
            "accounts": parse_int(day_data.get("accounts")),
        }

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


async def run_with_concurrency(
    items: list[Any],
    handler: Callable[[Any], Any],
    *,
    concurrency: int = 3,
    min_delay_ms: int = 1000,
) -> list[Any]:
    """Executa ``handler`` com no máximo ``concurrency`` tarefas em paralelo.

    Cada slot espera ``min_delay_ms`` depois de terminar, para respeitar o
    limite de requisições da API.
    """
    semaphore = asyncio.Semaphore(max(1, concurrency))
    delay_seconds = max(0, min_delay_ms) / 1000

    async def run(item: Any) -> Any:
        async with semaphore:
            try:
                return await handler(item)
            finally:
                if delay_seconds:
                    await asyncio.sleep(delay_seconds)

    return await asyncio.gather(*(run(item) for item in items))
