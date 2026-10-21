"""Publicação de posts: resumos, relatórios com imagem e posts avulsos."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from hashpanel.config import get_settings
from hashpanel.constants import MAX_TOOT_LENGTH, POST_RATE_LIMIT_SECONDS, TRUNCATION_NOTICE
from hashpanel.errors import BusinessError, ValidationError
from hashpanel.services.hashtags import HashtagAnalysis, get_hashtag_service
from hashpanel.services.images import get_image_generator
from hashpanel.services.mastodon import get_mastodon_service
from hashpanel.utils.links import generate_toot_link
from hashpanel.utils.logger import get_logger
from hashpanel.utils.timezone import get_current_date_formatted

logger = get_logger()


class TootService:
    """Escreve e publica posts no Mastodon."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.mastodon = get_mastodon_service()
        self.hashtags = get_hashtag_service()
        self.images = get_image_generator()
        self.total_posted = 0
        self.successful_posts = 0
        self.failed_posts = 0
        self.last_post_time: datetime | None = None

    # --- resumo textual ---
    def generate_summary(self, hashtag: str, analysis: HashtagAnalysis) -> str:
        """Monta o texto do resumo diário."""
        if not hashtag:
            raise ValidationError("Hashtag is required")
        if analysis is None:
            raise ValidationError("Analysis is required")

        today_count = analysis.get_today_count()
        weekly_total = analysis.get_weekly_total()
        unique_users = analysis.get_unique_user_count()
        top_toots = analysis.get_top_toots(3)
        engagement = analysis.get_engagement_stats()

        lines = [
            f"📊 #{hashtag} - Resumo Diário",
            "",
            f"📝 Posts hoje: {today_count}",
            f"👥 Participantes: {unique_users}",
            f"📈 Posts na semana: {weekly_total}",
            "",
        ]

        if today_count > 0:
            lines.extend(
                [
                    "🔥 Engajamento de hoje:",
                    f"⭐ {engagement['totalFavorites']} favoritos",
                    f"🔄 {engagement['totalBoosts']} boosts",
                    f"💬 {engagement['totalReplies']} respostas",
                    "",
                ]
            )

        if top_toots:
            lines.append("🏆 Principais posts:")
            for index, toot in enumerate(top_toots, start=1):
                username = (toot.get("account") or {}).get("username")
                link = generate_toot_link(
                    str(toot.get("id")), mastodon_url=self.settings.mastodon_url
                )
                lines.extend(
                    [
                        f"{index}. @{username} (Score: {toot.get('relevanceScore')})",
                        f"   🔗 {link}",
                        "",
                    ]
                )

        lines.extend(
            [
                f"📅 Gerado em {get_current_date_formatted(self.settings.preferred_timezone)}",
                "🤖 Via #Hashbot2",
            ]
        )

        summary = "\n".join(lines)
        if len(summary) > MAX_TOOT_LENGTH:
            logger.warning("Summary exceeds character limit", length=len(summary))
            return self._truncate(lines, MAX_TOOT_LENGTH)

        return summary

    @staticmethod
    def _truncate(lines: list[str], max_length: int) -> str:
        """Corta o resumo no limite de caracteres, avisando o leitor.

        O corte acontece em fronteiras de linha. O espaço do aviso de
        truncamento é reservado antes de aceitar cada linha, então nenhuma
        linha aceita é descartada depois, e o leitor sempre sabe que o
        texto foi cortado.
        """
        notice = f"\n{TRUNCATION_NOTICE}"
        result = ""
        truncated = False

        for index, line in enumerate(lines):
            candidate = f"{result}\n{line}" if result else line
            # Ainda há linhas depois: o aviso vai ocupar espaço no fim.
            budget = max_length if index == len(lines) - 1 else max_length - len(notice)
            if len(candidate) > budget:
                truncated = True
                break
            result = candidate

        if not truncated:
            return result

        if not result:
            return TRUNCATION_NOTICE if len(TRUNCATION_NOTICE) <= max_length else ""
        return result + notice

    def preview_summary(self, hashtag: str, analysis: HashtagAnalysis) -> dict[str, Any]:
        """Gera o resumo sem publicar, com metadados de tamanho."""
        summary = self.generate_summary(hashtag, analysis)
        return {
            "summary": summary,
            "length": len(summary),
            "characterCount": len(summary),
            "hashtagCount": summary.count("#"),
            "lineCount": len(summary.split("\n")),
            "isValid": len(summary) <= MAX_TOOT_LENGTH,
        }

    # --- publicação ---
    async def post_summary_async(self, summary: str, hashtag: str) -> dict[str, Any]:
        """Publica o resumo sem bloquear o event loop."""
        import asyncio

        return await asyncio.to_thread(self.post_summary, summary, hashtag)

    async def generate_and_post_summary_async(
        self, hashtag: str, analysis: HashtagAnalysis
    ) -> dict[str, Any]:
        """Gera e publica o resumo sem bloquear o event loop."""
        import asyncio

        return await asyncio.to_thread(self.generate_and_post_summary, hashtag, analysis)

    async def create_custom_toot_async(self, content: str, **options: Any) -> dict[str, Any]:
        """Publica um post escrito à mão, sem bloquear o event loop."""
        import asyncio

        return await asyncio.to_thread(self.create_custom_toot, content, **options)

    async def generate_and_post_daily_report_async(
        self,
        *,
        timezone: str | None = None,
        theme: str = "dark",
        save_image_path: str | None = None,
    ) -> dict[str, Any]:
        """Gera e publica o relatório com imagem, sem bloquear o event loop."""
        import asyncio

        return await asyncio.to_thread(
            self.generate_and_post_daily_report,
            timezone=timezone,
            theme=theme,
            save_image_path=save_image_path,
        )

    def post_summary(self, summary: str, hashtag: str) -> dict[str, Any]:
        """Publica o resumo de uma hashtag."""
        if not summary:
            raise ValidationError("Summary is required")
        if not hashtag:
            raise ValidationError("Hashtag is required")

        self.validate_content(summary, require_hashtag=True)

        try:
            result = self.mastodon.create_toot(
                summary, language="pt", visibility="public", sensitive=False
            )
        except Exception as exc:
            self._update_posting_stats(False)
            raise BusinessError(f"Failed to post summary: {exc}") from exc

        self._update_posting_stats(True)
        logger.info("Summary posted", hashtag=hashtag, toot_id=result.get("id"))
        return result

    def generate_and_post_summary(self, hashtag: str, analysis: HashtagAnalysis) -> dict[str, Any]:
        """Gera e publica o resumo numa operação só."""
        summary = self.generate_summary(hashtag, analysis)
        toot = self.post_summary(summary, hashtag)
        return {"summary": summary, "toot": toot}

    def create_custom_toot(self, content: str, **options: Any) -> dict[str, Any]:
        """Publica um post escrito à mão."""
        if not content:
            raise ValidationError("Content is required")

        self.validate_content(content)

        try:
            result = self.mastodon.create_toot(
                content,
                language=options.get("language") or "pt",
                visibility=options.get("visibility") or "public",
                sensitive=bool(options.get("sensitive")),
                in_reply_to_id=options.get("in_reply_to_id"),
                media_ids=options.get("media_ids"),
            )
        except Exception as exc:
            self._update_posting_stats(False)
            raise BusinessError(f"Failed to create custom toot: {exc}") from exc

        self._update_posting_stats(True)
        return result

    # --- relatório com imagem ---
    def generate_and_post_daily_report(
        self,
        *,
        timezone: str | None = None,
        theme: str = "dark",
        save_image_path: str | None = None,
    ) -> dict[str, Any]:
        """Gera a imagem do relatório, publica a mídia e posta o link."""
        zone = timezone or self.settings.preferred_timezone
        hashtag = self.hashtags.get_daily_hashtag(timezone=zone)
        analysis = self.hashtags.analyze_hashtag(hashtag, timezone=zone, max_pages=3)

        if not analysis.has_today_toots():
            logger.warning("No toots found for today, skipping image report")
            return {"success": False, "reason": "no_toots"}

        stats = {
            "hashtag": hashtag,
            "summary": {
                "tootCount": analysis.get_today_count(),
                "uniqueUsers": analysis.get_unique_user_count(),
                "weeklyTotal": analysis.get_weekly_total(),
            },
        }

        image_bytes, alt_text = self.images.generate_dashboard_image(stats, theme=theme)
        if not image_bytes:
            raise BusinessError("Failed to generate image: empty buffer")

        if save_image_path:
            Path(save_image_path).write_bytes(image_bytes)
            logger.info("Image saved locally", path=save_image_path)

        try:
            media = self.mastodon.upload_media(image_bytes, alt_text)
        except Exception:
            fallback = f"./daily-report-{_sanitize(hashtag)}-{int(datetime.now().timestamp())}.png"
            try:
                Path(fallback).write_bytes(image_bytes)
                logger.warning("Upload failed, image saved locally", path=fallback)
            except OSError:
                pass
            raise

        toot_text = (
            f"#hashpanel #{hashtag}\n\n"
            f"📊 Relatório do dia: {self.settings.resolved_server_public_url}"
        )
        toot = self.mastodon.create_toot(
            toot_text, media_ids=[media["id"]], language="pt", visibility="public"
        )

        self._update_posting_stats(True)
        logger.info("Daily image report posted", hashtag=hashtag, toot_id=toot.get("id"))
        return {"success": True, "toot": toot, "media": media}

    # --- validação ---
    @staticmethod
    def validate_content(content: Any, *, require_hashtag: bool = False) -> None:
        """Valida o conteúdo de um post."""
        if not isinstance(content, str):
            raise ValidationError("Content must be a string")
        if not content.strip():
            raise ValidationError("Content cannot be empty")
        if len(content) > MAX_TOOT_LENGTH:
            raise ValidationError(
                f"Content exceeds {MAX_TOOT_LENGTH} character limit ({len(content)} characters)"
            )
        if require_hashtag and "#" not in content:
            raise ValidationError("Content must include at least one hashtag")

    # --- estatísticas ---
    def _update_posting_stats(self, success: bool) -> None:
        self.total_posted += 1
        if success:
            self.successful_posts += 1
            self.last_post_time = datetime.now().astimezone()
        else:
            self.failed_posts += 1

    def get_stats(self) -> dict[str, Any]:
        """Estatísticas de publicação."""
        success_rate = (self.successful_posts / self.total_posted * 100) if self.total_posted else 0
        return {
            "totalPosted": self.total_posted,
            "successfulPosts": self.successful_posts,
            "failedPosts": self.failed_posts,
            "lastPostTime": self.last_post_time.isoformat() if self.last_post_time else None,
            "successRate": round(success_rate, 2),
            "failureRate": round(100 - success_rate, 2),
        }

    def reset_stats(self) -> None:
        """Zera as estatísticas."""
        self.total_posted = 0
        self.successful_posts = 0
        self.failed_posts = 0
        self.last_post_time = None

    def get_posting_history(self, limit: int = 10, offset: int = 0) -> dict[str, Any]:
        """Histórico de publicações (mantido em memória por enquanto)."""
        return {"posts": [], "total": self.successful_posts, "limit": limit, "offset": offset}

    def can_post(self) -> dict[str, Any]:
        """Indica se já passou o intervalo mínimo entre posts."""
        if self.last_post_time:
            elapsed = datetime.now().astimezone() - self.last_post_time
            if elapsed < timedelta(seconds=POST_RATE_LIMIT_SECONDS):
                next_allowed = self.last_post_time + timedelta(seconds=POST_RATE_LIMIT_SECONDS)
                return {
                    "allowed": False,
                    "reason": (
                        f"Rate limit: Only one post per {POST_RATE_LIMIT_SECONDS // 60} "
                        "minutes allowed"
                    ),
                    "nextAllowedTime": next_allowed.isoformat(),
                }
        return {"allowed": True}


def _sanitize(value: str) -> str:
    """Reduz um texto a um nome de arquivo seguro."""
    return "".join(char if char.isalnum() or char in "_-" else "_" for char in value)


_service: TootService | None = None


def get_toot_service() -> TootService:
    """Instância única do serviço de publicação."""
    global _service
    if _service is None:
        _service = TootService()
    return _service
