"""Rotas de tags em alta."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query

from hashpanel.errors import ValidationError
from hashpanel.services.hashtags import get_hashtag_service
from hashpanel.utils.jscompat import parse_int
from hashpanel.utils.logger import get_logger

logger = get_logger()

router = APIRouter()

MAX_LIMIT = 100


def _paginate(limit: Any, offset: Any) -> tuple[int, int]:
    """Valida os parâmetros de paginação (valores inválidos usam o padrão)."""
    resolved_limit = 10
    resolved_offset = 0

    if limit is not None and str(limit).strip().isdigit():
        parsed = int(str(limit).strip())
        if parsed >= 1:
            resolved_limit = min(parsed, MAX_LIMIT)

    if offset is not None and str(offset).strip().isdigit():
        parsed = int(str(offset).strip())
        if parsed >= 0:
            resolved_offset = parsed

    return resolved_limit, resolved_offset


def _trend_direction(history: list[dict[str, Any]] | None) -> str:
    """Classifica a tendência comparando os dois dias mais recentes."""
    if not history or len(history) < 2:
        return "stable"

    recent = parse_int(history[0].get("uses"))
    previous = parse_int(history[1].get("uses"))

    if previous == 0:
        return "rising" if recent > 0 else "stable"

    change = (recent - previous) / previous * 100
    if change > 10:
        return "rising"
    if change < -10:
        return "falling"
    return "stable"


def _week_total(history: list[dict[str, Any]] | None) -> int:
    """Total de usos na janela do histórico."""
    if not history:
        return 0
    return sum(parse_int(day.get("uses")) for day in history)


def _categorize(tags: list[dict[str, Any]]) -> dict[str, int]:
    """Agrupa as tags por tema, de forma simples."""
    categories = {
        "entertainment": 0,
        "technology": 0,
        "politics": 0,
        "sports": 0,
        "general": 0,
    }

    for tag in tags:
        name = (tag.get("name") or "").lower()
        if "film" in name or "movie" in name or "cinema" in name:
            categories["entertainment"] += 1
        elif "tech" in name or "code" in name or "programming" in name:
            categories["technology"] += 1
        elif "politic" in name or "election" in name:
            categories["politics"] += 1
        elif "sport" in name or "football" in name or "soccer" in name:
            categories["sports"] += 1
        else:
            categories["general"] += 1

    return categories


@router.get("")
@router.get("/")
async def trending_tags(
    limit: int | None = Query(None),
    offset: int | None = Query(None),
) -> dict[str, Any]:
    """Tags em alta, paginadas."""
    resolved_limit, resolved_offset = _paginate(limit, offset)
    result = await get_hashtag_service().get_trending_tags_async(resolved_limit, resolved_offset)
    tags = result["tags"]
    total_count = result["totalCount"]

    enriched = []
    for index, tag in enumerate(tags):
        history = tag.get("history") or []
        enriched.append(
            {
                "rank": resolved_offset + index + 1,
                "name": tag.get("name"),
                "url": tag.get("url"),
                "history": history,
                "currentUses": (history[0].get("uses") if history else 0) or 0,
                "accounts": (history[0].get("accounts") if history else 0) or 0,
                "trendDirection": _trend_direction(history),
                "weekTotal": _week_total(history),
            }
        )

    total = total_count if total_count is not None else len(enriched)
    has_more = (
        resolved_offset + resolved_limit < total_count
        if isinstance(total_count, int)
        else len(enriched) == resolved_limit
    )

    return {
        "tags": enriched,
        "pagination": {
            "limit": resolved_limit,
            "offset": resolved_offset,
            "total": total,
            "hasMore": has_more,
        },
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.get("/summary")
async def trending_summary() -> dict[str, Any]:
    """Resumo das tags em alta."""
    result = await get_hashtag_service().get_trending_tags_async(20)
    tags = result["tags"]

    total_uses = sum(parse_int((tag.get("history") or [{}])[0].get("uses")) for tag in tags)
    unique_accounts = sum(
        parse_int((tag.get("history") or [{}])[0].get("accounts")) for tag in tags
    )

    top_tag = None
    if tags:
        history = tags[0].get("history") or [{}]
        top_tag = {"name": tags[0].get("name"), "uses": history[0].get("uses") or 0}

    return {
        "totalTags": len(tags),
        "topTag": top_tag,
        "totalUses": total_uses,
        "uniqueAccounts": unique_accounts,
        "averageUses": round(total_uses / len(tags)) if tags else 0,
        "categories": _categorize(tags),
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.get("/compare")
async def trending_compare(tags: str = Query(...)) -> dict[str, Any]:
    """Compara de duas a cinco tags em alta."""
    if not tags:
        raise ValidationError("Tags parameter is required")

    tag_list = [
        tag.strip().lstrip("#").lower() for tag in tags.split(",") if tag.strip().lstrip("#")
    ]

    if len(tag_list) < 2 or len(tag_list) > 5:
        raise ValidationError("Please provide between 2 and 5 tags to compare")

    trending = (await get_hashtag_service().get_trending_tags_async(50))["tags"]
    found = [tag for tag in trending if (tag.get("name") or "").lower() in tag_list]

    if not found:
        from hashpanel.server.errors import error_response

        return error_response(
            "None of the specified tags were found in trending tags", "NO_TAGS_FOUND", 404
        )

    comparisons = []
    for tag in found:
        history = tag.get("history") or []
        index = trending.index(tag)
        comparisons.append(
            {
                "name": tag.get("name"),
                "currentUses": (history[0].get("uses") if history else 0) or 0,
                "weekTotal": _week_total(history),
                "trendDirection": _trend_direction(history),
                "rank": index + 1,
            }
        )

    total_uses = sum(parse_int((tag.get("history") or [{}])[0].get("uses")) for tag in found)
    top_performer = max(
        found,
        key=lambda tag: parse_int((tag.get("history") or [{}])[0].get("uses")),
    )

    return {
        "tags": comparisons,
        "statistics": {
            "totalUses": total_uses,
            "averageUses": round(total_uses / len(found)),
            "topPerformer": top_performer,
        },
        "missingTags": [
            tag
            for tag in tag_list
            if not any((found_tag.get("name") or "").lower() == tag for found_tag in found)
        ],
        "generatedAt": datetime.now().astimezone().isoformat(),
    }


@router.get("/{tag}")
async def trending_tag_detail(tag: str) -> Any:
    """Detalhes de uma tag em alta."""
    if not tag:
        raise ValidationError("Tag name is required")

    trending = (await get_hashtag_service().get_trending_tags_async(50))["tags"]
    tag_info = next(
        (item for item in trending if (item.get("name") or "").lower() == tag.lower()), None
    )

    if tag_info is None:
        from hashpanel.server.errors import error_response

        return error_response(
            f"Tag #{tag} not found in trending tags", "TRENDING_TAG_NOT_FOUND", 404
        )

    history = tag_info.get("history") or []
    peak_day = max(
        history,
        key=lambda day: parse_int(day.get("uses")),
        default={},
    )

    return {
        "name": tag_info.get("name"),
        "url": tag_info.get("url"),
        "history": history,
        "statistics": {
            "currentUses": (history[0].get("uses") if history else 0) or 0,
            "accounts": (history[0].get("accounts") if history else 0) or 0,
            "weekTotal": _week_total(history),
            "peakDay": peak_day,
            "trendDirection": _trend_direction(history),
            "averageDaily": (round(_week_total(history) / len(history)) if history else 0),
        },
        "timeline": [
            {
                "day": day.get("day"),
                "uses": parse_int(day.get("uses")),
                "accounts": day.get("accounts") or 0,
                "rank": index + 1,
            }
            for index, day in enumerate(history)
        ],
        "relatedHashtags": [],
        "generatedAt": datetime.now().astimezone().isoformat(),
    }
