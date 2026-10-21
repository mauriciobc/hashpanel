"""Limitação de requisições por IP, em memória.

Janelas fixas, com contagem por IP. É o suficiente para uma instância única e
não exige dependências extras.
"""

from __future__ import annotations

import ipaddress
import threading
import time
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from hashpanel.config import get_settings
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


def _address(value: str) -> Any | None:
    """Endereço normalizado; um IPv4 mapeado em IPv6 vira IPv4."""
    try:
        parsed = ipaddress.ip_address(value.strip())
    except ValueError:
        return None
    mapped = getattr(parsed, "ipv4_mapped", None)
    return mapped or parsed


def _canonical(value: str) -> str:
    """Forma canônica do endereço, para o balde do limite."""
    address = _address(value)
    return str(address) if address is not None else value.strip()


@lru_cache(maxsize=8)
def _parsed_networks(raw: str) -> tuple[Any, ...]:
    """Redes confiáveis já validadas.

    O cabeçalho ``TRUSTED_PROXY_IPS`` é validado uma vez por valor: uma
    entrada inválida vira um aviso no log, e não um aviso por requisição.
    """
    parsed: list[Any] = []
    for entry in (part.strip() for part in raw.split(",") if part.strip()):
        try:
            parsed.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            logger.warning("Invalid trusted proxy network", network=entry)
    return tuple(parsed)


def _is_trusted_proxy(peer: str) -> bool:
    """Indica se o peer imediato é um proxy reverso confiável.

    A lista vem de ``TRUSTED_PROXY_IPS`` (redes CIDR). Sem essa lista, não
    há proxy conhecido: o endereço de origem vale.

    A checagem é explícita de propósito. Num container com porta
    publicada, o endereço de origem de um cliente externo também é privado
    (a rede do Docker), então "peer privado" não distingue o proxy de um
    atacante — e o ``X-Forwarded-For`` dele seria aceito.
    """
    networks = _parsed_networks(",".join(get_settings().trusted_proxy_networks))
    if not networks:
        return False

    address = _address(peer)
    if address is None:
        return False

    return any(address in network for network in networks)


def client_key(request: Any) -> str:
    """Identificador do cliente para os limites de requisição.

    O endereço de origem (``request.client.host``) é a única fonte
    confiável. O cabeçalho ``X-Forwarded-For`` é controlado por quem faz a
    requisição e só vale quando a requisição passou por um proxy reverso
    confiável:

    * ``TRUST_PROXY=false`` (ou ``0``) — o cabeçalho é ignorado;
    * ``TRUST_PROXY=n`` — o endereço do cliente é o n-ésimo a partir do fim
      da cadeia, e os elementos à esquerda dele são descartados porque foram
      injetados pelo próprio cliente.

    O cabeçalho só é considerado quando o peer imediato pertence a uma das
    redes de ``TRUSTED_PROXY_IPS``. Sem isso, cada requisição cairia em um
    balde novo e zeraria os limites — inclusive o de publicação, que não tem
    autenticação.
    """
    peer = request.client.host if request.client else "unknown"
    canonical_peer = _canonical(peer)

    hops = get_settings().trusted_proxy_hops
    if hops <= 0:
        return canonical_peer

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return canonical_peer

    if not _is_trusted_proxy(peer):
        return canonical_peer

    chain = [entry.strip() for entry in forwarded.split(",") if entry.strip()]
    if not chain:
        return canonical_peer

    # O Caddy (e o nginx, na configuração deste projeto) sobrescreve
    # ``X-Forwarded-For`` com o endereço do cliente: a cadeia tem um só
    # elemento. Quando o proxy concatena, o cliente é o n-ésimo a partir
    # do fim, e o que o cliente escreveu à esquerda é descartado.
    index = len(chain) - hops
    if index < 0:
        return canonical_peer

    return _canonical(chain[index])


def rate_limit_headers(rule: LimitRule, remaining: int, reset_seconds: float) -> dict[str, str]:
    """Cabeçalhos ``RateLimit-*`` padrão."""
    return {
        "RateLimit-Limit": str(rule.max_requests),
        "RateLimit-Remaining": str(remaining),
        "RateLimit-Reset": str(int(reset_seconds)),
    }
