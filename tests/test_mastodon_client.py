"""Testes do cliente de verdade (``MastodonService``) contra um cliente falso.

O ``Mastodon.py`` é substituído por um objeto que devolve páginas ou levanta
erros controlados: nada aqui toca a rede. O contrato travado é o de
``fetch_all_toots``:

* pane na PRIMEIRA página é erro — engolir faria uma queda de rede passar por
  um dia sem posts e o cron registraria sucesso;
* pane em uma página POSTERIOR devolve o que já foi coletado;
* ``RateLimitError`` sobe intacto, sem virar ``ApiError`` genérico.

Os testes do coletor usam um falso de ``fetch_all_toots`` inteiro, então não
cobrem nenhum desses caminhos.
"""

from __future__ import annotations

from typing import Any

import pytest
from mastodon.errors import MastodonNetworkError, MastodonRatelimitError

from hashpanel.errors import ApiError, RateLimitError
from hashpanel.services.mastodon import MastodonService


class FakeClient:
    """Cliente mínimo no lugar do ``Mastodon.py``.

    ``pages`` é consumida uma entrada por chamada: uma lista de posts é
    devolvida, uma exceção é levantada. A última entrada se repete.
    """

    def __init__(self, pages: list[Any]) -> None:
        self.pages = pages
        self.calls: list[dict[str, Any]] = []

    def timeline_hashtag(self, hashtag: str, **params: Any) -> list[dict[str, Any]]:
        self.calls.append({"hashtag": hashtag, **params})
        page = self.pages[min(len(self.calls) - 1, len(self.pages) - 1)]
        if isinstance(page, Exception):
            raise page
        return page


def _make_service(client: FakeClient, monkeypatch: pytest.MonkeyPatch) -> MastodonService:
    """Serviço com o cliente falso, sem espera entre páginas."""
    service = MastodonService(client=client)
    monkeypatch.setattr(service.settings, "rate_limit_delay_ms", 0)
    # Páginas de 1 post: basta um post para a próxima página ser pedida.
    monkeypatch.setattr(service.settings, "toots_per_page", 1)
    return service


def _toot(toot_id: str) -> dict[str, Any]:
    return {"id": toot_id, "content": f"post {toot_id}"}


def test_first_page_network_failure_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Falha na primeira página sobe como ``ApiError``, não como dia vazio."""
    client = FakeClient([MastodonNetworkError("connection reset")])
    service = _make_service(client, monkeypatch)

    with pytest.raises(ApiError) as excinfo:
        service.fetch_all_toots("python")

    assert "Network error" in excinfo.value.message
    assert excinfo.value.details["operation"] == "timelines/tag/python"
    assert len(client.calls) == 1


def test_later_page_failure_returns_partial_results(monkeypatch: pytest.MonkeyPatch) -> None:
    """Falha depois da primeira página devolve o parcial sem levantar erro."""
    first_page = [_toot("1")]
    client = FakeClient([first_page, MastodonNetworkError("timeout na segunda página")])
    service = _make_service(client, monkeypatch)

    result = service.fetch_all_toots("python")

    assert result == first_page
    assert len(client.calls) == 2
    # A segunda página foi pedida a partir do último id da primeira.
    assert client.calls[1]["max_id"] == "1"


def test_rate_limit_on_first_page_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    """Limite de taxa sobe como ``RateLimitError``, sem virar ``ApiError``."""
    client = FakeClient([MastodonRatelimitError("slow down")])
    service = _make_service(client, monkeypatch)

    with pytest.raises(RateLimitError):
        service.fetch_all_toots("python")

    assert len(client.calls) == 1
