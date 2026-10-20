"""Proxy de imagens.

As mídias do Mastodon vêm de domínios que não permitem carregamento direto no
navegador (CORS). O proxy busca a imagem, valida a origem, limita o tamanho e
mantém um cache curto em memória.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from hashpanel.config import get_settings
from hashpanel.errors import ValidationError
from hashpanel.server.errors import error_response
from hashpanel.server.rate_limit import LIGHT_RULE, client_key, light_limiter
from hashpanel.utils.logger import get_logger

logger = get_logger()

router = APIRouter()

CACHE_TTL_SECONDS = 3600
MAX_IMAGE_SIZE = 10 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 10

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


@dataclass
class CacheEntry:
    """Uma imagem guardada em cache."""

    data: bytes
    content_type: str
    timestamp: float
    last_access: float


class ImageCache:
    """Cache em memória com TTL e limite de tamanho (eviction por LRU)."""

    def __init__(self, max_entries: int, max_bytes: int) -> None:
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self._entries: dict[str, CacheEntry] = {}
        self._current_bytes = 0
        self._lock = threading.Lock()

    def get(self, url: str) -> CacheEntry | None:
        """Devolve a entrada válida, ou ``None``."""
        with self._lock:
            entry = self._entries.get(url)
            if entry is None:
                return None
            if time.monotonic() - entry.timestamp > CACHE_TTL_SECONDS:
                self._remove(url, entry)
                return None
            entry.last_access = time.monotonic()
            return entry

    def set(self, url: str, data: bytes, content_type: str) -> None:
        """Guarda uma imagem, removendo as mais antigas quando necessário."""
        with self._lock:
            existing = self._entries.pop(url, None)
            if existing is not None:
                self._current_bytes -= existing.data.__len__()

            entry = CacheEntry(
                data=data,
                content_type=content_type,
                timestamp=time.monotonic(),
                last_access=time.monotonic(),
            )
            self._entries[url] = entry
            self._current_bytes += len(data)

            # Descarta entradas expiradas.
            now = time.monotonic()
            for key in list(self._entries):
                item = self._entries[key]
                if now - item.timestamp > CACHE_TTL_SECONDS:
                    self._remove(key, item)

            # Aplica os limites, evictando pela última leitura.
            while self._entries and (
                len(self._entries) > self.max_entries or self._current_bytes > self.max_bytes
            ):
                oldest = min(self._entries.items(), key=lambda item: item[1].last_access)
                self._remove(oldest[0], oldest[1])

    def _remove(self, url: str, entry: CacheEntry) -> None:
        self._entries.pop(url, None)
        self._current_bytes -= len(entry.data)


_cache: ImageCache | None = None


def get_cache() -> ImageCache:
    """Instância única do cache de imagens."""
    global _cache
    if _cache is None:
        settings = get_settings()
        _cache = ImageCache(
            max_entries=settings.media_proxy_cache_max_entries,
            max_bytes=settings.media_proxy_cache_max_mb * 1024 * 1024,
        )
    return _cache


def validate_image_url(url: str) -> str:
    """Valida a origem da imagem contra a lista permitida."""
    if not url or not isinstance(url, str):
        raise ValidationError("Image URL is required")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValidationError("Invalid protocol. Only HTTP/HTTPS allowed")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValidationError("Invalid URL format")

    allowlist = get_settings().media_allowlist
    allowed = any(hostname == domain or hostname.endswith(f".{domain}") for domain in allowlist)
    if not allowed:
        logger.warning("Image URL from non-whitelisted domain", hostname=hostname)
        raise ValidationError("Image host is not allowed")

    return url


@router.get("/proxy")
async def proxy_image(
    request: Request,
    url: str = Query(...),
    cache: str = Query("true"),
) -> Any:
    """Busca uma imagem permitted e a devolve com CORS liberado."""
    key = client_key(request)
    allowed, _remaining, reset_seconds = light_limiter.check(key)
    if not allowed:
        logger.warning("Light rate limit exceeded", ip=key)
        response = error_response(
            LIGHT_RULE.message,
            LIGHT_RULE.error_code,
            429,
            details={
                "retryAfter": int(reset_seconds) + 1,
                "resetTime": (
                    datetime.now().astimezone() + timedelta(seconds=reset_seconds)
                ).isoformat(),
            },
        )
        response.headers["Retry-After"] = str(int(reset_seconds) + 1)
        return response

    try:
        validated_url = validate_image_url(url)
    except ValidationError as exc:
        return error_response(exc.message, exc.code, exc.status_code, details=exc.details)

    use_cache = cache != "false"
    if use_cache:
        cached = get_cache().get(validated_url)
        if cached is not None:
            return Response(
                content=cached.data,
                media_type=cached.content_type,
                headers={
                    "Cache-Control": "public, max-age=3600",
                    "X-Cache": "HIT",
                },
            )

    origin = f"{urlparse(validated_url).scheme}://{urlparse(validated_url).netloc}"
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{origin}/",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
    }

    try:
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            response = await client.get(validated_url, headers=headers)
    except httpx.TimeoutException:
        logger.warning("Image fetch timeout", url=validated_url)
        return error_response("Image fetch timeout", "VALIDATION_ERROR", 400)
    except httpx.HTTPError as exc:
        logger.error("Failed to proxy image", url=validated_url, error=str(exc))
        return error_response(f"Failed to fetch image: {exc}", "VALIDATION_ERROR", 400)

    if response.status_code in (403, 404):
        logger.warning("Image not accessible", url=validated_url, status=response.status_code)
        return error_response(
            "The requested image is no longer available", "IMAGE_NOT_AVAILABLE", 404
        )

    if response.status_code >= 400:
        logger.warning("Image upstream error", url=validated_url, status=response.status_code)
        return error_response(
            f"Failed to fetch image: {response.status_code}", "VALIDATION_ERROR", 400
        )

    content_type = response.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        return error_response("URL does not point to an image", "VALIDATION_ERROR", 400)

    data = response.content
    if len(data) > MAX_IMAGE_SIZE:
        return error_response("Image too large", "VALIDATION_ERROR", 400)

    if use_cache:
        get_cache().set(validated_url, data, content_type)

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Cache": "MISS",
            "Content-Length": str(len(data)),
        },
    )
