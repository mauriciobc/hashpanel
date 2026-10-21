"""Testes do CLI: datas civis, fuso configurado e código de saída da coleta."""

from __future__ import annotations

from typing import Any

import pytest

from hashpanel.cli import collect as collect_cli
from hashpanel.cli import main as cli_main
from hashpanel.config import get_settings
from hashpanel.constants import HASHTAGS, get_first_hashtag_for_day
from hashpanel.utils.timezone import day_of_week_for_date

TUESDAY_TAG = get_first_hashtag_for_day(HASHTAGS[2])
WEDNESDAY_TAG = get_first_hashtag_for_day(HASHTAGS[3])


# --- hashpanel-collect: código de saída ---
class _FakeDatabase:
    """Banco falso: só registra o fechamento."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _FakeCollector:
    """Coletor que devolve resumos pré-definidos e registra as chamadas."""

    single_day: dict[str, Any] = {}
    date_range: dict[str, Any] = {}
    calls: list[tuple[Any, ...]] = []

    def collect_all_hashtags(self, date: str | None = None) -> dict[str, Any]:
        type(self).calls.append(("day", date))
        return dict(type(self).single_day)

    def collect_date_range(self, start: str, end: str) -> dict[str, Any]:
        type(self).calls.append(("range", start, end))
        return dict(type(self).date_range)


@pytest.fixture
def collect_env(monkeypatch: pytest.MonkeyPatch) -> type[_FakeCollector]:
    """Injeta banco e coletor falsos no módulo do ``hashpanel-collect``."""
    _FakeCollector.calls = []
    _FakeCollector.single_day = {
        "date": "2026-10-21",
        "totalHashtags": 2,
        "collected": 2,
        "skipped": 0,
        "errors": 0,
        "success": True,
    }
    _FakeCollector.date_range = {
        "dateRange": {"start": "2026-10-15", "end": "2026-10-21"},
        "totalDays": 7,
        "totalCollected": 7,
        "totalSkipped": 0,
        "totalErrors": 0,
        "dailySummaries": [],
    }
    monkeypatch.setattr(collect_cli, "HistoryCollector", _FakeCollector)
    monkeypatch.setattr(collect_cli, "get_database", _FakeDatabase)
    return _FakeCollector


def test_collect_exits_zero_without_errors(
    collect_env: type[_FakeCollector], capsys: pytest.CaptureFixture[str]
) -> None:
    """Coleta de um dia sem erros encerra com 0."""
    assert collect_cli.main(["--date", "2026-10-21"]) == 0
    captured = capsys.readouterr()
    assert "Collection completed successfully" in captured.out
    assert captured.err == ""
    assert collect_env.calls == [("day", "2026-10-21")]


def test_collect_exits_non_zero_when_single_day_has_errors(
    collect_env: type[_FakeCollector], capsys: pytest.CaptureFixture[str]
) -> None:
    """Falha de API no resumo do dia vira código de saída 1."""
    collect_env.single_day.update({"collected": 0, "errors": 2, "success": False})

    assert collect_cli.main(["--date", "2026-10-21"]) == 1
    captured = capsys.readouterr()
    assert "2 error(s)" in captured.err
    assert "Collection completed successfully" not in captured.out


def test_collect_exits_non_zero_when_range_has_errors(
    collect_env: type[_FakeCollector], capsys: pytest.CaptureFixture[str]
) -> None:
    """Falha de API no resumo do intervalo também vira código 1."""
    collect_env.date_range.update({"totalCollected": 0, "totalErrors": 3})

    assert collect_cli.main(["--range", "2026-10-15", "2026-10-21"]) == 1
    captured = capsys.readouterr()
    assert "3 error(s)" in captured.err
    assert "Collection completed successfully" not in captured.out


def test_last_seven_days_uses_configured_timezone_both_ends(
    collect_env: type[_FakeCollector], monkeypatch: pytest.MonkeyPatch
) -> None:
    """O intervalo dos últimos 7 dias começa e termina no fuso configurado."""
    zones: list[str] = []

    def fake_current_date(zone: str, fmt: str = "YYYY-MM-DD") -> str:
        zones.append(zone)
        return "2026-10-21"

    monkeypatch.setattr(collect_cli, "get_current_date_in_timezone", fake_current_date)

    assert collect_cli.main(["--last-7-days"]) == 0

    assert zones == [get_settings().preferred_timezone]
    assert collect_env.calls == [("range", "2026-10-15", "2026-10-21")]


# --- hashpanel: data civil e análise da data pedida ---
def test_get_daily_hashtag_uses_civil_date() -> None:
    """``2026-10-21`` é quarta-feira: a hashtag de quarta, não a de terça."""
    assert day_of_week_for_date("2026-10-21") == 3

    hashtag = cli_main.CLIApplication.get_daily_hashtag("2026-10-21")

    assert hashtag == WEDNESDAY_TAG
    assert hashtag != TUESDAY_TAG


class _FakeAnalysis:
    """Análise sem posts."""

    def has_today_toots(self) -> bool:
        return False


class _RecordingHashtagService:
    """Serviço de hashtags que só registra chamadas."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def analyze_hashtag(self, hashtag: str, **kwargs: Any) -> _FakeAnalysis:
        self.calls.append((hashtag, dict(kwargs)))
        return _FakeAnalysis()


class _FakeTootService:
    """Serviço de posts sem uso neste caminho."""


def _stub_services(monkeypatch: pytest.MonkeyPatch) -> _RecordingHashtagService:
    service = _RecordingHashtagService()
    monkeypatch.setattr(cli_main, "get_hashtag_service", lambda: service)
    monkeypatch.setattr(cli_main, "get_toot_service", lambda: _FakeTootService())
    return service


def test_run_with_date_analyzes_that_date(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """``hashpanel --date`` analisa a data pedida, não o dia de hoje."""
    service = _stub_services(monkeypatch)

    assert cli_main.main(["--date", "2026-10-21"]) == 0

    assert service.calls == [(WEDNESDAY_TAG, {"filter_by_date": "2026-10-21"})]
    assert "2026-10-21" in capsys.readouterr().out


def test_run_without_date_keeps_default_analysis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sem ``--date`` a análise continua sem filtro explícito."""
    service = _stub_services(monkeypatch)

    assert cli_main.main([]) == 0

    assert len(service.calls) == 1
    assert service.calls[0][1] == {}
