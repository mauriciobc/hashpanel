"""Testes da grade semanal de hashtags (``GET /api/hashtag/daily``).

O bug original calculava "hoje" com o relógio do sistema operacional (UTC no
container), enquanto o resto da API usa o fuso pedido pelo cliente. Aqui o
relógio é congelado num instante em que o dia civil de ``Pacific/Kiritimati``
(UTC+14) já é o seguinte ao dia UTC, para que a asserção não dependa da hora
em que a suíte roda.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from hashpanel.server.routes import hashtag as hashtag_module

# 21/10/2026 10:30 UTC = quarta-feira; em Kiritimati (UTC+14) já é 22/10,
# quinta-feira.
FIXED_UTC = datetime(2026, 10, 21, 10, 30, tzinfo=UTC)
# Fuso com 14h de avanço: o dia civil diverge do dia UTC nesse instante.
ZONE_WITH_OTHER_DAY = "Pacific/Kiritimati"


class _FixedInstant(datetime):
    """Instante congelado que ignora o fuso local da máquina em ``astimezone()``."""

    def astimezone(self, tz: Any = None) -> datetime:
        if tz is None:
            return self
        return datetime.astimezone(self, tz)


class _FrozenDatetime:
    """Substitui o ``datetime`` do módulo de rotas: servidor sempre em UTC."""

    @classmethod
    def now(cls, tz: Any = None) -> datetime:
        instant = _FixedInstant(
            FIXED_UTC.year,
            FIXED_UTC.month,
            FIXED_UTC.day,
            FIXED_UTC.hour,
            FIXED_UTC.minute,
            tzinfo=UTC,
        )
        return instant if tz is None else instant.astimezone(tz)


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Cliente HTTP da aplicação."""
    from hashpanel.server.app import create_app

    with TestClient(create_app(), raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def frozen_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Congela o relógio do roteador e o helper de fuso no mesmo instante."""
    from hashpanel.utils import timezone as timezone_module

    # Caminho antigo: ``datetime.now()`` dentro do módulo de rotas.
    monkeypatch.setattr(hashtag_module, "datetime", _FrozenDatetime)
    # Caminho corrigido: ``get_current_datetime(validated)``.
    monkeypatch.setattr(
        timezone_module,
        "get_current_datetime",
        lambda tz: FIXED_UTC.astimezone(ZoneInfo(tz)),
    )


def test_daily_marks_day_of_requested_timezone(client: TestClient, frozen_clock: None) -> None:
    """O dia marcado segue o fuso pedido, não o dia UTC do servidor."""
    response = client.get("/api/hashtag/daily", params={"timezone": ZONE_WITH_OTHER_DAY})

    assert response.status_code == 200
    body = response.json()
    schedule = body["dailySchedule"]
    assert len(schedule) == 7

    expected_day = (FIXED_UTC.astimezone(ZoneInfo(ZONE_WITH_OTHER_DAY)).weekday() + 1) % 7
    utc_day = (FIXED_UTC.weekday() + 1) % 7
    # O cenário só prova algo se os dois dias realmente divergirem.
    assert expected_day != utc_day

    today_entries = [entry for entry in schedule if entry["isToday"]]
    assert len(today_entries) == 1
    assert today_entries[0]["day"] == expected_day
    assert body["current"]["day"] == expected_day
    assert body["current"]["hashtag"] == today_entries[0]["hashtag"]
    assert body["timezone"] == ZONE_WITH_OTHER_DAY


def test_daily_generated_at_uses_requested_zone(client: TestClient, frozen_clock: None) -> None:
    """``generatedAt`` é o instante no fuso pedido, não no fuso do SO."""
    response = client.get("/api/hashtag/daily", params={"timezone": ZONE_WITH_OTHER_DAY})

    assert response.status_code == 200
    generated = datetime.fromisoformat(response.json()["generatedAt"])

    assert generated == FIXED_UTC
    assert generated.utcoffset() == timedelta(hours=14)


def test_daily_defaults_to_configured_timezone(client: TestClient, frozen_clock: None) -> None:
    """Sem ``timezone``, o fuso resolvido é o configurado no servidor."""
    from hashpanel.config import get_settings

    response = client.get("/api/hashtag/daily")

    assert response.status_code == 200
    body = response.json()
    expected_day = (
        FIXED_UTC.astimezone(ZoneInfo(get_settings().preferred_timezone)).weekday() + 1
    ) % 7

    assert body["timezone"] == get_settings().preferred_timezone
    today_entries = [entry for entry in body["dailySchedule"] if entry["isToday"]]
    assert len(today_entries) == 1
    assert today_entries[0]["day"] == expected_day


def test_daily_rejects_invalid_timezone(client: TestClient) -> None:
    """Um fuso inválido devolve o erro de validação da API (400), não 500."""
    response = client.get("/api/hashtag/daily", params={"timezone": "Not/AZone"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
