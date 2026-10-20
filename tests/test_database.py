"""Testes da camada de dados."""

from __future__ import annotations

import pytest

from hashpanel.database.migrations import get_iso_week


def test_iso_week_of_regular_date() -> None:
    """Uma data no meio da semana cai na semana ISO esperada."""
    result = get_iso_week("2026-01-15")

    assert result.year == 2026
    assert result.week_number == 3
    assert result.week_start == "2026-01-12"
    assert result.week_end == "2026-01-18"


def test_iso_week_uses_iso_year() -> None:
    """O ano devolvido é o ano ISO, não o civil."""
    result = get_iso_week("2021-01-01")

    assert result.year == 2020
    assert result.week_number == 53


def test_iso_week_rejects_invalid_date() -> None:
    """Datas inválidas geram erro."""
    with pytest.raises(ValueError):
        get_iso_week("2026-13-45")


def test_save_is_idempotent(repository) -> None:
    """Gravar o mesmo dia duas vezes não duplica a linha."""
    assert repository.save_daily_data("tercinema", "2026-01-15", {"uses": 5, "accounts": 2}) is True
    assert (
        repository.save_daily_data("tercinema", "2026-01-15", {"uses": 9, "accounts": 4}) is False
    )

    data = repository.get_daily_data("tercinema", "2026-01-15")
    assert data["uses"] == 5


def test_has_data_for_date(repository) -> None:
    """A verificação de existência reflete o que foi gravado."""
    assert repository.has_data_for_date("tercinema", "2026-01-15") is False

    repository.save_daily_data("tercinema", "2026-01-15", {"uses": 1, "accounts": 1})

    assert repository.has_data_for_date("tercinema", "2026-01-15") is True


def test_weekly_history_groups_by_week(repository) -> None:
    """Os dados diários são agrupados por semana."""
    for day, uses in (("2026-01-12", 3), ("2026-01-13", 4), ("2026-01-20", 10)):
        repository.save_daily_data("tercinema", day, {"uses": uses, "accounts": 1})

    weeks = repository.get_weekly_history("tercinema", 2026)

    assert len(weeks) == 2
    assert weeks[0]["weekNumber"] == 3
    assert weeks[0]["totalUses"] == 7
    assert weeks[0]["daysCounted"] == 2
    assert weeks[1]["totalUses"] == 10


def test_daily_average_uses_one_decimal(repository) -> None:
    """A média diária é arredondada para uma casa decimal."""
    repository.save_daily_data("tercinema", "2026-01-12", {"uses": 3, "accounts": 1})
    repository.save_daily_data("tercinema", "2026-01-13", {"uses": 4, "accounts": 1})

    weeks = repository.get_weekly_history("tercinema", 2026)

    assert weeks[0]["dailyAverage"] == 3.5


def test_all_hashtags_weekly_history_is_grouped(repository) -> None:
    """O histórico anual vem agrupado por hashtag."""
    repository.save_daily_data("tercinema", "2026-01-12", {"uses": 3, "accounts": 1})
    repository.save_daily_data("tersoftware", "2026-01-12", {"uses": 8, "accounts": 2})

    data = repository.get_all_hashtags_weekly_history(2026)

    assert set(data.keys()) == {"tercinema", "tersoftware"}
    assert data["tersoftware"][0]["totalUses"] == 8


def test_daily_history_respects_range(repository) -> None:
    """O histórico diário respeita o intervalo pedido."""
    for day in ("2026-01-10", "2026-01-11", "2026-01-12"):
        repository.save_daily_data("tercinema", day, {"uses": 1, "accounts": 1})

    rows = repository.get_daily_history("tercinema", "2026-01-11", "2026-01-12")

    assert [row["date"] for row in rows] == ["2026-01-11", "2026-01-12"]


def test_aggregate_weekly_data_summary(repository) -> None:
    """O resumo agrega os totais e identifica a semana de pico."""
    repository.save_daily_data("tercinema", "2026-01-12", {"uses": 3, "accounts": 1})
    repository.save_daily_data("tercinema", "2026-01-13", {"uses": 4, "accounts": 1})
    repository.save_daily_data("tercinema", "2026-01-20", {"uses": 20, "accounts": 5})

    result = repository.aggregate_weekly_data("tercinema", 2026)

    assert result["summary"]["totalWeeks"] == 2
    assert result["summary"]["totalUses"] == 27
    assert result["summary"]["peakWeek"]["weekNumber"] == 4
    assert result["summary"]["peakWeek"]["totalUses"] == 20


def test_aggregate_weekly_data_without_rows(repository) -> None:
    """Sem dados, o resumo vem zerado e sem pico."""
    result = repository.aggregate_weekly_data("tercinema", 2026)

    assert result["weeklyData"] == []
    assert result["summary"]["totalWeeks"] == 0
    assert result["summary"]["peakWeek"] is None


def test_date_range(repository) -> None:
    """O intervalo de datas reflete o que foi gravado."""
    repository.save_daily_data("tercinema", "2026-01-10", {"uses": 1, "accounts": 1})
    repository.save_daily_data("tercinema", "2026-01-20", {"uses": 1, "accounts": 1})

    assert repository.get_date_range("tercinema") == {
        "minDate": "2026-01-10",
        "maxDate": "2026-01-20",
    }
