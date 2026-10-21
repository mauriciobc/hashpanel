"""Testes da janela de tempo ancorada no fuso configurado.

Cada hashtag pertence a um dia da semana no fuso da comunidade
(``#tercinema`` é de terça-feira *aqui*). A API do Mastodon agrega por dia
UTC, e esse balde nunca coincide com o dia local — por isso o coletor conta
os posts do próprio dia local. Estes testes travam esse comportamento.
"""

from __future__ import annotations

from typing import Any

from hashpanel.services.hashtags import HashtagAnalysis
from tests.conftest import make_toot

SAO_PAULO = "America/Sao_Paulo"


def test_counts_come_from_the_local_day() -> None:
    """A contagem de posts e participantes usa o dia local.

    O agregado UTC da API seria 12 posts / 5 contas; no dia local são
    2 posts / 2 contas. O painel e o histórico gravado precisam concordar.
    """
    toots = [
        make_toot("1", "alice", created_at="2026-10-20T12:00:00.000Z"),
        make_toot("2", "bob", created_at="2026-10-20T18:00:00.000Z"),
    ]
    analysis = HashtagAnalysis(
        "tercinema",
        "2026-10-20",
        toots,
        [{"day": "2026-10-20", "uses": "12", "accounts": "5"}],
    )

    assert analysis.get_today_count() == 2
    assert analysis.get_unique_user_count() == 2


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


def test_panel_and_collector_agree_on_the_same_day() -> None:
    """O que o painel mostra é o que o coletor grava.

    Este é o contrato que a discrepância reportada quebrou: os dois lados
    precisam contar o mesmo dia, no mesmo fuso, com a mesma regra.
    """
    from hashpanel.services.collector import HistoryCollector

    toots = [
        make_toot("1", "alice", created_at="2026-10-20T12:00:00.000Z"),
        make_toot("2", "bob", created_at="2026-10-20T18:00:00.000Z"),
        # Post de outro dia, fora da janela local.
        make_toot("3", "carol", created_at="2026-10-19T12:00:00.000Z"),
    ]

    analysis = HashtagAnalysis("tercinema", "2026-10-20", toots[:2], [])

    class FakeMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            return toots

    collector = HistoryCollector.__new__(HistoryCollector)
    from hashpanel.config import get_settings

    collector.settings = get_settings()
    collector.mastodon = FakeMastodon()

    usage = collector._usage_for_local_day("tercinema", "2026-10-20", SAO_PAULO)

    assert usage is not None
    assert usage["uses"] == analysis.get_today_count()
    assert usage["accounts"] == analysis.get_unique_user_count()


def test_collector_excludes_trending_bots_from_both_counts() -> None:
    """Contas de trending automatizado não contam como participantes.

    A API conta esses bots; o painel os remove dos posts. O histórico
    gravado precisa seguir a mesma regra, senão o número do banco diverge
    do número da tela.
    """
    from hashpanel.services.collector import HistoryCollector

    toots = [
        make_toot("1", "alice", account_id="1", created_at="2026-10-20T12:00:00.000Z"),
        make_toot("2", "bob", account_id="2", created_at="2026-10-20T12:00:00.000Z"),
        make_toot("3", "TagsBR", account_id="99", created_at="2026-10-20T12:00:00.000Z"),
        make_toot("4", "trending", account_id="98", created_at="2026-10-20T12:00:00.000Z"),
    ]

    class FakeMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            return toots

    collector = HistoryCollector.__new__(HistoryCollector)
    from hashpanel.config import get_settings

    collector.settings = get_settings()
    collector.mastodon = FakeMastodon()

    usage = collector._usage_for_local_day("tercinema", "2026-10-20", SAO_PAULO)

    assert usage is not None
    assert usage["uses"] == 2
    assert usage["accounts"] == 2
