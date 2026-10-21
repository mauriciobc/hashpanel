"""Testes da janela de tempo ancorada no fuso configurado.

Cada hashtag pertence a um dia da semana no fuso da comunidade
(``#tercinema`` é de terça-feira *aqui*). A API do Mastodon agrega por dia
UTC, e esse balde nunca coincide com o dia local — por isso o coletor conta
os posts do próprio dia local. Estes testes travam esse comportamento.
"""

from __future__ import annotations

from typing import Any

from hashpanel.services.collector import HistoryCollector
from hashpanel.services.hashtags import HashtagAnalysis
from hashpanel.services.processor import get_toot_processor
from tests.conftest import make_toot

SAO_PAULO = "America/Sao_Paulo"
# Dia encerrado: o coletor precisa paginar até alcançá-lo, e não apenas
# repetir a janela curta que o painel usa para o dia corrente.
TARGET_DAY = "2026-10-20"


def test_counts_come_from_the_local_day() -> None:
    """A contagem de posts e participantes usa o dia local.

    O post de ``21/10 02:00Z`` ainda é ``20/10 23:00`` em São Paulo e entra
    na conta; o de ``19/10 12:00Z`` é o dia local anterior e fica de fora.
    Nenhum balde UTC é consultado.
    """
    toots = [
        make_toot("1", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
        make_toot("2", "bob", account_id="2", created_at="2026-10-20T18:00:00.000Z"),
        make_toot("3", "carol", account_id="3", created_at="2026-10-21T02:00:00.000Z"),
        make_toot("4", "dave", account_id="4", created_at="2026-10-19T12:00:00.000Z"),
    ]

    processed = get_toot_processor().process(toots, timezone=SAO_PAULO, filter_by_date=TARGET_DAY)

    assert {toot["id"] for toot in processed} == {"1", "2", "3"}
    analysis = HashtagAnalysis("tercinema", TARGET_DAY, processed, [])
    assert analysis.get_today_count() == 3
    assert analysis.get_unique_user_count() == 3


def test_unique_users_are_counted_by_account_id() -> None:
    """Usuários são distintos por id de conta, não por nome.

    ``@joao@exemplo.com`` e ``@joao@outro.com`` são duas pessoas.
    """
    first = make_toot("1", "joao", account_id="1")
    first["account"]["acct"] = "joao@exemplo.com"
    second = make_toot("2", "joao", account_id="2")
    second["account"]["acct"] = "joao@outro.com"

    analysis = HashtagAnalysis("tercinema", "2026-10-20", [first, second], [])

    assert analysis.get_unique_user_count() == 2


def _paged_timeline(tail: list[dict[str, Any]], newer: int) -> list[dict[str, Any]]:
    """Timeline do mais novo para o mais antigo, com ``tail`` além da 1ª página.

    Os ``newer`` posts recentes ocupam a primeira página inteira: uma coleta
    que só pede uma página nunca chega a ver ``tail``.
    """
    recent = [
        make_toot(
            f"recente-{index}",
            "carol",
            account_id="9",
            created_at="2026-10-21T12:00:00.000Z",
        )
        for index in range(newer)
    ]
    return recent + tail


class PagedMastodon:
    """API falsa que respeita o número de páginas pedido.

    Como a timeline real, devolve só os posts das primeiras ``max_pages``
    páginas, do mais novo para o mais antigo.
    """

    def __init__(self, feeds: dict[str, list[dict[str, Any]]], page_size: int) -> None:
        self.feeds = feeds
        self.page_size = page_size

    def fetch_all_toots(self, hashtag: str, max_pages: int | None = None) -> list[dict[str, Any]]:
        return self.feeds[hashtag][: self.page_size * (max_pages or 1)]


def test_panel_and_collector_agree_on_the_same_day(repository: Any) -> None:
    """O que o painel mostra é o que o coletor grava.

    Este é o contrato que a discrepância reportada quebrou: os dois lados
    precisam contar o mesmo dia, no mesmo fuso, com a mesma regra. O post
    de ``21/10 02:00Z`` é ``20/10 23:00`` em São Paulo e conta no dia 20;
    o de ``19/10 12:00Z`` fica de fora. O dia já terminou e está além da
    primeira página da timeline, então a coleta precisa paginar até ele.
    """
    tail = [
        # 02:00 UTC de 21/10 ainda é 23:00 de 20/10 em São Paulo.
        make_toot("1", "bob", account_id="2", created_at="2026-10-21T02:00:00.000Z"),
        make_toot("2", "alice", account_id="1", created_at="2026-10-20T18:00:00.000Z"),
        make_toot("3", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
        # Dia anterior no fuso local: fora da contagem.
        make_toot("4", "carol", account_id="3", created_at="2026-10-19T12:00:00.000Z"),
    ]

    collector = HistoryCollector(repository=repository)
    page_size = collector.settings.toots_per_page
    timeline = _paged_timeline(tail, page_size + 5)

    processed = get_toot_processor().process(
        timeline, timezone=SAO_PAULO, filter_by_date=TARGET_DAY
    )
    analysis = HashtagAnalysis("tercinema", TARGET_DAY, processed, [])
    assert analysis.get_today_count() == 3
    assert analysis.get_unique_user_count() == 2

    collector.mastodon = PagedMastodon({"tercinema": timeline}, page_size)

    assert collector.collect_hashtag_data("tercinema", TARGET_DAY) is True

    row = repository.get_daily_data("tercinema", TARGET_DAY)
    assert row is not None
    assert row["uses"] == analysis.get_today_count()
    assert row["accounts"] == analysis.get_unique_user_count()


def test_collector_excludes_trending_bots_from_both_counts(repository: Any) -> None:
    """Contas de trending automatizado não contam como participantes.

    A API conta esses bots; o painel os remove dos posts. O histórico
    gravado precisa seguir a mesma regra, senão o número do banco diverge
    do número da tela. O bot aparece em duas hashtags sob ids de conta
    diferentes — a exclusão é pelo nome, em toda coleta.
    """
    collector = HistoryCollector(repository=repository)
    page_size = collector.settings.toots_per_page

    tails = {
        "tercinema": [
            # 02:00 UTC de 21/10 ainda é 23:00 de 20/10 em São Paulo.
            make_toot("1", "bob", account_id="2", created_at="2026-10-21T02:00:00.000Z"),
            make_toot("2", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
            make_toot("3", "TagsBR", account_id="99", created_at="2026-10-20T12:00:00.000Z"),
        ],
        "cinemater": [
            make_toot("4", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
            make_toot("5", "bob", account_id="2", created_at="2026-10-20T12:00:00.000Z"),
            # O mesmo bot sob outra conta: continua fora da contagem.
            make_toot("6", "trending", account_id="98", created_at="2026-10-20T12:00:00.000Z"),
        ],
    }
    feeds = {hashtag: _paged_timeline(tail, page_size + 5) for hashtag, tail in tails.items()}

    collector.mastodon = PagedMastodon(feeds, page_size)

    assert collector.collect_hashtag_data("tercinema", TARGET_DAY) is True
    assert collector.collect_hashtag_data("cinemater", TARGET_DAY) is True

    first = repository.get_daily_data("tercinema", TARGET_DAY)
    second = repository.get_daily_data("cinemater", TARGET_DAY)
    assert first is not None
    assert second is not None
    assert (first["uses"], first["accounts"]) == (2, 2)
    assert (second["uses"], second["accounts"]) == (2, 2)
