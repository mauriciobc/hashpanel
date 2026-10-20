"""Rotas de publicação."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query, Request

from hashpanel.constants import MAX_TOOT_LENGTH
from hashpanel.errors import BusinessError, ValidationError
from hashpanel.server.errors import error_response
from hashpanel.server.rate_limit import POSTING_RULE, client_key, posting_limiter
from hashpanel.services.hashtags import get_hashtag_service
from hashpanel.services.toots import get_toot_service
from hashpanel.utils.jscompat import parse_int
from hashpanel.utils.logger import get_logger
from hashpanel.utils.validators import validate_timezone_parameter

logger = get_logger()

router = APIRouter()

URL_RE = re.compile(r"https?://\S+")


def _posting_allowed(request: Request) -> Any | None:
    """Aplica o limite de publicação. Devolve a resposta de erro ou ``None``."""
    key = client_key(request)
    allowed, remaining, reset_seconds = posting_limiter.check(key)
    if allowed:
        return None

    logger.warning("Posting rate limit exceeded", ip=key, url=str(request.url))
    response = error_response(
        POSTING_RULE.message,
        POSTING_RULE.error_code,
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


@router.post("/generate")
async def generate_toot(payload: dict[str, Any]) -> dict[str, Any]:
    """Gera o resumo de uma hashtag sem publicar."""
    hashtag = payload.get("hashtag")
    if not hashtag:
        raise ValidationError("Hashtag is required")

    date = payload.get("date")
    analysis = await get_hashtag_service().analyze_hashtag_async(hashtag)
    preview = get_toot_service().preview_summary(hashtag, analysis)

    return {
        "hashtag": hashtag,
        "date": date or datetime.now().astimezone().strftime("%Y-%m-%d"),
        "summary": preview["summary"],
        "metadata": {
            "length": preview["characterCount"],
            "hashtagCount": preview["hashtagCount"],
            "lineCount": preview["lineCount"],
            "isValid": preview["isValid"],
        },
        "analysis": {
            "tootCount": analysis.get_today_count(),
            "uniqueUsers": analysis.get_unique_user_count(),
            "topToots": [
                {
                    "author": (toot.get("account") or {}).get("username"),
                    "relevance": toot.get("relevanceScore"),
                }
                for toot in analysis.get_top_toots(3)
            ],
        },
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.post("/post")
async def post_toot(request: Request, payload: dict[str, Any]) -> Any:
    """Publica um post escrito à mão ou o resumo de uma hashtag."""
    blocked = _posting_allowed(request)
    if blocked is not None:
        return blocked

    content = payload.get("content")
    hashtag = payload.get("hashtag")
    options = payload.get("options") or {}

    if content:
        if len(content) > MAX_TOOT_LENGTH:
            return error_response(
                f"Content exceeds {MAX_TOOT_LENGTH} character limit ({len(content)} characters)",
                "CONTENT_TOO_LONG",
                400,
                details={
                    "field": "content",
                    "contentLength": len(content),
                    "maxLength": MAX_TOOT_LENGTH,
                },
            )

        result = await get_toot_service().create_custom_toot_async(content, **options)
        return {
            "success": True,
            "toot": {
                "id": result.get("id"),
                "url": result.get("url"),
                "content": result.get("content"),
                "createdAt": result.get("created_at"),
            },
            "postedAt": datetime.now().astimezone().isoformat(),
        }

    if hashtag:
        analysis = await get_hashtag_service().analyze_hashtag_async(hashtag)
        if not analysis.has_today_toots():
            raise BusinessError(f"No toots found for hashtag: {hashtag}")

        result = await get_toot_service().generate_and_post_summary_async(hashtag, analysis)
        return {
            "success": True,
            "hashtag": hashtag,
            "summary": result["summary"],
            "toot": {
                "id": result["toot"].get("id"),
                "url": result["toot"].get("url"),
                "createdAt": result["toot"].get("created_at"),
            },
            "analysis": {
                "tootCount": analysis.get_today_count(),
                "uniqueUsers": analysis.get_unique_user_count(),
            },
            "postedAt": datetime.now().astimezone().isoformat(),
        }

    raise ValidationError("Either content or hashtag must be provided")


@router.post("/daily")
async def post_daily(request: Request, payload: dict[str, Any]) -> Any:
    """Publica (ou simula) o resumo da hashtag do dia."""
    blocked = _posting_allowed(request)
    if blocked is not None:
        return blocked

    dry_run = bool(payload.get("dryRun", False))
    timezone = validate_timezone_parameter(payload.get("timezone"))

    hashtag = get_hashtag_service().get_daily_hashtag(timezone=timezone)
    analysis = await get_hashtag_service().analyze_hashtag_async(hashtag, timezone=timezone)

    if not analysis.has_today_toots():
        return {
            "success": False,
            "message": f"No toots found for today's hashtag: #{hashtag}",
            "hashtag": hashtag,
            "tootCount": 0,
            "postedAt": datetime.now().astimezone().isoformat(),
        }

    if dry_run:
        preview = get_toot_service().preview_summary(hashtag, analysis)
        return {
            "success": True,
            "dryRun": True,
            "hashtag": hashtag,
            "summary": preview["summary"],
            "analysis": {
                "tootCount": analysis.get_today_count(),
                "uniqueUsers": analysis.get_unique_user_count(),
                "weeklyTotal": analysis.get_weekly_total(),
            },
            "generatedAt": datetime.now().astimezone().isoformat(),
        }

    result = await get_toot_service().generate_and_post_summary_async(hashtag, analysis)
    return {
        "success": True,
        "dryRun": False,
        "hashtag": hashtag,
        "summary": result["summary"],
        "toot": {
            "id": result["toot"].get("id"),
            "url": result["toot"].get("url"),
            "createdAt": result["toot"].get("created_at"),
        },
        "analysis": {
            "tootCount": analysis.get_today_count(),
            "uniqueUsers": analysis.get_unique_user_count(),
            "weeklyTotal": analysis.get_weekly_total(),
        },
        "postedAt": datetime.now().astimezone().isoformat(),
    }


@router.post("/daily-image")
async def post_daily_image(request: Request, payload: dict[str, Any]) -> Any:
    """Publica o relatório do dia com a imagem gerada."""
    blocked = _posting_allowed(request)
    if blocked is not None:
        return blocked

    timezone = validate_timezone_parameter(payload.get("timezone"))
    theme = payload.get("theme", "dark")
    theme = theme if theme in ("dark", "light") else "dark"

    result = await get_toot_service().generate_and_post_daily_report_async(
        timezone=timezone, theme=theme
    )

    if not result.get("success"):
        return {
            "success": False,
            "reason": result.get("reason"),
            "message": "No activity found for today to generate a report.",
            "postedAt": datetime.now().astimezone().isoformat(),
        }

    return {
        "success": True,
        "toot": {
            "id": result["toot"].get("id"),
            "url": result["toot"].get("url"),
            "createdAt": result["toot"].get("created_at"),
        },
        "postedAt": datetime.now().astimezone().isoformat(),
    }


@router.get("/history")
async def toot_history(
    limit: int | None = Query(None),
    offset: int | None = Query(None),
) -> dict[str, Any]:
    """Histórico de publicações."""
    resolved_limit = max(1, min(100, parse_int(limit, 10)))
    resolved_offset = max(0, parse_int(offset, 0))

    history = get_toot_service().get_posting_history(resolved_limit, resolved_offset)

    return {
        "history": history["posts"],
        "pagination": {
            "limit": resolved_limit,
            "offset": resolved_offset,
            "total": history["total"],
        },
        "stats": get_toot_service().get_stats(),
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.get("/stats")
async def toot_stats() -> dict[str, Any]:
    """Estatísticas de publicação."""
    return {
        "stats": get_toot_service().get_stats(),
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.post("/validate")
async def validate_toot(payload: dict[str, Any]) -> dict[str, Any]:
    """Valida o conteúdo de um post antes de publicar."""
    content = payload.get("content")
    if not content:
        raise ValidationError("Content is required for validation")

    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    length = len(content)
    if length > MAX_TOOT_LENGTH:
        errors.append(
            {
                "field": "content",
                "message": (
                    f"Content exceeds {MAX_TOOT_LENGTH} character limit ({length} characters)"
                ),
                "code": "CONTENT_TOO_LONG",
            }
        )
    if length == 0:
        errors.append(
            {"field": "content", "message": "Content cannot be empty", "code": "CONTENT_EMPTY"}
        )
    if not content.strip():
        errors.append(
            {
                "field": "content",
                "message": "Content cannot be only whitespace",
                "code": "CONTENT_WHITESPACE_ONLY",
            }
        )

    warning_threshold = int(MAX_TOOT_LENGTH * 0.9)
    if length > warning_threshold:
        warnings.append(
            {
                "field": "content",
                "message": (
                    f"Content is close to character limit ({length}/{MAX_TOOT_LENGTH} characters)"
                ),
                "code": "CONTENT_NEAR_LIMIT",
            }
        )
    if "#" not in content:
        warnings.append(
            {
                "field": "content",
                "message": "Content does not include any hashtags",
                "code": "NO_HASHTAGS",
            }
        )
    if "@" in content:
        warnings.append(
            {
                "field": "content",
                "message": "Content includes mentions - ensure they are relevant",
                "code": "CONTAINS_MENTIONS",
            }
        )

    return {
        "validation": {
            "isValid": not errors,
            "errors": errors,
            "warnings": warnings,
            "metadata": {
                "length": length,
                "characterCount": length,
                "wordCount": len([word for word in re.split(r"\s+", content) if word]),
                "lineCount": len(content.split("\n")),
                "hashtagCount": content.count("#"),
                "mentionCount": content.count("@"),
                "linkCount": len(URL_RE.findall(content)),
            },
        },
        "processedAt": datetime.now().astimezone().isoformat(),
    }
