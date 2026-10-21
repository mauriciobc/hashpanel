"""Testes do proxy de imagens.

O proxy só pode buscar origens da allowlist: redirecionamentos são resolvidos
e validados um a um, então um host permitido não consegue desviar a requisição
para a rede interna (``127.0.0.1``) nem para metadados de infraestrutura.
"""

from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from hashpanel.server.routes import media as media_module

ALLOWED_HOST = "cdn.ursal.zone"
OTHER_ALLOWED_HOST = "media.mastodon.social"

IMAGE_BYTES = b"\x89PNG\r\n\x1a\nfake-image"


@pytest.fixture
def client() -> TestClient:
    """Cliente HTTP da aplicação."""
    from hashpanel.server.app import create_app

    with TestClient(create_app(), raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def media_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fixa a allowlist e isola o cache entre os testes."""
    from hashpanel.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "media_proxy_allowlist", f"{ALLOWED_HOST},{OTHER_ALLOWED_HOST}")
    monkeypatch.setattr(media_module, "_cache", None)


def _install_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> list[str]:
    """Injeta um transporte falso e devolve a lista de URLs requisitadas."""
    requested: list[str] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return handler(request)

    transport = httpx.MockTransport(recording_handler)
    real_async_client = httpx.AsyncClient

    def factory(*args: object, **kwargs: object) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(media_module.httpx, "AsyncClient", factory)
    return requested


@pytest.mark.parametrize("status_code", [301, 302, 303, 307, 308])
def test_redirect_to_non_allowed_host_is_refused(
    client: TestClient,
    media_settings: None,
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    """Redirecionar para um host fora da allowlist é recusado sem ser buscado."""

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == f"https://{ALLOWED_HOST}/media/1":
            return httpx.Response(
                status_code, headers={"location": "http://127.0.0.1/latest/meta-data/"}
            )
        # Se o alvo proibido for requisitado, devolvemos algo "válido" para que
        # a falha apareça na asserção de URLs requisitadas.
        return httpx.Response(200, headers={"content-type": "text/plain"}, content=b"secret")

    requested = _install_transport(monkeypatch, handler)

    response = client.get(
        "/api/media/proxy",
        params={"url": f"https://{ALLOWED_HOST}/media/1", "cache": "false"},
    )

    assert requested == [f"https://{ALLOWED_HOST}/media/1"]
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["message"] == "Image host is not allowed"


def test_redirect_to_another_allowed_host_is_followed(
    client: TestClient, media_settings: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Um redirecionamento para outro host permitido (CDN) continua funcionando."""
    target = f"https://{OTHER_ALLOWED_HOST}/cdn/image.png"

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == f"https://{ALLOWED_HOST}/media/2":
            return httpx.Response(302, headers={"location": target})
        return httpx.Response(200, headers={"content-type": "image/png"}, content=IMAGE_BYTES)

    requested = _install_transport(monkeypatch, handler)

    response = client.get(
        "/api/media/proxy",
        params={"url": f"https://{ALLOWED_HOST}/media/2", "cache": "false"},
    )

    assert response.status_code == 200
    assert response.content == IMAGE_BYTES
    assert response.headers["content-type"] == "image/png"
    assert response.headers["X-Cache"] == "MISS"
    assert requested == [f"https://{ALLOWED_HOST}/media/2", target]


def test_redirect_loop_stops_at_cap(
    client: TestClient, media_settings: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Um ciclo de redirecionamentos entre hosts permitidos para no limite."""

    def handler(request: httpx.Request) -> httpx.Response:
        following = "/loop-b" if str(request.url).endswith("/loop-a") else "/loop-a"
        return httpx.Response(302, headers={"location": following})

    requested = _install_transport(monkeypatch, handler)

    response = client.get(
        "/api/media/proxy",
        params={"url": f"https://{ALLOWED_HOST}/loop-a", "cache": "false"},
    )

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["message"] == "Too many redirects"
    assert len(requested) == media_module.MAX_IMAGE_REDIRECTS + 1
