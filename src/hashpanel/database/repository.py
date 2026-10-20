"""Acesso aos dados de histórico de hashtags.

Todas as consultas são parametrizadas. As linhas voltam como dicionários com
as mesmas chaves usadas pela API (camelCase), para que a camada HTTP não
precisa traduzir nomes.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from hashpanel.database.connection import get_database
from hashpanel.database.migrations import get_iso_week
from hashpanel.utils.jscompat import js_round_1, parse_int
from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import get_current_date_in_timezone

logger = get_logger()


def _week_row(row: Any) -> dict[str, Any]:
    return {
        "weekNumber": row["week_number"],
        "weekStart": row["week_start"],
        "weekEnd": row["week_end"],
        "totalUses": row["total_uses"] or 0,
        "totalAccounts": row["total_accounts"] or 0,
        "dailyAverage": js_round_1(row["daily_average"] or 0),
        "daysCounted": row["days_counted"],
    }


def _day_row(row: Any) -> dict[str, Any]:
    return {
        "date": row["date"],
        "uses": row["uses"] or 0,
        "accounts": row["accounts"] or 0,
        "year": row["year"],
        "weekNumber": row["week_number"],
    }


_WEEKLY_SELECT = """
    SELECT
      week_number,
      MIN(date) AS week_start,
      MAX(date) AS week_end,
      SUM(uses) AS total_uses,
      SUM(accounts) AS total_accounts,
      AVG(uses) AS daily_average,
      COUNT(*) AS days_counted
    FROM hashtag_history
    WHERE hashtag = ? AND year = ?
    GROUP BY week_number
    ORDER BY week_number ASC
"""


class HashtagHistoryRepository:
    """Persistência e leitura do histórico diário de hashtags."""

    def __init__(self, connection: Any | None = None) -> None:
        self._connection = connection

    @property
    def db(self) -> Any:
        return self._connection if self._connection is not None else get_database().connection

    # --- escrita ---
    def save_daily_data(
        self, hashtag: str, date: str, data: dict[str, Any], *, timezone: str | None = None
    ) -> bool:
        """Grava o uso de uma hashtag num dia.

        Devolve ``True`` quando a linha foi inserida e ``False`` quando já
        existia (a linha existente é preservada).
        """
        from hashpanel.config import get_settings

        zone = timezone or get_settings().preferred_timezone
        iso = get_iso_week(date, timezone=zone)
        uses = parse_int(data.get("uses"))
        accounts = parse_int(data.get("accounts"))

        cursor = self.db.execute(
            """
            INSERT OR IGNORE INTO hashtag_history
              (hashtag, date, year, week_number, uses, accounts, collected_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (hashtag, date, iso.year, iso.week_number, uses, accounts),
        )
        inserted = cursor.rowcount > 0
        if not inserted:
            logger.debug("Data already exists, skipping insert", hashtag=hashtag, date=date)
        return inserted

    def delete_old_data(self, days_to_keep: int = 365, *, timezone: str | None = None) -> int:
        """Remove registros anteriores à data de corte. Devolve as linhas removidas."""
        from hashpanel.config import get_settings

        zone = timezone or get_settings().preferred_timezone
        cutoff = date.fromisoformat(get_current_date_in_timezone(zone)) - timedelta(
            days=days_to_keep
        )
        cutoff_date = cutoff.isoformat()
        cursor = self.db.execute("DELETE FROM hashtag_history WHERE date < ?", (cutoff_date,))
        logger.info("Deleted old records", deleted=cursor.rowcount, before=cutoff_date)
        return cursor.rowcount

    # --- leitura ---
    def get_weekly_history(self, hashtag: str, year: int) -> list[dict[str, Any]]:
        """Histórico semanal de uma hashtag num ano."""
        rows = self.db.execute(_WEEKLY_SELECT, (hashtag, year)).fetchall()
        return [_week_row(row) for row in rows]

    def get_all_hashtags_weekly_history(self, year: int) -> dict[str, list[dict[str, Any]]]:
        """Histórico semanal de todas as hashtags que tiveram dados no ano."""
        rows = self.db.execute(
            """
            SELECT
              hashtag,
              week_number,
              MIN(date) AS week_start,
              MAX(date) AS week_end,
              SUM(uses) AS total_uses,
              SUM(accounts) AS total_accounts,
              AVG(uses) AS daily_average,
              COUNT(*) AS days_counted
            FROM hashtag_history
            WHERE year = ?
            GROUP BY hashtag, week_number
            ORDER BY hashtag, week_number ASC
            """,
            (year,),
        ).fetchall()

        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            grouped.setdefault(row["hashtag"], []).append(_week_row(row))
        return grouped

    def get_daily_history(
        self, hashtag: str, start_date: str, end_date: str | None = None
    ) -> list[dict[str, Any]]:
        """Histórico diário de uma hashtag entre duas datas (inclusivo)."""
        query = """
            SELECT date, uses, accounts, year, week_number
            FROM hashtag_history
            WHERE hashtag = ? AND date >= ?
        """
        params: list[Any] = [hashtag, start_date]
        if end_date:
            query += " AND date <= ?"
            params.append(end_date)
        query += " ORDER BY date ASC"

        rows = self.db.execute(query, params).fetchall()
        return [_day_row(row) for row in rows]

    def get_weekly_history_by_week(
        self, hashtag: str, year: int, week_number: int | None = None
    ) -> list[dict[str, Any]]:
        """Histórico semanal filtrado por número de semana."""
        query = """
            SELECT
              week_number,
              MIN(date) AS week_start,
              MAX(date) AS week_end,
              SUM(uses) AS total_uses,
              SUM(accounts) AS total_accounts,
              AVG(uses) AS daily_average,
              COUNT(*) AS days_counted
            FROM hashtag_history
            WHERE hashtag = ? AND year = ?
        """
        params: list[Any] = [hashtag, year]
        if week_number is not None:
            query += " AND week_number = ?"
            params.append(week_number)
        query += " GROUP BY week_number ORDER BY week_number ASC"

        rows = self.db.execute(query, params).fetchall()
        return [_week_row(row) for row in rows]

    def get_daily_data(self, hashtag: str, date: str) -> dict[str, Any] | None:
        """Dados de um dia específico, ou ``None`` se ainda não coletados."""
        row = self.db.execute(
            """
            SELECT date, uses, accounts, year, week_number
            FROM hashtag_history
            WHERE hashtag = ? AND date = ?
            """,
            (hashtag, date),
        ).fetchone()
        return _day_row(row) if row else None

    def get_latest_collection_date(self, hashtag: str) -> str | None:
        """Última data coletada de uma hashtag."""
        row = self.db.execute(
            "SELECT MAX(date) AS latest_date FROM hashtag_history WHERE hashtag = ?",
            (hashtag,),
        ).fetchone()
        return (row["latest_date"] or None) if row else None

    def has_data_for_date(self, hashtag: str, date: str) -> bool:
        """Indica se já existe coleta para o par hashtag/dia."""
        row = self.db.execute(
            "SELECT 1 FROM hashtag_history WHERE hashtag = ? AND date = ? LIMIT 1",
            (hashtag, date),
        ).fetchone()
        return row is not None

    def get_date_range(self, hashtag: str | None = None) -> dict[str, str | None]:
        """Primeira e última data coletadas (de uma hashtag ou de todas)."""
        query = "SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM hashtag_history"
        params: tuple[Any, ...] = ()
        if hashtag:
            query += " WHERE hashtag = ?"
            params = (hashtag,)
        row = self.db.execute(query, params).fetchone()
        return {
            "minDate": (row["min_date"] or None) if row else None,
            "maxDate": (row["max_date"] or None) if row else None,
        }

    def aggregate_weekly_data(self, hashtag: str, year: int) -> dict[str, Any]:
        """Histórico semanal de uma hashtag com resumo estatístico."""
        weekly_data = self.get_weekly_history(hashtag, year)

        if not weekly_data:
            return {
                "hashtag": hashtag,
                "year": year,
                "weeklyData": [],
                "summary": {
                    "totalWeeks": 0,
                    "totalUses": 0,
                    "totalAccounts": 0,
                    "averageWeekly": 0,
                    "peakWeek": None,
                },
            }

        total_uses = sum(week["totalUses"] for week in weekly_data)
        total_accounts = sum(week["totalAccounts"] for week in weekly_data)
        average_weekly = js_round_1(total_uses / len(weekly_data))
        peak_week = weekly_data[0]
        for week in weekly_data:
            if week["totalUses"] > peak_week["totalUses"]:
                peak_week = week

        return {
            "hashtag": hashtag,
            "year": year,
            "weeklyData": weekly_data,
            "summary": {
                "totalWeeks": len(weekly_data),
                "totalUses": total_uses,
                "totalAccounts": total_accounts,
                "averageWeekly": average_weekly,
                "peakWeek": {
                    "weekNumber": peak_week["weekNumber"],
                    "weekStart": peak_week["weekStart"],
                    "weekEnd": peak_week["weekEnd"],
                    "totalUses": peak_week["totalUses"],
                    "totalAccounts": peak_week["totalAccounts"],
                },
            },
        }
