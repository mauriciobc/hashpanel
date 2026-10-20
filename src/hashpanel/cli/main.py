"""CLI do HashPanel.

Comandos::

    hashpanel                      # análise do dia (padrão)
    hashpanel analyze <hashtag>    # análise de uma hashtag específica
    hashpanel status               # estado da aplicação
    hashpanel report               # publica o relatório diário com imagem
    hashpanel help                 # esta ajuda
"""

from __future__ import annotations

import argparse
import signal
import sys
from typing import Any

from hashpanel.config import get_settings
from hashpanel.errors import BusinessError, ConfigurationError
from hashpanel.services.hashtags import get_hashtag_service
from hashpanel.services.toots import get_toot_service
from hashpanel.utils.logger import get_logger

logger = get_logger()


def build_parser() -> argparse.ArgumentParser:
    """Monta o parser de argumentos."""
    parser = argparse.ArgumentParser(
        prog="hashpanel",
        description="HashPanel — monitoramento de hashtags do Mastodon",
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="run",
        choices=["run", "analyze", "status", "report", "help"],
        help="comando a executar (padrão: run)",
    )
    parser.add_argument("hashtag", nargs="?", help="hashtag a analisar (comando analyze)")
    parser.add_argument("--dry-run", action="store_true", help="gera o resumo/imagem sem publicar")
    parser.add_argument(
        "--light", "--light-theme", dest="light", action="store_true", help="usa o tema claro"
    )
    parser.add_argument(
        "--no-trending", dest="no_trending", action="store_true", help="não mostra tags em alta"
    )
    parser.add_argument("--date", help="data específica (YYYY-MM-DD)")
    return parser


class CLIApplication:
    """Executa os comandos do CLI."""

    def __init__(self) -> None:
        self.hashtags = get_hashtag_service()
        self.toots = get_toot_service()
        self.is_running = False

    # --- comandos ---
    def run(self, options: argparse.Namespace) -> None:
        """Análise do dia: resumo e, se autorizado, publicação."""
        self.validate_configuration()

        hashtag = self.get_daily_hashtag(options.date)
        logger.info("Processing daily hashtag", hashtag=hashtag)

        analysis = self.hashtags.analyze_hashtag(hashtag)

        if not analysis.has_today_toots():
            print("Nenhum post encontrado para hoje. Encerrando.")
            return

        summary = self.toots.generate_summary(hashtag, analysis)
        print("\n=== RESUMO DO DIA ===")
        print(summary)
        print("===================\n")

        if not options.no_trending:
            self.show_trending_tags()

        if options.dry_run:
            print("Modo dry-run: post não publicado.")
            return

        if self.prompt_for_posting():
            self.post_summary(summary, hashtag)

    def run_daily_report(self, options: argparse.Namespace) -> None:
        """Publica o relatório do dia com a imagem gerada."""
        self.validate_configuration()
        theme = "light" if options.light else "dark"

        if options.dry_run:
            print("🚀 Gerando imagem do relatório (modo dry-run)...")
            settings = get_settings()
            hashtag = self.hashtags.get_daily_hashtag(timezone=settings.preferred_timezone)
            analysis = self.hashtags.analyze_hashtag(
                hashtag, timezone=settings.preferred_timezone, max_pages=3
            )

            if not analysis.has_today_toots():
                print("⚠️  Nenhum post encontrado para hoje.")
                return

            stats = {
                "hashtag": hashtag,
                "summary": {
                    "tootCount": analysis.get_today_count(),
                    "uniqueUsers": analysis.get_unique_user_count(),
                    "weeklyTotal": analysis.get_weekly_total(),
                },
            }

            from hashpanel.services.images import get_image_generator

            image_bytes, alt_text = get_image_generator().generate_dashboard_image(
                stats, theme=theme
            )
            suffix = "-light" if theme == "light" else ""
            path = f"./daily-report-{hashtag}{suffix}-preview.png"
            with open(path, "wb") as handle:
                handle.write(image_bytes)

            print("✅ Imagem gerada com sucesso!")
            print(f"📁 Salva em: {path}")
            print(f"🎨 Tema: {'Claro' if theme == 'light' else 'Escuro'}")
            print(f"📊 Dados: {stats['summary']['tootCount']} posts")
            print(f"♿ Texto ALT: {alt_text}")
            print("\nModo dry-run: nenhum post foi publicado.")
            return

        print("🚀 Iniciando processo de relatório diário com imagem...")
        print(f"🎨 Tema: {'Claro' if theme == 'light' else 'Escuro'}")

        result = self.toots.generate_and_post_daily_report(theme=theme)

        if result.get("success"):
            print("✅ Relatório diário publicado com sucesso!")
            print(f"📝 ID: {result['toot'].get('id')}")
            print(f"🔗 URL: {result['toot'].get('url')}")
        else:
            print(f"⚠️  Relatório não publicado: {result.get('reason')}")

    def analyze(self, hashtag: str) -> None:
        """Analisa uma hashtag específica."""
        if not hashtag:
            raise BusinessError("Hashtag is required for analysis")

        analysis = self.hashtags.analyze_hashtag(hashtag)

        print(f"\n=== ANÁLISE: #{hashtag} ===")
        print(f"Total de posts hoje: {analysis.get_today_count()}")
        print(f"Participantes únicos: {analysis.get_unique_user_count()}")
        print(f"Posts na semana: {analysis.get_weekly_total()}")

        print("\nTop posts:")
        for index, toot in enumerate(analysis.get_top_toots(5), start=1):
            username = (toot.get("account") or {}).get("username")
            print(f"{index}. @{username} (Score: {toot.get('relevanceScore')})")

        print("========================\n")

    def show_status(self) -> None:
        """Mostra o estado da aplicação e testa a conexão com a API."""
        settings = get_settings()

        print("\n=== STATUS DO HASHPANEL ===")
        print(f"Ambiente: {settings.node_env}")
        print(f"Timezone: {settings.preferred_timezone}")
        print(f"API Mastodon: {settings.mastodon_url}")

        try:
            result = self.hashtags.get_trending_tags(1)
            print("API Status: ✅ Conectado")
            print(f"Tags em alta disponíveis: {'Sim' if result['tags'] else 'Não'}")
        except Exception as exc:
            print("API Status: ❌ Erro de conexão")
            print(f"Erro: {exc}")

        print("========================\n")

    # --- auxiliares ---
    def validate_configuration(self) -> None:
        """Confere que as variáveis obrigatórias existem."""
        settings = get_settings()
        missing = [
            name
            for name, value in (
                ("MASTODON_URL", settings.mastodon_url),
                ("CLIENT_KEY", settings.client_key),
                ("CLIENT_SECRET", settings.client_secret),
                ("ACCESS_TOKEN", settings.access_token),
            )
            if not value
        ]
        if missing:
            raise ConfigurationError(
                f"Missing required environment variables: {', '.join(missing)}",
                details={"missingVars": missing},
            )

    @staticmethod
    def get_daily_hashtag(date: str | None = None) -> str:
        """Hashtag do dia (a primeira configurada)."""
        from datetime import datetime

        from hashpanel.utils.timezone import day_of_week

        settings = get_settings()
        target = datetime.fromisoformat(date) if date else datetime.now()
        weekday = day_of_week(target, settings.preferred_timezone)

        from hashpanel.constants import HASHTAGS, get_first_hashtag_for_day

        return get_first_hashtag_for_day(HASHTAGS[weekday])

    def show_trending_tags(self) -> None:
        """Lista as tags em alta."""
        print("\n=== TAGS EM ALTA ===")
        try:
            result = self.hashtags.get_trending_tags(5)
            tags = result["tags"]
            if not tags:
                print("Nenhuma tag em alta encontrada.")
                return
            for index, tag in enumerate(tags, start=1):
                history = tag.get("history") or []
                uses = history[0].get("uses", 0) if history else 0
                print(f"{index}. #{tag.get('name')} ({uses} usos)")
        except Exception:
            print("\n⚠️  Não foi possível carregar as tags em alta.")
        print("====================\n")

    @staticmethod
    def prompt_for_posting() -> bool:
        """Pergunta se o resumo deve ser publicado."""
        try:
            answer = input("Deseja publicar este post? (s/N) ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return False
        return answer in ("s", "sim")

    def post_summary(self, summary: str, hashtag: str) -> None:
        """Publica o resumo."""
        print("\n📤 Publicando post...")
        result = self.toots.post_summary(summary, hashtag)
        print("✅ Post publicado com sucesso!")
        print(f"📝 ID: {result.get('id')}")
        print(f"🔗 URL: {result.get('url')}")


def show_help() -> None:
    """Mostra a ajuda do CLI."""
    print(
        """
HashPanel - Monitoramento de hashtags do Mastodon

Comandos:
  run                    Executa analise diaria (padrao)
  report                 Gera e publica relatorio com imagem
  analyze <hashtag>     Analisa hashtag especifica
  status                 Mostra status da aplicacao
  help                   Mostra esta ajuda

Opcoes:
  --dry-run             Gera imagem/resumo sem publicar
  --light               Usa tema claro na imagem (padrao: escuro)
  --no-trending         Nao mostra tags em alta
  --date <YYYY-MM-DD>   Data especifica para analise

Exemplos:
  hashpanel
  hashpanel --dry-run
  hashpanel report --dry-run
  hashpanel report --light
  hashpanel analyze javascript
  hashpanel status
"""
    )


def main(argv: list[str] | None = None) -> int:
    """Ponto de entrada do CLI."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "help":
        show_help()
        return 0

    app = CLIApplication()

    try:
        if args.command == "analyze":
            if not args.hashtag:
                print("Erro: analyze requer uma hashtag.", file=sys.stderr)
                return 1
            app.analyze(args.hashtag)
        elif args.command == "status":
            app.show_status()
        elif args.command == "report":
            app.run_daily_report(args)
        else:
            app.run(args)
    except ConfigurationError as exc:
        print(f"\n❌ Erro: {exc.message}", file=sys.stderr)
        print("\nVerifique suas variáveis de ambiente no arquivo .env", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nEncerrado.", file=sys.stderr)
        return 130
    except Exception as exc:
        logger.error("CLI command failed", error=str(exc))
        print(f"\n❌ Erro: {exc}", file=sys.stderr)
        return 1

    return 0


def _install_signal_handlers() -> None:
    """Encerra o CLI com segurança ao receber Ctrl+C."""

    def handler(signum: int, _frame: Any) -> None:
        logger.info("Shutting down CLI", signal=signum)
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)


if __name__ == "__main__":  # pragma: no cover
    _install_signal_handlers()
    raise SystemExit(main())
