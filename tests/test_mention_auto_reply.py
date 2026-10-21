"""Regressão: a flag MENTION_AUTO_REPLY controla as respostas a menções.

Quando ``MENTION_AUTO_REPLY=false``:
  - o listener NÃO conecta ao streaming do Mastodon;
  - nenhuma resposta é enviada a quem menciona a conta;
  - o ``/health`` continua "healthy" (o listener desligado de propósito não
    pode devolver 503, senão o healthcheck do container -- ``curl -f`` --
    reiniciaria o container em loop).

O relatório diário agendado às 23:59 NÃO é afetado por esta flag: é outra
funcionalidade (publicação do dashboard), não resposta a menção.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from hashpanel.config import get_settings
from hashpanel.services import listener as listener_mod


def _settings(monkeypatch: pytest.MonkeyPatch, value: bool) -> Any:
    """Settings com a flag ligada/desligada."""
    monkeypatch.setattr(listener_mod, "get_settings", lambda: _FakeSettings(value))
    return _FakeSettings(value)


class _FakeSettings:
    def __init__(self, enabled: bool) -> None:
        self.mention_auto_reply = enabled
        self.mastodon_url = "https://example.test"


# --- a flag desliga o listener ---
def test_listener_does_not_start_when_flag_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Com a flag desligada, start() não abre thread nem conecta."""
    _settings(monkeypatch, False)
    listener = listener_mod.MentionListener.__new__(listener_mod.MentionListener)
    listener.settings = _FakeSettings(False)
    listener.mastodon = MagicMock()
    listener.hashtags = MagicMock()
    listener.images = MagicMock()
    listener.connected = False
    listener.reconnect_attempts = 0
    listener._stop_event = MagicMock()
    listener._thread = None

    listener.start()

    assert listener._thread is None, "o listener nao pode iniciar thread com a flag off"
    listener.mastodon.client.stream_user.assert_not_called()


def test_listener_enabled_property(monkeypatch: pytest.MonkeyPatch) -> None:
    """A propriedade enabled reflete a flag."""
    listener = listener_mod.MentionListener.__new__(listener_mod.MentionListener)
    listener.settings = _FakeSettings(False)
    assert listener.enabled is False
    listener.settings = _FakeSettings(True)
    assert listener.enabled is True


# --- a flag nao quebra o health check ---
def test_health_reports_disabled_listener_as_healthy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Listener desligado de propósito => status healthy (nada de 503)."""
    from hashpanel.server import health as health_mod

    fake_listener = MagicMock()
    fake_listener.get_status.return_value = {
        "enabled": False,
        "connected": False,
        "readyState": "DISABLED",
        "reconnectAttempts": 0,
    }

    fake_mastodon = MagicMock()
    fake_mastodon.get_trending_tags.return_value = []
    fake_db = MagicMock()
    fake_db.health_check.return_value = {"status": "healthy"}

    monkeypatch.setattr(health_mod, "get_database", lambda: fake_db)
    monkeypatch.setattr(health_mod, "get_mention_listener", lambda: fake_listener)
    monkeypatch.setattr(health_mod, "get_mastodon_service", lambda: fake_mastodon)
    monkeypatch.setattr(health_mod, "get_settings", lambda: MagicMock(healthcheck_timeout_ms=2500))

    import asyncio

    report = asyncio.run(health_mod.build_health_report())
    assert report["status"] == "healthy", report
    assert report["services"]["websocket"] == "disabled", report


# --- a configuracao le a variavel de ambiente ---
def test_settings_reads_mention_auto_reply_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A flag e lida do ambiente (MENTION_AUTO_REPLY)."""
    from hashpanel.config import Settings

    base = {
        "MASTODON_URL": "https://example.test",
        "CLIENT_KEY": "k",
        "CLIENT_SECRET": "s",
        "ACCESS_TOKEN": "t",
    }
    monkeypatch.setenv("MENTION_AUTO_REPLY", "false")
    s = Settings(**base)
    assert s.mention_auto_reply is False

    monkeypatch.setenv("MENTION_AUTO_REPLY", "true")
    s = Settings(**base)
    assert s.mention_auto_reply is True

    # default: ligado
    monkeypatch.delenv("MENTION_AUTO_REPLY", raising=False)
    s = Settings(**base)
    assert s.mention_auto_reply is True
