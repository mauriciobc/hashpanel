"""Rotas da API."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from hashpanel.server.errors import not_found_handler
from hashpanel.server.routes.dashboard import router as dashboard_router
from hashpanel.server.routes.hashtag import router as hashtag_router
from hashpanel.server.routes.media import router as media_router
from hashpanel.server.routes.toot import router as toot_router
from hashpanel.server.routes.trending import router as trending_router
from hashpanel.server.routes.websocket import router as websocket_router


def register_routes(app: FastAPI) -> None:
    """Monta as rotas da API e do dashboard."""
    from hashpanel.server.app import serve_frontend

    @app.get("/health", tags=["system"])
    async def health() -> Response:
        from hashpanel.server.health import build_health_report

        report = await build_health_report()
        status_code = 200 if report.get("status") == "healthy" else 503
        return JSONResponse(status_code=status_code, content=report)

    @app.get("/api", tags=["system"])
    @app.get("/api/", tags=["system"])
    async def api_info() -> dict:
        return {
            "name": "HashPanel API",
            "version": "1.0.0",
            "description": "Mastodon hashtag monitoring and analysis API",
            "endpoints": {
                "dashboard": "/api/dashboard",
                "hashtag": "/api/hashtag",
                "trending": "/api/trending",
                "toot": "/api/toot",
                "media": "/api/media",
                "websocket": "/api/websocket",
            },
        }

    app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
    app.include_router(hashtag_router, prefix="/api/hashtag", tags=["hashtag"])
    app.include_router(trending_router, prefix="/api/trending", tags=["trending"])
    app.include_router(toot_router, prefix="/api/toot", tags=["toot"])
    app.include_router(media_router, prefix="/api/media", tags=["media"])
    app.include_router(websocket_router, prefix="/api/websocket", tags=["websocket"])

    # O dashboard é uma SPA: qualquer rota não-API devolve o index.html.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str, request: Request) -> Response:
        if request.url.path.startswith("/api") or request.url.path.startswith("/health"):
            return await not_found_handler(request, None)
        return await serve_frontend(request)
