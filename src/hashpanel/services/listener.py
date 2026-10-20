"""Bot que responde menções com um relatório da hashtag pedida.

Usa o streaming do Mastodon (``Mastodon.py``) para receber as notificações de
menção em tempo real.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any

from mastodon.errors import MastodonError
from mastodon.streaming import StreamListener

from hashpanel.config import get_settings
from hashpanel.services.hashtags import get_hashtag_service
from hashpanel.services.images import get_image_generator
from hashpanel.services.mastodon import get_mastodon_service
from hashpanel.utils.logger import get_logger

logger = get_logger()

# Hashtags no formato HTML do Mastodon: <a ... class="hashtag" ...>#<span>tag</span></a>
MASTODON_HASHTAG_RE = re.compile(
    r'<a[^>]*class="[^"]*hashtag[^"]*"[^>]*>#<span>([^<]+)</span></a>', re.IGNORECASE
)
# Hashtag em texto simples, com letras (o "#" sozinho ou "#123" não valem).
PLAIN_HASHTAG_RE = re.compile(r"#([\wÀ-ɏḀ-ỿ]+)", re.UNICODE)

IGNORED_TARGET_HASHTAGS = frozenset({"hashpanel", "bot"})


def extract_hashtags(content: str) -> list[str]:
    """Extrai as hashtags do conteúdo HTML de um post."""
    if not content:
        return []

    hashtags: list[str] = []

    for match in MASTODON_HASHTAG_RE.finditer(content):
        tag = match.group(1).strip().lower()
        if tag and tag not in IGNORED_TARGET_HASHTAGS:
            hashtags.append(tag)

    if hashtags:
        return hashtags

    plain_text = re.sub(r"<[^>]*>", " ", content)
    for match in PLAIN_HASHTAG_RE.finditer(plain_text):
        tag = match.group(1).strip().lower()
        # Exige pelo menos uma letra: "#123" não é uma hashtag.
        if not re.search(r"[^\W\d_]", tag):
            continue
        if tag in IGNORED_TARGET_HASHTAGS:
            continue
        hashtags.append(tag)

    return hashtags


class MentionListener(StreamListener):
    """Recebe menções e responde com o relatório da hashtag."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.mastodon = get_mastodon_service()
        self.hashtags = get_hashtag_service()
        self.images = get_image_generator()

        self.own_account_id: str | None = None
        self.own_username: str | None = None
        self.connected = False
        self.event_count = 0
        self.last_event_time: float | None = None
        self.connection_started_at: float | None = None
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 10
        self.reconnect_delay_seconds = 5

        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    # --- ciclo de vida ---
    def start(self) -> None:
        """Conecta ao streaming em uma thread de fundo."""
        if self._thread is not None and self._thread.is_alive():
            logger.warning("Mention listener already running")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="mention-listener", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        """Mantém a conexão viva, reconectando em caso de falha."""
        while not self._stop_event.is_set():
            try:
                self._resolve_own_account()
                self.connection_started_at = time.monotonic()
                self.connected = True
                self.reconnect_attempts = 0
                logger.info("Connected to Mastodon streaming", username=self.own_username)
                self.mastodon.client.stream_user(self, timeout=300)
            except MastodonError as exc:
                logger.warning("Streaming connection failed", error=str(exc))
            except Exception as exc:  # pragma: no cover - defensivo
                logger.error("Unexpected streaming failure", error=str(exc))
            finally:
                self.connected = False

            if self._stop_event.is_set():
                break

            if self.reconnect_attempts >= self.max_reconnect_attempts:
                logger.error("Maximum reconnect attempts reached")
                break

            self.reconnect_attempts += 1
            delay = self.reconnect_delay_seconds * self.reconnect_attempts
            logger.info(
                "Scheduling reconnect",
                attempt=self.reconnect_attempts,
                delay_seconds=delay,
            )
            self._stop_event.wait(delay)

    def _resolve_own_account(self) -> None:
        """Descobre o id e o usuário da conta autenticada."""
        account = self.mastodon.get_own_account()
        account_id = account.get("id")
        if not account_id:
            raise RuntimeError("verify_credentials response is missing 'id'")

        username = account.get("username") or account.get("acct") or str(account_id)
        self.own_account_id = str(account_id)
        self.own_username = username.lstrip("@")

    def stop(self) -> None:
        """Encerra a conexão."""
        self._stop_event.set()
        self.connected = False
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=5)
        self._thread = None
        logger.info("Mention listener stopped")

    # --- eventos ---
    def on_notification(self, notification: Any) -> None:
        """Recebeu uma notificação: verifica se é uma menção."""
        self.event_count += 1
        self.last_event_time = time.monotonic()

        status = getattr(notification, "status", None)
        if status is None:
            return

        notification_type = (
            notification.get("type")
            if isinstance(notification, dict)
            else getattr(notification, "type", None)
        )
        if notification_type != "mention":
            return

        self.handle_mention(status)

    def handle_mention(self, status: Any) -> None:
        """Responde a uma menção com o relatório da hashtag citada."""
        data = status if isinstance(status, dict) else status.to_dict()
        account = data.get("account") or {}
        status_id = data.get("id")
        username = account.get("username") or "desconhecido"

        if str(account.get("id")) == str(self.own_account_id):
            logger.debug("Ignoring own mention", status_id=status_id)
            return
        if account.get("bot"):
            logger.debug("Ignoring bot mention", status_id=status_id)
            return

        logger.info("Mention received", status_id=status_id, username=username)

        try:
            hashtags = extract_hashtags(data.get("content") or "")
            if not hashtags:
                self._reply(
                    status,
                    f"@{username} Olá! 👋\n\nPara usar o bot, mencione-me junto com uma "
                    f"hashtag. Exemplo:\n@{self.own_username} #tercinema\n\nVou gerar um "
                    "relatório com as estatísticas dessa hashtag! 📊",
                )
                return

            target = hashtags[0]
            analysis = self.hashtags.analyze_hashtag(target, max_pages=1)

            today_count = analysis.get_today_count()
            unique_users = analysis.get_unique_user_count()
            weekly_total = analysis.get_weekly_total()

            if today_count == 0 and unique_users == 0 and weekly_total == 0:
                self._reply(
                    status,
                    f"@{username} Não encontrei dados recentes para #{target}. 😔\n\nTalvez "
                    "essa hashtag não tenha sido usada hoje, ou não há posts públicos "
                    "disponíveis.",
                )
                return

            stats = {
                "hashtag": target,
                "summary": {
                    "tootCount": today_count,
                    "uniqueUsers": unique_users,
                    "weeklyTotal": weekly_total,
                },
            }
            image_bytes, alt_text = self.images.generate_dashboard_image(stats)
            media = self.mastodon.upload_media(image_bytes, alt_text)

            self._reply(
                status,
                f"@{username} Aqui está o resumo para #{target}! 📊\n\n#hashpanel",
                media_ids=[media["id"]],
            )
            logger.info("Report sent", status_id=status_id, hashtag=target)
        except Exception as exc:
            logger.error("Failed to answer mention", status_id=status_id, error=str(exc))
            try:
                self._reply(
                    status,
                    f"@{username} Desculpe, ocorreu um erro ao processar sua solicitação. 😔\n\n"
                    "Tente novamente mais tarde!",
                )
            except Exception as reply_error:
                logger.error("Failed to send error reply", error=str(reply_error))

    def _reply(self, status: Any, text: str, *, media_ids: list[str] | None = None) -> None:
        """Publica uma resposta em thread."""
        data = status if isinstance(status, dict) else status.to_dict()
        self.mastodon.create_toot(
            text,
            in_reply_to_id=str(data.get("id")),
            media_ids=media_ids,
            visibility=data.get("visibility") or "public",
            language="pt",
        )

    # --- diagnóstico ---
    def get_status(self) -> dict[str, Any]:
        """Estado atual da conexão, exposto pela API."""
        connection_duration = (
            (time.monotonic() - self.connection_started_at) if self.connection_started_at else None
        )
        time_since_event = (
            (time.monotonic() - self.last_event_time) if self.last_event_time else None
        )
        return {
            "connected": self.connected,
            "readyState": "OPEN" if self.connected else "CLOSED",
            "readyStateCode": 1 if self.connected else 3,
            "connectionDurationMs": int(connection_duration * 1000)
            if connection_duration
            else None,
            "eventCount": self.event_count,
            "timeSinceLastEventMs": int(time_since_event * 1000) if time_since_event else None,
            "reconnectAttempts": self.reconnect_attempts,
            "url": self._redacted_url(),
        }

    def _redacted_url(self) -> str | None:
        """URL do streaming sem o token de acesso."""
        if not self.own_username:
            return None
        base = self.settings.mastodon_url
        for suffix in ("/api/v1", "/api/v2", "/api"):
            if base.endswith(suffix):
                base = base[: -len(suffix)]
                break
        return f"{base.replace('https://', 'wss://').replace('http://', 'ws://')}/api/v1/streaming?stream=user&access_token=REDACTED"


_listener: MentionListener | None = None


def get_mention_listener() -> MentionListener:
    """Instância única do listener."""
    global _listener
    if _listener is None:
        _listener = MentionListener()
    return _listener
