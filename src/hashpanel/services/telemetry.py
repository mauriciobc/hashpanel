"""Telemetria anônima de uso (fusos horários dos visitantes).

Os dados ficam apenas em memória e são apagados periodicamente. Nada é
enviado para fora da aplicação.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta
from typing import Any

from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import (
    get_timezone_info,
    get_timezone_offset,
    is_at_timezone_boundary,
)

logger = get_logger()

MAX_REQUESTS_PER_TIMEZONE = 100
RETENTION_PERIOD = timedelta(hours=24)
PRUNE_INTERVAL_SECONDS = 3600


class TelemetryService:
    """Coleta estatísticas de uso por fuso horário."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.timezone_usage: dict[str, int] = {}
        self.requests_by_timezone: dict[str, list[dict[str, Any]]] = {}
        self.unique_timezones: set[str] = set()
        self.start_time = datetime.now(UTC)
        self.stats: dict[str, int] = {
            "totalRequests": 0,
            "requestsWithTimezone": 0,
            "requestsWithoutTimezone": 0,
            "invalidTimezones": 0,
            "boundaryRequests": 0,
        }
        self._stop_event = threading.Event()
        self._pruner = threading.Thread(target=self._prune_loop, daemon=True)
        self._pruner.start()

    def _prune_loop(self) -> None:
        """Remove requisições antigas periodicamente."""
        while not self._stop_event.wait(PRUNE_INTERVAL_SECONDS):
            self.prune_old_requests()

    def track_timezone(self, timezone: str | None, context: dict[str, Any] | None = None) -> None:
        """Registra o uso de um fuso horário."""
        with self._lock:
            self.stats["totalRequests"] += 1
            if not timezone:
                self.stats["requestsWithoutTimezone"] += 1
                return
            self.stats["requestsWithTimezone"] += 1

            info = get_timezone_info(timezone)
            if not info.get("isValid"):
                self.stats["invalidTimezones"] += 1
                return

            self.unique_timezones.add(timezone)
            self.timezone_usage[timezone] = self.timezone_usage.get(timezone, 0) + 1

            entries = self.requests_by_timezone.setdefault(timezone, [])
            entries.append(
                {
                    "timestamp": datetime.now(UTC).isoformat(),
                    "endpoint": (context or {}).get("endpoint"),
                    "userAgent": (context or {}).get("userAgent"),
                }
            )
            if len(entries) > MAX_REQUESTS_PER_TIMEZONE:
                del entries[0]

    def track_boundary_request(self, timezone: str, request_time: datetime | None = None) -> None:
        """Registra uma requisição feita perto da meia-noite local."""
        with self._lock:
            self.stats["boundaryRequests"] += 1
        logger.debug(
            "Request near timezone boundary detected",
            timezone=timezone,
            timezone_offset=get_timezone_offset(timezone),
        )

    def prune_old_requests(self) -> None:
        """Descarta requisições fora da janela de retenção."""
        cutoff = datetime.now(UTC) - RETENTION_PERIOD
        with self._lock:
            for timezone in list(self.requests_by_timezone):
                entries = [
                    entry
                    for entry in self.requests_by_timezone[timezone]
                    if datetime.fromisoformat(entry["timestamp"]) >= cutoff
                ]
                if not entries:
                    del self.requests_by_timezone[timezone]
                else:
                    self.requests_by_timezone[timezone] = entries

    def get_stats(self) -> dict[str, Any]:
        """Resumo da telemetria."""
        with self._lock:
            top = sorted(self.timezone_usage.items(), key=lambda item: item[1], reverse=True)[:10]
            with_timezone = self.stats["requestsWithTimezone"]
            top_timezones = [
                {
                    "timezone": tz,
                    "offset": get_timezone_offset(tz),
                    "count": count,
                    "percentage": (
                        f"{count / with_timezone * 100:.1f}" if with_timezone else "0.0"
                    ),
                }
                for tz, count in top
            ]
            return {
                "uptime": int((datetime.now(UTC) - self.start_time).total_seconds() * 1000),
                "stats": dict(self.stats),
                "uniqueTimezones": len(self.unique_timezones),
                "topTimezones": top_timezones,
                "timezoneDistribution": dict(self.timezone_usage),
            }

    def get_timezone_usage(self, timezone: str) -> dict[str, Any]:
        """Uso de um fuso específico."""
        with self._lock:
            return {
                "timezone": timezone,
                "count": self.timezone_usage.get(timezone, 0),
                "requests": list(self.requests_by_timezone.get(timezone, [])),
                "info": get_timezone_info(timezone),
            }

    def reset(self) -> None:
        """Zera os dados coletados."""
        with self._lock:
            self.timezone_usage.clear()
            self.requests_by_timezone.clear()
            self.unique_timezones.clear()
            self.stats = {
                "totalRequests": 0,
                "requestsWithTimezone": 0,
                "requestsWithoutTimezone": 0,
                "invalidTimezones": 0,
                "boundaryRequests": 0,
            }
            self.start_time = datetime.now(UTC)

    def stop(self) -> None:
        """Encerra a thread de limpeza."""
        self._stop_event.set()


_service: TelemetryService | None = None


def get_telemetry_service() -> TelemetryService:
    """Instância única do serviço de telemetria."""
    global _service
    if _service is None:
        _service = TelemetryService()
    return _service


def track_timezone_from_request(
    timezone: str | None, context: dict[str, Any] | None = None
) -> None:
    """Atalho usado pelo middleware, com detecção de meia-noite."""
    if not timezone:
        return
    service = get_telemetry_service()
    service.track_timezone(timezone, context)
    if is_at_timezone_boundary(datetime.now(UTC), timezone, 60):
        service.track_boundary_request(timezone)
