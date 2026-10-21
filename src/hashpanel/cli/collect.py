"""Coleta do histórico — executado pelo cron.

Uso::

    hashpanel-collect                    # coleta de hoje
    hashpanel-collect --date 2026-01-15  # uma data específica
    hashpanel-collect --range 2026-01-01 2026-01-31
    hashpanel-collect --last-7-days
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta

from hashpanel.config import get_settings
from hashpanel.database.connection import get_database
from hashpanel.services.collector import HistoryCollector
from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import get_current_date_in_timezone

logger = get_logger()


def build_parser() -> argparse.ArgumentParser:
    """Monta o parser de argumentos."""
    parser = argparse.ArgumentParser(
        prog="hashpanel-collect",
        description="Coleta o histórico de uso das hashtags do Mastodon",
    )
    parser.add_argument("--date", help="data específica (YYYY-MM-DD)")
    parser.add_argument("--range", nargs=2, metavar=("INICIO", "FIM"), help="intervalo de datas")
    parser.add_argument("--last-7-days", action="store_true", help="coleta os últimos 7 dias")
    return parser


def _print_summary(title: str, summary: dict) -> None:
    """Imprime o resumo da coleta."""
    print(f"\n{title}")
    for key, value in summary.items():
        print(f"  {key}: {value}")


def main(argv: list[str] | None = None) -> int:
    """Ponto de entrada da coleta."""
    parser = build_parser()
    args = parser.parse_args(argv)

    flags = [bool(args.date), bool(args.range), bool(args.last_7_days)]
    if sum(flags) > 1:
        print(
            "Error: Flags --date, --range, and --last-7-days are mutually exclusive",
            file=sys.stderr,
        )
        return 1

    settings = get_settings()
    database = get_database()
    collector = HistoryCollector()

    try:
        if args.last_7_days:
            end = get_current_date_in_timezone(settings.preferred_timezone)
            start = (datetime.fromisoformat(end) - timedelta(days=6)).strftime("%Y-%m-%d")
            print(f"Collecting history data from {start} to {end} (last 7 days)...")
            summary = collector.collect_date_range(start, end)
            _print_summary(
                "Collection Summary:",
                {
                    "Date Range": f"{start} to {end}",
                    "Total Days": summary["totalDays"],
                    "Collected": summary["totalCollected"],
                    "Skipped": summary["totalSkipped"],
                    "Errors": summary["totalErrors"],
                },
            )
        elif args.range:
            start, end = args.range
            print(f"Collecting history data from {start} to {end}...")
            summary = collector.collect_date_range(start, end)
            _print_summary(
                "Collection Summary:",
                {
                    "Date Range": f"{start} to {end}",
                    "Total Days": summary["totalDays"],
                    "Collected": summary["totalCollected"],
                    "Skipped": summary["totalSkipped"],
                    "Errors": summary["totalErrors"],
                },
            )
        elif args.date:
            print(f"Collecting history data for {args.date}...")
            summary = collector.collect_all_hashtags(args.date)
            _print_summary(
                "Collection Summary:",
                {
                    "Date": summary["date"],
                    "Total Hashtags": summary["totalHashtags"],
                    "Collected": summary["collected"],
                    "Skipped": summary["skipped"],
                    "Errors": summary["errors"],
                },
            )
        else:
            print("Collecting today's history data for all hashtags...")
            summary = collector.collect_all_hashtags()
            _print_summary(
                "Collection Summary:",
                {
                    "Date": summary["date"],
                    "Total Hashtags": summary["totalHashtags"],
                    "Collected": summary["collected"],
                    "Skipped": summary["skipped"],
                    "Errors": summary["errors"],
                },
            )

        errors = summary.get("totalErrors")
        if errors is None:
            errors = summary.get("errors", 0)

        if errors:
            print(
                f"\n❌ Collection finished with {errors} error(s); "
                "some hashtags could not be collected.",
                file=sys.stderr,
            )
            return 1

        print("\n✅ Collection completed successfully")
        return 0
    except Exception as exc:
        logger.error("Collection script failed", error=str(exc))
        print(f"\n❌ Collection failed: {exc}", file=sys.stderr)
        return 1
    finally:
        database.close()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
