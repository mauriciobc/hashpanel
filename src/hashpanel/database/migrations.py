"""Criação e evolução do schema SQLite.

O schema tem uma única tabela (``hashtag_history``). As migrações são
idempotentes e rodam a cada abertura da conexão, então não existe tabela de
versão.
"""

from __future__ import annotations

import sqlite3
from datetime import date
from typing import NamedTuple

from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import DEFAULT_TIMEZONE, parse_and_validate_timezone

logger = get_logger()


class IsoWeek(NamedTuple):
    """Ano ISO, semana ISO e os limites da semana."""

    year: int
    week_number: int
    week_start: str
    week_end: str


def get_iso_week(date_string: str, *, timezone: str = DEFAULT_TIMEZONE) -> IsoWeek:
    """Calcula a semana ISO de uma data ``YYYY-MM-DD``.

    O ano devolvido é o *ano ISO*, que pode diferir do ano civil na virada de
    ano (por exemplo, 2021-01-01 pertence à semana ISO 53 de 2020).
    """
    if not isinstance(date_string, str) or not date_string.strip():
        raise ValueError(f"Invalid dateString: must be a non-empty string, got: {date_string}")

    zone = parse_and_validate_timezone(timezone, fallback="UTC")
    try:
        parsed = date.fromisoformat(date_string.strip())
    except ValueError as exc:
        raise ValueError(
            f'Invalid date string: "{date_string}" could not be parsed with timezone "{zone}"'
        ) from exc

    iso_year, iso_week, iso_weekday = parsed.isocalendar()
    monday = parsed.fromordinal(parsed.toordinal() - (iso_weekday - 1))
    sunday = parsed.fromordinal(monday.toordinal() + 6)

    return IsoWeek(
        year=iso_year,
        week_number=iso_week,
        week_start=monday.isoformat(),
        week_end=sunday.isoformat(),
    )


SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS hashtag_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hashtag TEXT NOT NULL,
      date TEXT NOT NULL,
      year INTEGER NOT NULL,
      week_number INTEGER NOT NULL,
      uses INTEGER DEFAULT 0,
      accounts INTEGER DEFAULT 0,
      collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(hashtag, date)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_hashtag_date ON hashtag_history(hashtag, date)",
    "CREATE INDEX IF NOT EXISTS idx_hashtag_year_week "
    "ON hashtag_history(hashtag, year, week_number)",
    "CREATE INDEX IF NOT EXISTS idx_date ON hashtag_history(date)",
    "CREATE INDEX IF NOT EXISTS idx_year ON hashtag_history(year)",
)


def run_migrations(db: sqlite3.Connection) -> None:
    """Aplica o schema dentro de uma transação."""
    logger.info("Running database migrations...")
    transaction_active = False
    try:
        db.execute("BEGIN TRANSACTION")
        transaction_active = True
        for statement in SCHEMA_STATEMENTS:
            db.execute(statement)
        db.execute("COMMIT")
        transaction_active = False
        logger.info("Database migrations completed successfully")
    except Exception as exc:
        if transaction_active:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error as rollback_error:
                logger.error("Failed to rollback migration transaction", error=str(rollback_error))
        logger.error("Database migration failed", error=str(exc))
        raise RuntimeError(f"Migration failed: {exc}") from exc
