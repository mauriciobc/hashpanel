"""Testes da chave de cliente usada pelos limites de requisição.

O cabeçalho ``X-Forwarded-For`` é controlado por quem faz a requisição.
Usá-lo sem cuidado dá a qualquer cliente um balde novo a cada requisição —
e o limite de publicação não tem autenticação.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest

from hashpanel.config import reset_settings_cache
from hashpanel.server.rate_limit import client_key

# Proxy reverso (Caddy) na rede do container.
PROXY_PEER = "172.18.0.5"
# O proxy sobrescreve o cabeçalho com o endereço do cliente real.
PROXY_NETWORK = "172.18.0.0/16"


class FakeClient:
    """Endereço de origem da requisição."""

    def __init__(self, host: str) -> None:
        self.host = host


class FakeRequest:
    """Requisição mínima para a função de chave."""

    def __init__(self, peer: str, forwarded: str | None = None) -> None:
        self.client = FakeClient(peer)
        self.headers = {"x-forwarded-for": forwarded} if forwarded else {}


@pytest.fixture(autouse=True)
def _reset_settings_cache() -> Any:
    """Recarrega a configuração e zera os contadores a cada teste.

    Tanto o cache de configuração quanto os limitadores são globais do
    processo: sem isso, um teste deixaria o balde cheio para o próximo.
    """
    from hashpanel.server.rate_limit import api_limiter, posting_limiter

    reset_settings_cache()
    posting_limiter.reset()
    api_limiter.reset()
    yield
    posting_limiter.reset()
    api_limiter.reset()
    reset_settings_cache()


def test_spoofed_header_from_public_peer_does_not_create_a_new_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Um cliente que atinja a porta direto não troca de balde."""
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    request = FakeRequest("8.8.8.8", "1.2.3.4")

    assert client_key(request) == "8.8.8.8"


def test_spoofed_header_from_an_unknown_peer_is_ignored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Um peer fora das redes do proxy não faz o cabeçalho valer.

    Num container com porta publicada, o endereço de origem de um cliente
    externo também é privado. Só a lista de proxies decide.
    """
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    request = FakeRequest("10.9.9.9", "1.2.3.4")

    assert client_key(request) == "10.9.9.9"


def test_header_is_ignored_without_a_configured_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sem ``TRUSTED_PROXY_IPS``, o cabeçalho é ignorado por completo.

    A variável recebe a string vazia em vez de ser removida do ambiente:
    ``get_settings`` também lê o ``.env`` do diretório atual, e um ``.env``
    de desenvolvimento com ``TRUSTED_PROXY_IPS`` não pode mudar o resultado.
    """
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", "")

    request = FakeRequest(PROXY_PEER, "9.9.9.9")

    assert client_key(request) == PROXY_PEER


def test_trusted_proxy_uses_the_client_address(monkeypatch: pytest.MonkeyPatch) -> None:
    """Com o proxy confiável, o endereço do cliente vem do cabeçalho.

    O Caddy sobrescreve ``X-Forwarded-For`` com o endereço do cliente, então
    a cadeia tem um só elemento.
    """
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    request = FakeRequest(PROXY_PEER, "9.9.9.9")

    assert client_key(request) == "9.9.9.9"


def test_client_supplied_prefix_is_discarded(monkeypatch: pytest.MonkeyPatch) -> None:
    """A parte do cabeçalho injetada pelo cliente é ignorada.

    ``9.9.9.9`` foi escrito pelo proxy (último elemento da cadeia); o
    cliente não pode escolher o próprio endereço.
    """
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    request = FakeRequest(PROXY_PEER, "6.6.6.6, 9.9.9.9")

    assert client_key(request) == "9.9.9.9"


def test_two_proxies_pick_the_address_before_the_last_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Com dois proxies confiáveis, o cliente é o penúltimo elemento."""
    monkeypatch.setenv("TRUST_PROXY", "2")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    request = FakeRequest(PROXY_PEER, "6.6.6.6, 9.9.9.9")

    assert client_key(request) == "6.6.6.6"


def test_proxy_disabled_ignores_the_header(monkeypatch: pytest.MonkeyPatch) -> None:
    """``TRUST_PROXY=false`` desliga o uso do cabeçalho."""
    monkeypatch.setenv("TRUST_PROXY", "false")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    request = FakeRequest(PROXY_PEER, "9.9.9.9")

    assert client_key(request) == PROXY_PEER


def test_header_shorter_than_the_trusted_chain_falls_back_to_the_peer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Uma cadeia curta demais não permite escolher o endereço."""
    monkeypatch.setenv("TRUST_PROXY", "3")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    request = FakeRequest(PROXY_PEER, "9.9.9.9")

    assert client_key(request) == PROXY_PEER


def test_without_the_header_the_peer_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sem cabeçalho, vale o endereço de origem."""
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    request = FakeRequest("8.8.8.8")

    assert client_key(request) == "8.8.8.8"


def test_invalid_trusted_proxy_entries_warn_once_and_keep_the_valid_networks(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Uma entrada inválida não invalida a lista nem repete o aviso.

    ``TRUSTED_PROXY_IPS`` é validado uma vez por valor: o ``bogus`` vira um
    aviso no log, e a rede válida ao lado continua valendo.
    """
    from hashpanel.server.rate_limit import _parsed_networks

    _parsed_networks.cache_clear()
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", f"bogus,{PROXY_NETWORK}")

    # O logger da aplicação não propaga para o root: o handler do caplog
    # precisa ser ligado ao logger "hashpanel".
    app_logger = logging.getLogger("hashpanel")
    app_logger.addHandler(caplog.handler)
    try:
        keys = {client_key(FakeRequest(PROXY_PEER, "9.9.9.9")) for _ in range(5)}
    finally:
        app_logger.removeHandler(caplog.handler)

    assert keys == {"9.9.9.9"}
    warnings = [
        record
        for record in caplog.records
        if record.getMessage() == "Invalid trusted proxy network"
    ]
    assert len(warnings) == 1
    assert warnings[0].__dict__["context"] == {"network": "bogus"}


def test_ipv4_mapped_peer_is_canonicalized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Um peer IPv4 mapeado em IPv6 é tratado como o IPv4 equivalente.

    O uvicorn pode entregar ``request.client.host`` como ``::ffff:a.b.c.d``;
    sem normalizar, o proxy confiável não seria reconhecido e o balde do
    limite ficaria diferente do de quem chega em IPv4.
    """
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    mapped_peer = "::ffff:172.18.0.5"

    assert client_key(FakeRequest(mapped_peer, "9.9.9.9")) == "9.9.9.9"
    # Sem cabeçalho, o próprio peer sai na forma canônica.
    assert client_key(FakeRequest(mapped_peer)) == PROXY_PEER


class FakeTootService:
    """Serviço de publicação que nunca toca a rede."""

    async def create_custom_toot_async(self, content: str, **options: Any) -> dict[str, Any]:
        return {
            "id": "1",
            "url": "https://exemplo.test/1",
            "content": content,
            "created_at": "2026-01-01T00:00:00.000Z",
        }


def test_posting_endpoint_returns_429_after_the_posting_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``POST /api/toot/post`` responde 429 quando o balde enche.

    O endpoint não tem autenticação e o cliente controla o
    ``X-Forwarded-For``. Sem proxy confiável, o cabeçalho é ignorado e todas
    as requisições caem no mesmo balde, mesmo com valores diferentes.

    Este é o teste que falha se ``_posting_allowed`` deixar de aplicar o
    limite: o primeiro pedido passa e o último tem de ser recusado.
    """
    monkeypatch.setenv("TRUST_PROXY", "0")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", "")

    from fastapi.testclient import TestClient

    from hashpanel.server.app import create_app
    from hashpanel.server.rate_limit import POSTING_RULE, posting_limiter
    from hashpanel.server.routes import toot as toot_module

    posting_limiter.reset()
    monkeypatch.setattr(toot_module, "get_toot_service", lambda: FakeTootService())

    with TestClient(create_app(), raise_server_exceptions=False) as client:
        responses = [
            client.post(
                "/api/toot/post",
                json={"content": "olá"},
                headers={"X-Forwarded-For": f"10.0.0.{index}"},
            )
            for index in range(POSTING_RULE.max_requests + 1)
        ]

    assert responses[0].status_code == 200, responses[0].text
    assert responses[0].json()["success"] is True
    assert all(response.status_code == 200 for response in responses[: POSTING_RULE.max_requests])
    assert responses[-1].status_code == 429, responses[-1].text
    assert responses[-1].json()["error"]["code"] == POSTING_RULE.error_code
    assert responses[-1].headers["Retry-After"]


def test_server_entrypoint_disables_uvicorn_proxy_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """O uvicorn não pode reescrever ``request.client.host`` sozinho.

    Com ``proxy_headers`` ligado, o uvicorn lê ``X-Forwarded-For`` de
    qualquer origem e troca o endereço de origem — o que anularia a lista
    ``TRUSTED_PROXY_IPS`` e o limite de publicação.
    """
    monkeypatch.setenv("NODE_ENV", "test")

    from hashpanel.server import __main__ as entry

    captured: dict[str, Any] = {}

    def fake_run(app_path: str, **kwargs: Any) -> None:
        captured["app_path"] = app_path
        captured.update(kwargs)

    monkeypatch.setattr(entry.uvicorn, "run", fake_run)

    assert entry.main() == 0
    assert captured["app_path"] == "hashpanel.server.app:app"
    assert captured["proxy_headers"] is False
    assert captured["forwarded_allow_ips"] == ""
