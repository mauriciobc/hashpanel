"""Testes da chave de cliente usada pelos limites de requisição.

O cabeçalho ``X-Forwarded-For`` é controlado por quem faz a requisição.
Usá-lo sem cuidado dá a qualquer cliente um balde novo a cada requisição —
e o limite de publicação não tem autenticação.
"""

from __future__ import annotations

from typing import Any

import pytest

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
    """Recarrega a configuração a cada teste (o cache é global)."""
    from hashpanel.config import reset_settings_cache

    reset_settings_cache()
    yield
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
    """Sem ``TRUSTED_PROXY_IPS``, o cabeçalho é ignorado por completo."""
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.delenv("TRUSTED_PROXY_IPS", raising=False)

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


def test_spoofing_does_not_bypass_the_posting_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """O limite de publicação não pode ser contornado forjando o cabeçalho.

    Este é o contrato que importa: ``POST /api/toot/post`` não tem
    autenticação, então cada requisição precisa cair no mesmo balde.
    """
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    from hashpanel.server.rate_limit import POSTING_RULE, posting_limiter

    posting_limiter.reset()

    keys = {client_key(FakeRequest("8.8.8.8", f"10.0.0.{index}")) for index in range(20)}

    assert keys == {"8.8.8.8"}
    assert POSTING_RULE.max_requests == 10


def test_spoofing_from_a_private_peer_does_not_bypass_the_posting_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cliente na rede interna também não troca de balde.

    Num container com porta publicada, o endereço de origem do cliente
    externo também é privado (a rede do Docker). O cabeçalho só vale
    quando o proxy — e só ele — o sobrescreve.
    """
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", PROXY_NETWORK)

    from hashpanel.server.rate_limit import posting_limiter

    posting_limiter.reset()

    keys = {client_key(FakeRequest("10.9.9.9", f"10.0.0.{index}")) for index in range(20)}

    assert keys == {"10.9.9.9"}
