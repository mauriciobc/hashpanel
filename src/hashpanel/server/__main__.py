"""Ponto de entrada do servidor web.

Uso::

    hashpanel-server
    uvicorn hashpanel.server.app:app --host 0.0.0.0 --port 3000
"""

from __future__ import annotations

import uvicorn

from hashpanel.config import get_settings
from hashpanel.utils.logger import get_logger

logger = get_logger()


def main() -> int:
    """Sobe o servidor HTTP."""
    settings = get_settings()

    if settings.is_production and not settings.cors_origin:
        raise SystemExit(
            "CORS_ORIGIN must be set in production environment. "
            "Please configure CORS_ORIGIN environment variable with allowed origin(s)."
        )

    logger.info("Starting web server", host=settings.host, port=settings.port)

    uvicorn.run(
        "hashpanel.server.app:app",
        host=settings.host,
        port=settings.port,
        log_config=None,
        access_log=False,
        # O uvicorn reescreve ``request.client.host`` a partir do
        # ``X-Forwarded-For`` por padrão, e sem checar quem mandou a
        # requisição: qualquer cliente trocaria de balde nos limites por
        # IP. O endereço do cliente é resolvido aqui, a partir da lista
        # de proxies confiáveis (TRUSTED_PROXY_IPS).
        proxy_headers=False,
        forwarded_allow_ips="",
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
