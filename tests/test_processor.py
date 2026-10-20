"""Testes do pipeline de processamento de posts."""

from __future__ import annotations

from hashpanel.services.processor import TootProcessor
from tests.conftest import make_toot


def test_invalid_toots_are_dropped() -> None:
    """Posts sem os campos obrigatórios saem do pipeline."""
    processor = TootProcessor()
    result = processor.process([make_toot("1"), {"id": "2"}])

    assert len(result) == 1
    assert result[0]["id"] == "1"


def test_ignored_accounts_are_removed() -> None:
    """Contas de trending automatizado não entram no resultado."""
    processor = TootProcessor()
    result = processor.process([make_toot("1", "TagsBR"), make_toot("2", "pessoa")])

    assert len(result) == 1
    assert result[0]["account"]["username"] == "pessoa"


def test_results_are_sorted_by_relevance() -> None:
    """A saída vem ordenada por relevância decrescente."""
    processor = TootProcessor()
    result = processor.process(
        [
            make_toot("1", favorites=1),
            make_toot("2", favorites=900),
            make_toot("3", favorites=50),
        ]
    )

    scores = [toot["relevanceScore"] for toot in result]
    assert scores == sorted(scores, reverse=True)


def test_date_filter_uses_target_timezone() -> None:
    """O filtro de data considera o fuso do cliente."""
    processor = TootProcessor()
    # 23:30 UTC do dia 15 é 20:30 do dia 15 em São Paulo.
    toots = [make_toot("1", created_at="2026-01-15T23:30:00.000Z")]

    assert len(processor.filter_by_date(toots, "2026-01-15", "America/Sao_Paulo")) == 1
    assert len(processor.filter_by_date(toots, "2026-01-16", "America/Sao_Paulo")) == 0
    # Em UTC, 23:30 do dia 15 também é o dia 15.
    assert len(processor.filter_by_date(toots, "2026-01-15", "UTC")) == 1


def test_date_filter_shifts_across_midnight() -> None:
    """Um post às 02:00 UTC já é do dia anterior em São Paulo."""
    processor = TootProcessor()
    toots = [make_toot("1", created_at="2026-01-16T02:00:00.000Z")]

    assert len(processor.filter_by_date(toots, "2026-01-15", "America/Sao_Paulo")) == 1
    assert len(processor.filter_by_date(toots, "2026-01-16", "America/Sao_Paulo")) == 0


def test_timeframe_filters_old_posts() -> None:
    """A janela de tempo descarta posts antigos."""
    from datetime import UTC, datetime, timedelta

    processor = TootProcessor()
    now = datetime.now(UTC)
    recent = (now - timedelta(days=2)).isoformat()
    old = (now - timedelta(days=200)).isoformat()
    toots = [
        make_toot("recente", created_at=recent),
        make_toot("antigo", created_at=old),
    ]

    result = processor.filter_by_timeframe(toots, "month", "UTC")

    assert [toot["id"] for toot in result] == ["recente"]


def test_timeframe_all_keeps_everything() -> None:
    """O timeframe ``all`` não filtra nada."""
    processor = TootProcessor()
    toots = [make_toot("antigo", created_at="2020-01-15T12:00:00.000Z")]

    assert processor.filter_by_timeframe(toots, "all", "UTC") == toots


def test_limit_is_applied() -> None:
    """O limite corta a lista final."""
    processor = TootProcessor()
    toots = [make_toot(str(index)) for index in range(10)]

    assert len(processor.process(toots, limit=3)) == 3
