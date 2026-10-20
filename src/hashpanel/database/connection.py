"""Conexão com o banco SQLite.

A conexão é um singleton por processo: o primeiro acesso cria o arquivo (e o
diretório pai), roda as migrações e devolve a instância.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from types import TracebackType
from typing import Any

from hashpanel.database.migrations import run_migrations
from hashpanel.utils.logger import get_logger

logger = get_logger()


class DatabaseConnection:
    """Gerencia a conexão SQLite e o ciclo de vida das migrações."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        from hashpanel.config import get_settings

        settings = get_settings()
        self.db_path = Path(db_path) if db_path else settings.resolved_db_path

        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self._conn: sqlite3.Connection | None = None
        self._connect()

    def _connect(self) -> None:
        # ``isolation_level=None`` desliga o controle implícito de transações do
        # módulo ``sqlite3``. Sem isso, um INSERT abre uma transação que nunca
        # é confirmada e o dado é descartado quando a conexão fecha.
        conn = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        # WAL melhora a concorrência entre o servidor e o job de coleta.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        self._conn = conn
        logger.info("Database connection established", path=str(self.db_path))

    @property
    def connection(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError(
                "Database connection is closed. "
                "Connection must be reinitialized via get_database() singleton function."
            )
        return self._conn

    @property
    def is_closed(self) -> bool:
        return self._conn is None

    def migrate(self) -> None:
        """Aplica as migrações."""
        run_migrations(self.connection)

    def close(self) -> None:
        """Fecha a conexão."""
        if self._conn is not None:
            self._conn.close()
            self._conn = None
            logger.info("Database connection closed")

    def get_stats(self) -> dict[str, Any]:
        """Resumo do conteúdo da base."""
        try:
            row = self.connection.execute(
                """
                SELECT
                  COUNT(*) AS total_records,
                  COUNT(DISTINCT hashtag) AS unique_hashtags,
                  MIN(date) AS oldest_date,
                  MAX(date) AS newest_date
                FROM hashtag_history
                """
            ).fetchone()
            return {
                "connected": True,
                "path": str(self.db_path),
                "total_records": row["total_records"],
                "unique_hashtags": row["unique_hashtags"],
                "oldest_date": row["oldest_date"],
                "newest_date": row["newest_date"],
            }
        except sqlite3.Error as exc:
            logger.error("Failed to get database stats", error=str(exc))
            return {"connected": False, "path": str(self.db_path), "error": str(exc)}

    def health_check(self) -> dict[str, Any]:
        """Verifica se a base responde."""
        try:
            self.connection.execute("SELECT 1").fetchone()
            return {"status": "healthy", "connected": True}
        except sqlite3.Error as exc:
            logger.error("Database health check failed", error=str(exc))
            return {"status": "unhealthy", "connected": False, "error": str(exc)}

    def __enter__(self) -> DatabaseConnection:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()


_instance: DatabaseConnection | None = None


def get_database() -> DatabaseConnection:
    """Instância única da conexão (cria e migra no primeiro acesso)."""
    global _instance
    if _instance is None or _instance.is_closed:
        _instance = DatabaseConnection()
        _instance.migrate()
    return _instance


def reset_database() -> None:
    """Fecha e descarta a instância (usado nos testes)."""
    global _instance
    if _instance is not None:
        _instance.close()
    _instance = None
