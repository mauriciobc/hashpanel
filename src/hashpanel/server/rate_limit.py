"""Limitação de requisições por IP, em memória.

Janelas fixas, com contagem por IP. É o suficiente para uma instância única e
não exige dependências extras.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

from hashpanel.utils.logger import get_logger

logger = get_logger()


@dataclass
class LimitRule:
    """Uma regra de limite: janela em segundos e máximo de requisições."""

    name: str
    window_seconds: int
    max_requests: int
    message: str
    error_code: str

    @property
    def window_ms(self) -> int:
        return self.window_seconds * 1000


API_RULE = LimitRule(
    name="api",
    window_seconds=15 * 60,
    max_requests=200,
    message="Too many requests from this IP, please try again later",
    error_code="RATE_LIMIT_EXCEEDED",
)

POSTING_RULE = LimitRule(
    name="posting",
    window_seconds=60 * 60,
    max_requests=10,
    message="Too many posts, please wait before posting again",
    error_code="POSTING_RATE_LIMIT_EXCEEDED",
)

LIGHT_RULE = LimitRule(
    name="light",
    window_seconds=5 * 60,
    max_requests=100,
    message="Too many requests, please wait a moment before trying again",
    error_code="LIGHT_RATE_LIMIT_EXCEEDED",
)


@dataclass
class _Bucket:
    """Janela de contagem para um par (regra, IP)."""

    count: int = 0
    reset_at: float = field(default=0.0)


class RateLimiter:
    """Contador em memória com janelas deslizantes fixas."""

    def __init__(self, rule: LimitRule) -> None:
        self.rule = rule
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> tuple[bool, int, float]:
        """Consome uma unidade do limite.

        Devolve ``(permitido, restantes, segundos_para_reset)``.
        """
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None or bucket.reset_at <= now:
                bucket = _Bucket(count=0, reset_at=now + self.rule.window_seconds)
                self._buckets[key] = bucket

            if bucket.count >= self.rule.max_requests:
                return False, 0, max(0.0, bucket.reset_at - now)

            bucket.count += 1
            remaining = max(0, self.rule.max_requests - bucket.count)
            return True, remaining, max(0.0, bucket.reset_at - now)

    def reset(self) -> None:
        """Limpa todos os contadores."""
        with self._lock:
            self._buckets.clear()


api_limiter = RateLimiter(API_RULE)
posting_limiter = RateLimiter(POSTING_RULE)
light_limiter = RateLimiter(LIGHT_RULE)


def client_key(request: Any) -> str:
    """Identificador do cliente, respeitando ``X-Forwarded-For`` quando confiável."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit_headers(rule: LimitRule, remaining: int, reset_seconds: float) -> dict[str, str]:
    """Cabeçalhos ``RateLimit-*`` padrão."""
    return {
        "RateLimit-Limit": str(rule.max_requests),
        "RateLimit-Remaining": str(remaining),
        "RateLimit-Reset": str(int(reset_seconds)),
    }
