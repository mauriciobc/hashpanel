"""Regressão: o relatório diário que NÃO publica precisa sair com código != 0.

Bug: ``hashpanel report`` imprimia "Relatório não publicado: no_toots" mas
ainda saía com código 0. O script do cron (``scripts/cron-collect-history.sh``)
traduzia qualquer código 0 em "Relatório publicado com sucesso" — um no-op
silencioso parecendo publicação bem-sucedida.

A correção: ``run_daily_report`` devolve ``True`` (publicado) ou ``False``
(não publicado), e ``main`` devolve 1 quando o relatório não foi publicado.
"""

from __future__ import annotations

import argparse
from typing import Any
from unittest.mock import MagicMock

import pytest

from hashpanel.cli import main as cli_main


def _options(**overrides: Any) -> argparse.Namespace:
    base: dict[str, Any] = {
        "light": True,
        "dry_run": False,
        "trending": True,
        "date": None,
    }
    base.update(overrides)
    return argparse.Namespace(**base)


def _app(monkeypatch: pytest.MonkeyPatch, result: dict[str, Any]) -> Any:
    """CLIApplication com a publicação do relatório simulada."""
    app = cli_main.CLIApplication()
    monkeypatch.setattr(app, "validate_configuration", lambda: None)
    app.toots = MagicMock()
    app.toots.generate_and_post_daily_report.return_value = result
    return app


def test_run_daily_report_returns_true_when_published(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Publicação bem-sucedida devolve True."""
    app = _app(
        monkeypatch,
        {"success": True, "toot": {"id": "123", "url": "https://example/123"}},
    )
    assert app.run_daily_report(_options()) is True


def test_run_daily_report_returns_false_when_not_published(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nada publicado (no_toots) devolve False — o script do cron precisa saber."""
    app = _app(monkeypatch, {"success": False, "reason": "no_toots"})
    assert app.run_daily_report(_options()) is False


def test_main_exits_nonzero_when_report_not_published(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``hashpanel report`` sem posts sai com 1, e não com 0."""
    app = _app(monkeypatch, {"success": False, "reason": "no_toots"})
    monkeypatch.setattr(cli_main, "CLIApplication", lambda: app)
    assert cli_main.main(["report", "--light"]) == 1


def test_main_exits_zero_when_report_published(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``hashpanel report`` com publicação bem-sucedida sai com 0."""
    app = _app(
        monkeypatch,
        {"success": True, "toot": {"id": "123", "url": "https://example/123"}},
    )
    monkeypatch.setattr(cli_main, "CLIApplication", lambda: app)
    assert cli_main.main(["report", "--light"]) == 0


def test_cron_script_does_not_claim_success_on_failure() -> None:
    """O script do cron não pode anunciar sucesso sobre um relatório não publicado."""
    from pathlib import Path

    script = Path(__file__).resolve().parents[2] / "scripts" / "cron-collect-history.sh"
    if not script.exists():  # a imagem tem o código em /app, não o checkout
        script = Path("/app/scripts/cron-collect-history.sh")
    text = script.read_text(encoding="utf-8")
    assert "Relatório publicado com sucesso" in text
    assert "Relatório não publicado (código:" in text
    # o caminho de sucesso só é alcançado com código 0
    assert 'if [ $REPORT_EXIT_CODE -eq 0 ]; then' in text
