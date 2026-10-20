"""Configuração da aplicação, lida do ambiente.

Todas as variáveis passam por validação na inicialização: o processo falha
cedo com uma mensagem legível em vez de estourar no meio de uma requisição.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_TIMEZONE = "America/Sao_Paulo"
DEFAULT_MEDIA_ALLOWLIST = (
    "cdn.ursal.zone",
    "i.cdn.ursal.zone",
    "files.mastodon.social",
    "media.mastodon.social",
    "cdn.mastodon.social",
)


def _valid_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(
            f"'{value}' não é um identificador de fuso horário IANA válido "
            "(ex.: America/Sao_Paulo, UTC, Europe/London)"
        ) from exc
    return value


class Settings(BaseSettings):
    """Variáveis de ambiente com valores padrão seguros."""

    model_config = SettingsConfigDict(
        extra="ignore",
        case_sensitive=False,
    )

    @field_validator("*", mode="before")
    @classmethod
    def _strip_whitespace(cls, value: Any) -> Any:
        """Remove espaços nas pontas dos valores.

        Arquivos ``.env`` salvos com CRLF deixam um ``\\r`` no fim do valor
        quando as variáveis são exportadas pelo shell, o que quebraria, por
        exemplo, a validação do fuso horário.
        """
        if isinstance(value, str):
            return value.strip()
        return value

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: Any,
        env_settings: Any,
        dotenv_settings: Any,
        file_secret_settings: Any,
    ) -> tuple[Any, ...]:
        """Desativa a leitura automática do ``.env``.

        O arquivo é lido em :func:`get_settings`, que normaliza as quebras de
        linha CRLF antes de passar os valores.
        """
        return (init_settings, env_settings, dotenv_settings, file_secret_settings)

    # --- Mastodon (obrigatório) ---
    mastodon_url: str = Field(..., alias="MASTODON_URL")
    client_key: str = Field(..., alias="CLIENT_KEY")
    client_secret: str = Field(..., alias="CLIENT_SECRET")
    access_token: str = Field(..., alias="ACCESS_TOKEN")

    # --- Servidor ---
    port: int = Field(3000, alias="PORT")
    host: str = Field("0.0.0.0", alias="HOST")
    server_public_url: str | None = Field(None, alias="SERVER_PUBLIC_URL")
    preferred_timezone: str = Field(DEFAULT_TIMEZONE, alias="PREFERRED_TIMEZONE")
    log_level: str = Field("info", alias="LOG_LEVEL")
    node_env: str = Field("development", alias="NODE_ENV")
    cors_origin: str | None = Field(None, alias="CORS_ORIGIN")
    trust_proxy: str = Field("1", alias="TRUST_PROXY")

    # --- Performance ---
    api_timeout_ms: int = Field(30000, alias="API_TIMEOUT_MS")
    rate_limit_delay_ms: int = Field(1000, alias="RATE_LIMIT_DELAY_MS")
    max_api_pages: int = Field(20, alias="MAX_API_PAGES")
    toots_per_page: int = Field(40, alias="TOOTS_PER_PAGE")

    # --- Cache ---
    cache_ttl_seconds: int = Field(300, alias="CACHE_TTL_SECONDS")
    enable_cache: bool = Field(True, alias="ENABLE_CACHE")

    # --- Banco de dados ---
    db_path: str | None = Field(None, alias="DB_PATH")

    # --- Proxy de mídia ---
    media_proxy_allowlist: str | None = Field(None, alias="MEDIA_PROXY_ALLOWLIST")
    media_proxy_cache_max_mb: int = Field(50, alias="MEDIA_PROXY_CACHE_MAX_MB")
    media_proxy_cache_max_entries: int = Field(200, alias="MEDIA_PROXY_CACHE_MAX_ENTRIES")

    # --- Health check ---
    healthcheck_timeout_ms: int = Field(2500, alias="HEALTHCHECK_TIMEOUT_MS")

    @field_validator("mastodon_url")
    @classmethod
    def _check_mastodon_url(cls, value: str) -> str:
        """Normaliza a URL da instância para a raiz do host.

        A biblioteca ``Mastodon.py`` acrescenta o caminho da API
        (``/api/v1/...``) por conta própria, então a URL configurada precisa
        ser a raiz da instância. Aceitamos tanto ``https://exemplo.com`` quanto
        ``https://exemplo.com/api/v1/``.
        """
        if not value.startswith(("http://", "https://")):
            raise ValueError("MASTODON_URL deve começar com http:// ou https://")

        cleaned = value.strip().rstrip("/")
        for suffix in ("/api/v2", "/api/v1", "/api"):
            if cleaned.endswith(suffix):
                cleaned = cleaned[: -len(suffix)]
                break

        if not cleaned:
            raise ValueError("MASTODON_URL precisa de um host válido")
        return cleaned

    @field_validator("preferred_timezone")
    @classmethod
    def _check_timezone(cls, value: str) -> str:
        return _valid_timezone(value)

    @field_validator("api_timeout_ms", "healthcheck_timeout_ms")
    @classmethod
    def _min_timeout(cls, value: int) -> int:
        if value < 500:
            raise ValueError("timeouts devem ser no mínimo 500ms")
        return value

    @field_validator("rate_limit_delay_ms")
    @classmethod
    def _non_negative_delay(cls, value: int) -> int:
        if value < 0:
            raise ValueError("RATE_LIMIT_DELAY_MS não pode ser negativo")
        return value

    @field_validator("max_api_pages", "toots_per_page", "cache_ttl_seconds")
    @classmethod
    def _positive(cls, value: int) -> int:
        if value < 1:
            raise ValueError("o valor deve ser no mínimo 1")
        return value

    @field_validator("media_proxy_cache_max_mb", "media_proxy_cache_max_entries")
    @classmethod
    def _positive_media(cls, value: int) -> int:
        if value < 1:
            raise ValueError("o valor deve ser no mínimo 1")
        return value

    @field_validator("log_level")
    @classmethod
    def _known_level(cls, value: str) -> str:
        level = value.lower()
        if level not in {"error", "warn", "info", "debug"}:
            return "info"
        return level

    # --- Propriedades derivadas ---
    @property
    def media_allowlist(self) -> list[str]:
        raw = self.media_proxy_allowlist
        if raw is None or not raw.strip():
            return list(DEFAULT_MEDIA_ALLOWLIST)
        return [entry.strip() for entry in raw.split(",") if entry.strip()]

    @property
    def resolved_server_public_url(self) -> str:
        if self.server_public_url:
            return self.server_public_url.rstrip("/")
        return f"http://localhost:{self.port}"

    @property
    def resolved_db_path(self) -> Path:
        if self.db_path:
            return Path(self.db_path).expanduser()
        return Path.cwd() / "data" / "hashpanel.db"

    @property
    def is_production(self) -> bool:
        return self.node_env == "production"

    @property
    def allowed_origins(self) -> list[str]:
        if not self.cors_origin:
            return []
        return [origin.strip() for origin in self.cors_origin.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Instância única de :class:`Settings` (cacheada por processo)."""
    try:
        return Settings(**_read_dotenv())
    except Exception as exc:  # pragma: no cover - dependente do ambiente
        raise RuntimeError(
            "Configuração inválida. Verifique as variáveis de ambiente "
            "(MASTODON_URL, CLIENT_KEY, CLIENT_SECRET, ACCESS_TOKEN).\n"
            f"Detalhe: {exc}"
        ) from exc


def _read_dotenv() -> dict[str, Any]:
    """Lê o arquivo ``.env`` e devolve os valores prontos para o modelo.

    O ``python-dotenv`` remove a quebra de linha final de cada valor, então
    arquivos salvos com CRLF funcionam igual aos salvos com LF. As variáveis
    já presentes no ambiente têm prioridade sobre o arquivo.
    """
    from dotenv import dotenv_values

    env_file = Path(".env")
    if not env_file.exists():
        return {}

    values: dict[str, Any] = {}
    for key, value in dotenv_values(env_file, encoding="utf-8").items():
        if value is None:
            continue
        if key in os.environ:
            # O ambiente real tem prioridade sobre o arquivo.
            continue
        values[key] = value.strip()

    return values


def reset_settings_cache() -> None:
    """Limpa o cache de :func:`get_settings` (usado nos testes)."""
    get_settings.cache_clear()
