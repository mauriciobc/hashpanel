"""Estado da conexão de streaming do bot."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter

from hashpanel.services.listener import get_mention_listener

router = APIRouter()


@router.get("/status")
async def websocket_status() -> dict[str, Any]:
    """Estado da conexão do bot com o streaming do Mastodon."""
    status = get_mention_listener().get_status()
    return {
        "websocket": status,
        "timestamp": datetime.now().astimezone().isoformat(),
    }
