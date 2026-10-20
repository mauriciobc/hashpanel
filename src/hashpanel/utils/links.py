"""Geração de links para o Mastodon (posts, perfis, tags)."""

from __future__ import annotations

from functools import lru_cache
from urllib.parse import urlparse, urlunparse

from hashpanel.errors import ValidationError


@lru_cache(maxsize=1)
def _base_url(mastodon_url: str) -> str:
    """Raiz pública da instância (sem o caminho de API)."""
    parsed = urlparse(mastodon_url)
    if not parsed.scheme or not parsed.netloc:
        return mastodon_url.rstrip("/")

    path = parsed.path or ""
    normalized = path[:-1] if path.endswith("/") else path
    # Caminhos de API (/api, /api/v1, /api/v2) não fazem parte da URL pública.
    if normalized in ("", "/api") or normalized.startswith("/api/v"):
        normalized = ""

    return urlunparse((parsed.scheme, parsed.netloc, normalized, "", "", ""))


def _join(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def generate_toot_link(toot_id: str, *, mastodon_url: str) -> str:
    """Link público de um post."""
    if not toot_id:
        raise ValidationError("Toot ID is required")
    if not isinstance(toot_id, str):
        raise ValidationError("Toot ID must be a string")
    return _join(_base_url(mastodon_url), f"web/statuses/{toot_id}")


def generate_profile_link(username: str, *, mastodon_url: str, instance: str | None = None) -> str:
    """Link público do perfil de um usuário."""
    if not username:
        raise ValidationError("Username is required")
    base = (instance or _base_url(mastodon_url)).rstrip("/")
    return _join(base, f"@{username}")


def generate_hashtag_link(hashtag: str, *, mastodon_url: str, instance: str | None = None) -> str:
    """Link público da página de uma tag."""
    if not hashtag:
        raise ValidationError("Hashtag is required")
    clean = hashtag[1:] if hashtag.startswith("#") else hashtag
    base = (instance or _base_url(mastodon_url)).rstrip("/")
    return _join(base, f"tags/{clean}")


def extract_toot_id(url: str) -> str:
    """Extrai o ID numérico de um link de post."""
    if not url:
        raise ValidationError("URL is required")

    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    for part in reversed(parts):
        if part.isdigit():
            return part
    raise ValidationError(f"No toot ID found in URL: {url}")


def validate_mastodon_url(url: str) -> bool:
    """Verifica se a URL é HTTP(S) e parece um host de instância."""
    if not url:
        raise ValidationError("URL is required")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValidationError("URL must use HTTP or HTTPS protocol")
    if not parsed.hostname or len(parsed.hostname) < 3:
        raise ValidationError("Invalid hostname in URL")
    return True


def parse_mastodon_url(url: str) -> dict[str, str | bool]:
    """Quebra uma URL do Mastodon em seus componentes relevantes."""
    if not url:
        raise ValidationError("URL is required")

    parsed = urlparse(url)
    return {
        "protocol": parsed.scheme,
        "hostname": parsed.hostname or "",
        "port": str(parsed.port or ""),
        "origin": urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")),
        "pathname": parsed.path,
        "isApi": "/api/" in parsed.path,
        "isWeb": "/web/" in parsed.path,
        "instance": urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")),
    }


def generate_short_url(url: str) -> str:
    """Versão curta de uma URL, para logs."""
    if not url:
        return ""
    parsed = urlparse(url)
    short = f"{parsed.scheme}//{parsed.hostname}{parsed.path}"
    return f"{short[:47]}..." if len(short) > 50 else short
