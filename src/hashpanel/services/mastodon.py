"""Cliente do Mastodon, construído sobre a biblioteca ``Mastodon.py``.

Esta camada isola o resto da aplicação da API: normaliza erros, aplica o
intervalo mínimo entre chamadas, registra os limites de taxa vindos do servidor
e devolve objetos simples (dicionários) em vez dos tipos do cliente.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from mastodon import Mastodon
from mastodon.errors import (
    MastodonAPIError,
    MastodonError,
    MastodonNetworkError,
    MastodonNotFoundError,
    MastodonRatelimitError,
    MastodonReadTimeout,
    MastodonServerError,
    MastodonUnauthorizedError,
)

from hashpanel.config import get_settings
from hashpanel.errors import ApiError, NotFoundError, RateLimitError
from hashpanel.utils.logger import get_logger

logger = get_logger()


def _to_dict(value: Any) -> Any:
    """Converte os objetos do Mastodon.py em dicionários comuns."""
    if value is None:
        return None
    if isinstance(value, dict):
        return {key: _to_dict(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_to_dict(item) for item in value]
    if isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "to_dict"):
        try:
            return {key: _to_dict(item) for key, item in value.to_dict().items()}
        except Exception:  # pragma: no cover - defensivo
            pass
    if hasattr(value, "items"):
        try:
            return {key: _to_dict(item) for key, item in value.items()}
        except Exception:  # pragma: no cover - defensivo
            pass
    return value


class MastodonService:
    """Operações do Mastodon usadas pelo HashPanel."""

    def __init__(self, client: Mastodon | None = None) -> None:
        self.settings = get_settings()
        self.client = client or self._build_client()
        self.request_count = 0
        self.last_request_time = 0.0
        self.rate_limit_info: dict[str, Any] = {
            "limit": None,
            "remaining": None,
            "reset": None,
            "lastUpdated": None,
        }
        self._lock = threading.Lock()

    def _build_client(self) -> Mastodon:
        """Monta o cliente ``Mastodon.py``.

        Três escolhas evitam problemas conhecidos da biblioteca:

        * ``version_check_mode="none"`` dispensa a detecção automática da
          versão do servidor. Com ela, a biblioteca entra em recursão infinita
          quando o endpoint ``/api/v1/instance`` falha, porque a flag de
          "versão detectada com sucesso" nunca é marcada.
        * A versão assumida é informada explicitamente. A biblioteca só lê o
          parâmetro quando a detecção automática está desligada, então
          definimos os campos usados para escolher entre endpoints
          legados e modernos (por exemplo, ``/api/v1/trends/tags`` em vez
          do ``/api/v1/trends``, que está obsoleto).
        * ``api_base_url`` é a raiz da instância: a biblioteca acrescenta o
          caminho da API por conta própria.
        """
        settings = self.settings
        client = Mastodon(
            client_id=settings.client_key,
            client_secret=settings.client_secret,
            access_token=settings.access_token,
            api_base_url=settings.mastodon_url,
            request_timeout=settings.api_timeout_ms / 1000,
            user_agent="HashPanel/1.0",
            version_check_mode="none",
        )
        client.mastodon_major = 4
        client.mastodon_minor = 2
        client.mastodon_patch = 0
        return client

    # --- controle de taxa ---
    def _apply_rate_limit(self) -> None:
        """Garante o intervalo mínimo entre chamadas à API."""
        delay_ms = self.settings.rate_limit_delay_ms
        if delay_ms <= 0:
            with self._lock:
                self.last_request_time = time.monotonic()
                self.request_count += 1
            return

        with self._lock:
            elapsed = (time.monotonic() - self.last_request_time) * 1000
            if elapsed < delay_ms:
                time.sleep((delay_ms - elapsed) / 1000)
            self.last_request_time = time.monotonic()
            self.request_count += 1

    def _record_rate_limit(self, client: Mastodon) -> None:
        """Guarda os limites de taxa informados pelo servidor."""
        limit = getattr(client, "ratelimit_limit", None)
        remaining = getattr(client, "ratelimit_remaining", None)
        reset = getattr(client, "ratelimit_reset", None)

        if limit is None and remaining is None and reset is None:
            return

        self.rate_limit_info = {
            "limit": limit,
            "remaining": remaining,
            "reset": reset,
            "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        if remaining is not None and remaining < 50:
            logger.warning("Mastodon API rate limit low", remaining=remaining, limit=limit)
        elif remaining is not None and remaining < 100:
            logger.info("Mastodon API rate limit status", remaining=remaining, limit=limit)

    def get_rate_limit_info(self) -> dict[str, Any]:
        """Cópia das informações de limite de taxa."""
        return dict(self.rate_limit_info)

    # --- núcleo ---
    def _call(self, operation: str, func: Any, *args: Any, **kwargs: Any) -> Any:
        """Executa uma chamada à API com tratamento de erro uniforme."""
        self._apply_rate_limit()
        try:
            result = func(*args, **kwargs)
        except MastodonRatelimitError as exc:
            raise RateLimitError(
                "Mastodon API rate limit exceeded", retry_after=getattr(exc, "retry_after", None)
            ) from exc
        except MastodonNotFoundError as exc:
            raise NotFoundError(f"Resource not found: {operation}", resource=operation) from exc
        except MastodonUnauthorizedError as exc:
            raise ApiError(
                f"Mastodon rejected the credentials for {operation}: {exc}",
                original_error=str(exc),
                details={"operation": operation, "status": 401},
            ) from exc
        except (MastodonReadTimeout, MastodonNetworkError) as exc:
            raise ApiError(
                f"Network error while calling {operation}: {exc}",
                original_error=str(exc),
                details={"operation": operation, "timeout": True},
            ) from exc
        except MastodonServerError as exc:
            raise ApiError(
                f"Mastodon server error while calling {operation}: {exc}",
                original_error=str(exc),
                details={"operation": operation},
            ) from exc
        except MastodonAPIError as exc:
            status = getattr(exc, "status_code", None)
            if status == 429:
                raise RateLimitError("Mastodon API rate limit exceeded") from exc
            if status == 404:
                raise NotFoundError(f"Resource not found: {operation}", resource=operation) from exc
            raise ApiError(
                f"Mastodon API error while calling {operation}: {exc}",
                original_error=str(exc),
                details={"operation": operation, "status": status},
            ) from exc
        except MastodonError as exc:
            raise ApiError(
                f"Failed to fetch data from {operation}: {exc}",
                original_error=str(exc),
                details={"operation": operation},
            ) from exc

        self._record_rate_limit(self.client)
        return _to_dict(result)

    # --- leituras ---
    def fetch_toots_by_hashtag(
        self, hashtag: str, *, limit: int | None = None, **options: Any
    ) -> list[dict[str, Any]]:
        """Posts de uma hashtag (primeira página)."""
        if not hashtag or not isinstance(hashtag, str):
            raise ApiError("Valid hashtag is required", details={"hashtag": hashtag})

        per_page = limit or self.settings.toots_per_page
        params: dict[str, Any] = {"limit": per_page, **options}

        toots = self._call(
            f"timelines/tag/{hashtag}",
            self.client.timeline_hashtag,
            hashtag,
            **params,
        )
        if not isinstance(toots, list):
            raise ApiError(
                "Expected array of toots but received different data type",
                details={"hashtag": hashtag, "receivedType": type(toots).__name__},
            )
        return toots

    def fetch_all_toots(self, hashtag: str, max_pages: int | None = None) -> list[dict[str, Any]]:
        """Todos os posts de uma hashtag, paginando até o limite configurado."""
        if not hashtag:
            raise ApiError("Hashtag is required", details={"hashtag": hashtag})

        page_limit = max_pages or self.settings.max_api_pages
        all_toots: list[dict[str, Any]] = []
        max_id: str | None = None
        pages = 0

        while pages < page_limit:
            options: dict[str, Any] = {"limit": self.settings.toots_per_page}
            if max_id:
                options["max_id"] = max_id

            try:
                toots = self.fetch_toots_by_hashtag(hashtag, **options)
            except RateLimitError:
                raise
            except ApiError as exc:
                logger.warning("Continuing with partial toots", hashtag=hashtag, error=str(exc))
                break

            if not toots:
                break

            all_toots.extend(toots)
            max_id = str(toots[-1].get("id")) if toots[-1].get("id") else None
            pages += 1

            if len(toots) < self.settings.toots_per_page:
                break

        logger.info("Finished fetching toots", hashtag=hashtag, total=len(all_toots), pages=pages)
        return all_toots

    def get_hashtag_history(self, hashtag: str) -> list[dict[str, Any]]:
        """Série de uso de uma hashtag (a API devolve ``day`` como timestamp)."""
        if not hashtag:
            raise ApiError("Hashtag is required", details={"hashtag": hashtag})

        tag = self._call(f"tags/{hashtag}", self.client.tag, hashtag)
        history = tag.get("history") if isinstance(tag, dict) else None
        return history if isinstance(history, list) else []

    def get_trending_tags(self, limit: int = 10, offset: int = 0) -> list[dict[str, Any]]:
        """Tags em alta."""
        capped = min(limit, 100)
        tags = self._call(
            "trends/tags",
            self.client.trending_tags,
            limit=capped,
            offset=offset,
        )
        return tags if isinstance(tags, list) else []

    def get_own_account(self) -> dict[str, Any]:
        """Conta autenticada (usada para não responder a si mesmo)."""
        account = self._call("accounts/verify_credentials", self.client.me)
        return account if isinstance(account, dict) else {}

    # --- escritas ---
    def create_toot(
        self,
        status: str,
        *,
        in_reply_to_id: str | None = None,
        media_ids: list[str] | None = None,
        visibility: str = "public",
        language: str = "pt",
        sensitive: bool = False,
    ) -> dict[str, Any]:
        """Publica um post."""
        if not status or not isinstance(status, str):
            raise ApiError("Status text is required and must be a string")
        if not status.strip():
            raise ApiError("Status text cannot be empty")
        if len(status) > 500:
            raise ApiError("Status text exceeds Mastodon's 500 character limit")

        result = self._call(
            "statuses",
            self.client.status_post,
            status.strip(),
            in_reply_to_id=in_reply_to_id,
            media_ids=media_ids,
            sensitive=sensitive,
            visibility=visibility,
            language=language,
        )
        if not result:
            raise ApiError("Invalid response when creating toot")
        return result

    def upload_media(
        self, image_bytes: bytes, description: str = "", *, filename: str = "report.png"
    ) -> dict[str, Any]:
        """Envia uma imagem, com texto alternativo acessível."""
        if not image_bytes:
            raise ApiError("Media upload failed: empty buffer")

        import io

        media = self._call(
            "media",
            self.client.media_post,
            io.BytesIO(image_bytes),
            mime_type="image/png",
            description=description or None,
            file_name=filename,
        )
        if not media or not media.get("id"):
            raise ApiError("Invalid response when uploading media")
        return media

    # --- diagnóstico ---
    def get_stats(self) -> dict[str, Any]:
        """Estatísticas do cliente."""
        return {
            "requestCount": self.request_count,
            "lastRequestTime": self.last_request_time,
            "rateLimitInfo": self.get_rate_limit_info(),
            "config": {
                "rateLimitDelay": self.settings.rate_limit_delay_ms,
                "maxApiPages": self.settings.max_api_pages,
                "tootsPerPage": self.settings.toots_per_page,
            },
        }


_service: MastodonService | None = None


def get_mastodon_service() -> MastodonService:
    """Instância única do cliente do Mastodon."""
    global _service
    if _service is None:
        _service = MastodonService()
    return _service


def reset_mastodon_service() -> None:
    """Descarta a instância (usado nos testes)."""
    global _service
    _service = None
