"""Testes da API HTTP.

As rotas que dependem do Mastodon usam um cliente falso, para testar o
contrato sem tocar a rede.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from hashpanel.services import hashtags as hashtags_module
from hashpanel.services.hashtags import get_hashtag_service
from tests.conftest import make_toot


@pytest.fixture
def client() -> TestClient:
    """Cliente HTTP da aplicação."""
    from hashpanel.server.app import create_app

    with TestClient(create_app(), raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def fake_mastodon(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Substitui as chamadas ao Mastodon por respostas fixas."""
    calls: dict[str, Any] = {"trending": [], "toots": [], "history": []}

    class FakeMastodon:
        def get_trending_tags(self, limit: int = 10, offset: int = 0) -> list[dict[str, Any]]:
            calls["trending"].append((limit, offset))
            return [
                {
                    "name": "tercinema",
                    "url": "https://mastodon.social/tags/tercinema",
                    "history": [
                        {"day": "1767225600", "uses": "12", "accounts": "5"},
                        {"day": "1767139200", "uses": "8", "accounts": "4"},
                    ],
                },
                {
                    "name": "python",
                    "url": "https://mastodon.social/tags/python",
                    "history": [
                        {"day": "1767225600", "uses": "30", "accounts": "9"},
                        {"day": "1767139200", "uses": "25", "accounts": "8"},
                    ],
                },
            ]

        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            calls["toots"].append(hashtag)
            # Posts de hoje, para que o filtro de data do timeframe "today" os mantenha.
            from datetime import UTC, datetime

            today = datetime.now(UTC).strftime("%Y-%m-%dT12:00:00.000Z")
            return [
                make_toot("1", "alice", favorites=10, followers=100, created_at=today),
                make_toot("2", "bob", favorites=50, followers=500, created_at=today),
            ]

        def get_hashtag_history(self, hashtag: str) -> list[dict[str, Any]]:
            calls["history"].append(hashtag)
            return [{"day": "1767225600", "uses": "12", "accounts": "5"}]

    fake = FakeMastodon()
    service = get_hashtag_service()
    monkeypatch.setattr(service, "mastodon", fake)
    monkeypatch.setattr(service, "cache", hashtags_module.TTLCache(0))

    # O health check usa o cliente do Mastodon diretamente.
    from hashpanel.server import health as health_module

    monkeypatch.setattr(health_module, "get_mastodon_service", lambda: fake)
    return fake


def test_api_index(client: TestClient) -> None:
    """A raiz da API descreve os endpoints disponíveis."""
    response = client.get("/api")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "HashPanel API"
    assert "hashtag" in body["endpoints"]


def test_daily_schedule_has_seven_days(client: TestClient) -> None:
    """A grade semanal devolve os sete dias."""
    response = client.get("/api/hashtag/daily")

    assert response.status_code == 200
    schedule = response.json()["dailySchedule"]
    assert len(schedule) == 7
    assert sum(1 for day in schedule if day["isToday"]) == 1
    assert all(day["hashtags"] for day in schedule)


def test_current_hashtag_uses_requested_timezone(client: TestClient) -> None:
    """A hashtag do dia respeita o fuso pedido."""
    response = client.get("/api/hashtag/current", params={"timezone": "UTC"})

    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == "UTC"
    assert 0 <= body["dayOfWeek"] <= 6
    assert body["serverTimezone"] == "America/Sao_Paulo"


def test_unknown_api_route_returns_json_404(client: TestClient) -> None:
    """Rotas inexistentes da API devolvem JSON, não o HTML do dashboard."""
    response = client.get("/api/nao-existe")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_hashtag_stats_contract(client: TestClient, fake_mastodon: Any) -> None:
    """As estatísticas trazem os campos que o painel consome.

    A contagem vem dos posts do dia local, não do agregado UTC da API — é o
    que garante que o painel e o histórico gravado não fiquem divergentes entre si.
    """
    response = client.get("/api/hashtag/tercinema/stats")

    assert response.status_code == 200
    body = response.json()

    assert body["hashtag"] == "tercinema"
    assert set(body["summary"]) == {"tootCount", "uniqueUsers", "weeklyTotal", "averageRelevance"}
    # A fake devolve 2 posts de 2 contas distintas no dia.
    assert body["summary"]["tootCount"] == 2
    assert body["summary"]["uniqueUsers"] == 2
    assert len(body["topToots"]) == 2
    assert set(body["topToots"][0]) >= {
        "id",
        "author",
        "content",
        "favorites",
        "boosts",
        "relevance",
        "link",
        "followers",
        "media",
    }
    # O post mais relevante vem primeiro.
    assert body["topToots"][0]["author"] == "bob"
    assert response.headers["cache-control"] == "public, max-age=120"


def test_hashtag_stats_rejects_invalid_timeframe(client: TestClient) -> None:
    """Um timeframe inválido devolve 400."""
    response = client.get("/api/hashtag/tercinema/stats", params={"timeframe": "century"})

    assert response.status_code == 400


def test_trending_contract(client: TestClient, fake_mastodon: Any) -> None:
    """As tags em alta trazem ranking e direção de tendência."""
    response = client.get("/api/trending", params={"limit": 10})

    assert response.status_code == 200
    body = response.json()

    assert body["pagination"]["limit"] == 10
    assert body["tags"][0]["rank"] == 1
    assert body["tags"][0]["name"] == "tercinema"
    assert body["tags"][0]["trendDirection"] == "rising"
    assert body["tags"][0]["weekTotal"] == 20


def test_trending_detail_not_found(client: TestClient, fake_mastodon: Any) -> None:
    """Uma tag fora da lista devolve 404."""
    response = client.get("/api/trending/inexistente")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "TRENDING_TAG_NOT_FOUND"


def test_toot_validate_reports_errors(client: TestClient) -> None:
    """A validação aponta conteúdo longo e avisa sobre o limite."""
    response = client.post("/api/toot/validate", json={"content": "x" * 600})

    assert response.status_code == 200
    validation = response.json()["validation"]
    assert validation["isValid"] is False
    assert validation["errors"][0]["code"] == "CONTENT_TOO_LONG"
    assert validation["warnings"][0]["code"] == "CONTENT_NEAR_LIMIT"


def test_toot_validate_counts_metadata(client: TestClient) -> None:
    """A validação conta hashtags, menções e links."""
    response = client.post("/api/toot/validate", json={"content": "#tag @user https://example.com"})

    metadata = response.json()["validation"]["metadata"]
    assert metadata["hashtagCount"] == 1
    assert metadata["mentionCount"] == 1
    assert metadata["linkCount"] == 1


def test_health_reports_services(client: TestClient, fake_mastodon: Any) -> None:
    """O health check informa o estado de cada serviço."""
    response = client.get("/health")

    assert response.status_code in (200, 503)
    body = response.json()
    assert body["status"] in ("healthy", "degraded")
    assert "mastodon" in body["services"]
    assert "database" in body["services"]
