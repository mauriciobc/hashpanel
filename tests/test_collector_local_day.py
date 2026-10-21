"""Testes do dia local na coleta de histórico.

O histórico agregado da API é por dia UTC, e um balde UTC nunca é igual a
um dia local. O coletor precisa contar os posts do dia com o mesmo pipeline
do painel e, quando o dia não tem posts, pular a gravação em vez de
congelar um número errado com ``INSERT OR IGNORE``.
"""

from __future__ import annotations

from typing import Any

from hashpanel.errors import ApiError
from hashpanel.server.routes.hashtag import MAX_PAGES_BY_TIMEFRAME
from hashpanel.services.collector import HistoryCollector
from hashpanel.services.hashtags import HashtagAnalysis
from hashpanel.services.processor import get_toot_processor
from tests.conftest import make_toot

SAO_PAULO = "America/Sao_Paulo"
TARGET_DAY = "2026-10-20"


def test_collector_writes_the_panels_numbers_for_the_local_day(repository: Any) -> None:
    """O número gravado é o do painel: mesmas regras, mesmo fuso, mesmas páginas."""
    toots = [
        make_toot("1", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
        make_toot("2", "alice", account_id="1", created_at="2026-10-20T18:00:00.000Z"),
        # 02:00 UTC de 21/10 ainda é 23:00 de 20/10 em São Paulo.
        make_toot("3", "bob", account_id="2", created_at="2026-10-21T02:00:00.000Z"),
        # Dia anterior no fuso local: fora da contagem.
        make_toot("4", "carol", account_id="3", created_at="2026-10-19T12:00:00.000Z"),
        # Estruturalmente inválido (sem ``content``): o painel o descarta.
        make_toot("5", "dave", account_id="4", created_at="2026-10-20T12:00:00.000Z"),
    ]
    del toots[-1]["content"]

    processed = get_toot_processor().process(toots, timezone=SAO_PAULO, filter_by_date=TARGET_DAY)
    analysis = HashtagAnalysis("tercinema", TARGET_DAY, processed, [])
    assert analysis.get_today_count() == 3
    assert analysis.get_unique_user_count() == 2

    pages: list[int | None] = []

    class FakeMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            pages.append(max_pages)
            return toots

    collector = HistoryCollector(repository=repository)
    collector.mastodon = FakeMastodon()

    assert collector.collect_hashtag_data("tercinema", TARGET_DAY) is True

    row = repository.get_daily_data("tercinema", TARGET_DAY)
    assert row is not None
    assert row["uses"] == analysis.get_today_count()
    assert row["accounts"] == analysis.get_unique_user_count()

    # Mesma janela de páginas do timeframe "today" do painel.
    assert pages == [min(MAX_PAGES_BY_TIMEFRAME["today"], collector.settings.max_api_pages)]


def test_no_posts_for_the_day_writes_nothing_and_does_not_poison_the_row(
    repository: Any,
) -> None:
    """Sem posts do dia local, nada é gravado — nem o balde UTC vizinho.

    O balde UTC de 21/10 vira 20/10 às 21:00 em São Paulo; a versão antiga
    casava esse balde e congelava ``uses``/``accounts`` no dia 20. Depois de
    pular, uma coleta correta ainda pode gravar a linha.
    """
    other_day = [make_toot("1", "alice", account_id="1", created_at="2026-10-19T12:00:00.000Z")]

    class NeighborBucketMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            return other_day

        def get_hashtag_history(self, hashtag: str) -> list[dict[str, Any]]:
            return [{"day": "2026-10-21T00:00:00+00:00", "uses": "12", "accounts": "5"}]

    collector = HistoryCollector(repository=repository)
    collector.mastodon = NeighborBucketMastodon()

    assert collector.collect_hashtag_data("tercinema", TARGET_DAY) is False
    assert repository.get_daily_data("tercinema", TARGET_DAY) is None

    class CorrectMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            return [
                make_toot("2", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
                make_toot("3", "bob", account_id="2", created_at="2026-10-20T13:00:00.000Z"),
            ]

    collector.mastodon = CorrectMastodon()

    assert collector.collect_hashtag_data("tercinema", TARGET_DAY) is True
    row = repository.get_daily_data("tercinema", TARGET_DAY)
    assert row is not None
    assert row["uses"] == 2
    assert row["accounts"] == 2


def test_timeline_failure_is_counted_as_an_error(repository: Any) -> None:
    """Falha ao ler a timeline não vira linha zerada: é erro na estatística."""

    class FailingMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            raise ApiError("timeline indisponível")

        def get_hashtag_history(self, hashtag: str) -> list[dict[str, Any]]:
            return [{"day": "2026-10-21T00:00:00+00:00", "uses": "12", "accounts": "5"}]

    collector = HistoryCollector(repository=repository)
    collector.mastodon = FailingMastodon()

    assert collector.collect_hashtag_data("tercinema", TARGET_DAY) is False

    stats = collector.stats["hashtagData"]
    assert stats["errors"] == 1
    assert stats["collected"] == 0
    assert repository.get_daily_data("tercinema", TARGET_DAY) is None


def test_trending_bot_on_another_hashtag_is_still_excluded(repository: Any) -> None:
    """Um bot descoberto numa hashtag não isenta os bots das outras.

    A regra é por ``username`` (a mesma do painel), não por id descoberto
    uma única vez: na segunda hashtag o bot tem outro id e ainda assim não
    pode contar como uso nem como participante.
    """

    class FakeMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            if hashtag == "primeira":
                return [
                    make_toot("1", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
                    make_toot(
                        "2", "TagsBR", account_id="99", created_at="2026-10-20T12:00:00.000Z"
                    ),
                ]
            return [
                make_toot("3", "bob", account_id="2", created_at="2026-10-20T12:00:00.000Z"),
                make_toot("4", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
                make_toot("5", "trending", account_id="98", created_at="2026-10-20T12:00:00.000Z"),
            ]

    collector = HistoryCollector(repository=repository)
    collector.mastodon = FakeMastodon()

    first = collector._usage_for_local_day("primeira", TARGET_DAY, SAO_PAULO)
    assert first == {"uses": 1, "accounts": 1}

    second = collector._usage_for_local_day("segunda", TARGET_DAY, SAO_PAULO)
    assert second == {"uses": 2, "accounts": 2}
