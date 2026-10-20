"""Configuração compartilhada dos testes."""

from __future__ import annotations

import os
from typing import Any

import pytest

os.environ.setdefault("MASTODON_URL", "https://mastodon.social/api/v1/")
os.environ.setdefault("CLIENT_KEY", "test-client-key")
os.environ.setdefault("CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("ACCESS_TOKEN", "test-access-token")
os.environ.setdefault("NODE_ENV", "test")
os.environ.setdefault("PREFERRED_TIMEZONE", "America/Sao_Paulo")
os.environ.setdefault("DB_PATH", "/tmp/hashpanel-test.db")


@pytest.fixture
def settings() -> Any:
    """Configuração da aplicação já validada."""
    from hashpanel.config import get_settings

    return get_settings()


@pytest.fixture
def repository(tmp_path: Any) -> Any:
    """Repositório apontando para um banco temporário."""
    from hashpanel.database.connection import DatabaseConnection
    from hashpanel.database.repository import HashtagHistoryRepository

    connection = DatabaseConnection(tmp_path / "test.db")
    connection.migrate()
    yield HashtagHistoryRepository(connection.connection)
    connection.close()


def make_toot(
    toot_id: str = "1",
    username: str = "alguem",
    *,
    favorites: int = 0,
    boosts: int = 0,
    replies: int = 0,
    followers: int = 0,
    content: str = "conteúdo",
    created_at: str = "2026-01-15T12:00:00.000Z",
    account_id: str | None = None,
) -> dict[str, Any]:
    """Cria um post no formato da API do Mastodon.

    O id da conta deriva do nome, como na vida real: duas pessoas com o mesmo
    nome em instâncias diferentes são contas distintas.
    """
    return {
        "id": toot_id,
        "created_at": created_at,
        "content": content,
        "url": f"https://mastodon.social/@{username}/{toot_id}",
        "favourites_count": favorites,
        "reblogs_count": boosts,
        "replies_count": replies,
        "media_attachments": [],
        "account": {
            "id": account_id if account_id is not None else f"acct-{username}",
            "username": username,
            "acct": username,
            "followers_count": followers,
            "following_count": 0,
            "statuses_count": 5,
            "created_at": "2024-01-01T00:00:00.000Z",
        },
    }
