"""Testes do cache de análise e do filtro por data.

O painel busca uma página (40 posts) e guarda a lista; uma consulta que
precisa de mais páginas não pode reaproveitar essa lista curta. O filtro por
data explícita também precisa ter cache próprio por data.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from hashpanel.services.hashtags import HashtagAnalysis, TTLCache, get_hashtag_service
from tests.conftest import make_toot


class RecordingTTLCache(TTLCache):
    """Cache que registra as chaves gravadas, para inspeção nos testes."""

    def __init__(self, ttl_seconds: int = 300) -> None:
        super().__init__(ttl_seconds)
        self.written_keys: list[str] = []

    def set(self, key: str, value: Any) -> None:
        """Registra a chave antes de delegar ao cache real."""
        self.written_keys.append(key)
        super().set(key, value)


class FakeMastodon:
    """Cliente falso que respeita o orçamento de páginas da API.

    Cada página devolve no máximo 40 posts, como a API do Mastodon.
    """

    POSTS_PER_PAGE = 40

    def __init__(self) -> None:
        self.page_requests: list[int | None] = []
        self._toots = [
            make_toot(
                str(index),
                f"user{index}",
                created_at="2026-10-20T12:00:00.000Z",
            )
            for index in range(1, 101)
        ]

    def fetch_all_toots(self, hashtag: str, max_pages: int | None = None) -> list[dict[str, Any]]:
        """Devolve posts conforme o número de páginas pedido."""
        self.page_requests.append(max_pages)
        pages = max_pages or 1
        return self._toots[: pages * self.POSTS_PER_PAGE]

    def get_hashtag_history(self, hashtag: str) -> list[dict[str, Any]]:
        """Histórico vazio, para isolar o comportamento dos posts."""
        return []


class DatedFakeMastodon(FakeMastodon):
    """Cliente falso com posts em dois dias locais distintos."""

    def __init__(self) -> None:
        super().__init__()
        self._toots = [
            make_toot("20a", "alice", created_at="2026-10-20T12:00:00.000Z"),
            make_toot("20b", "bob", created_at="2026-10-20T18:00:00.000Z"),
            make_toot("19a", "carol", created_at="2026-10-19T12:00:00.000Z"),
        ]


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Serviço de hashtags com cache observável."""
    instance = get_hashtag_service()
    monkeypatch.setattr(instance, "cache", RecordingTTLCache())
    return instance


def test_toot_cache_key_includes_page_count(service: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """Uma lista curta não é servida a quem pede mais páginas.

    O dashboard busca 1 página e a guarda; a consulta semanal (5 páginas)
    precisa buscar de novo e enxergar mais posts.
    """
    fake = FakeMastodon()
    monkeypatch.setattr(service, "mastodon", fake)
    cache: RecordingTTLCache = service.cache

    short = service.fetch_all_toots("tercinema", max_pages=1)
    long = service.fetch_all_toots("tercinema", max_pages=5)

    assert fake.page_requests == [1, 5]
    assert len(short) == 40
    assert len(long) == 100
    assert short != long

    toot_keys = [key for key in cache.written_keys if key.startswith("toots_")]
    assert len(toot_keys) == 2
    assert toot_keys[0] != toot_keys[1]
    assert "1" in toot_keys[0].split("_")[2]
    assert "5" in toot_keys[1].split("_")[2]

    # A mesma página continua vindo do cache, sem nova chamada à API.
    assert service.fetch_all_toots("tercinema", max_pages=1) == short
    assert fake.page_requests == [1, 5]


def test_unique_user_count_is_zero_without_posts() -> None:
    """Sem posts no dia, não há participantes — mesmo com histórico da API.

    O histórico é agregado em UTC e não representa o dia local; usá-lo
    mostrava "Posts hoje: 0" ao lado de participantes de outro dia.
    """
    analysis = HashtagAnalysis(
        "tercinema",
        "2026-10-20",
        [],
        [{"day": "2026-10-20", "uses": "12", "accounts": "5"}],
    )

    assert analysis.get_unique_user_count() == 0
    assert analysis.to_dict()["summary"]["uniqueUsers"] == 0


def test_analyze_filters_by_explicit_date(service: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """``filter_by_date`` devolve apenas os posts do dia pedido."""
    fake = DatedFakeMastodon()
    monkeypatch.setattr(service, "mastodon", fake)

    analysis = service.analyze_hashtag(
        "tercinema", filter_by_date="2026-10-20", timezone="America/Sao_Paulo"
    )

    assert analysis.today == "2026-10-20"
    assert sorted(toot["id"] for toot in analysis.toots) == ["20a", "20b"]
    assert analysis.get_today_count() == 2
    assert analysis.get_unique_user_count() == 2


def test_analyze_cache_is_separated_by_date(service: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """Análises de datas diferentes não compartilham a entrada de cache."""
    fake = DatedFakeMastodon()
    monkeypatch.setattr(service, "mastodon", fake)
    cache: RecordingTTLCache = service.cache

    first = service.analyze_hashtag(
        "tercinema", filter_by_date="2026-10-20", timezone="America/Sao_Paulo"
    )
    second = service.analyze_hashtag(
        "tercinema", filter_by_date="2026-10-19", timezone="America/Sao_Paulo"
    )
    again = service.analyze_hashtag(
        "tercinema", filter_by_date="2026-10-20", timezone="America/Sao_Paulo"
    )

    assert sorted(toot["id"] for toot in first.toots) == ["20a", "20b"]
    assert [toot["id"] for toot in second.toots] == ["19a"]
    assert first is not second
    assert again is first

    analysis_keys = [key for key in cache.written_keys if key.startswith("analysis_")]
    assert len(analysis_keys) == 2
    assert analysis_keys[0].endswith("2026-10-20")
    assert analysis_keys[1].endswith("2026-10-19")


def test_analyze_async_forwards_filter_by_date(
    service: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A versão assíncrona repassa ``filter_by_date`` para a análise."""
    fake = DatedFakeMastodon()
    monkeypatch.setattr(service, "mastodon", fake)

    analysis = asyncio.run(
        service.analyze_hashtag_async(
            "tercinema", filter_by_date="2026-10-19", timezone="America/Sao_Paulo"
        )
    )

    assert [toot["id"] for toot in analysis.toots] == ["19a"]
