"""Constantes de domínio do HashPanel."""

from __future__ import annotations

from typing import Final

# Hashtags por dia da semana (0 = domingo). Cada entrada pode ser uma string
# (uma única hashtag) ou uma lista (várias hashtags para o mesmo dia).
HASHTAGS: Final[list[list[str]]] = [
    ["videomingo", "silentsunday"],  # domingo
    ["segundaficha"],  # segunda
    ["tercinema", "tersoftware"],  # terça
    ["quartacapa", "quartoon", "rabisquarta"],  # quarta
    ["musiquinta", "quintattoo"],  # quinta
    ["sextaserie"],  # sexta
    ["sabafoto"],  # sábado
]

DAY_NAMES: Final[list[str]] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]

# Contas ignoradas na processamento (automatismos de trending).
IGNORED_ACCOUNTS: Final[frozenset[str]] = frozenset({"TagsBR", "TrendsBR", "trending"})

# --- API ---
DEFAULT_TOOTS_PER_PAGE: Final[int] = 40
MAX_TOOTS_PER_PAGE: Final[int] = 100
DEFAULT_TOP_TOOTS_COUNT: Final[int] = 5
MAX_API_PAGES: Final[int] = 10

# Páginas por timeframe: mais páginas para janelas maiores, sempre limitadas
# pelo teto configurado no ambiente (MAX_API_PAGES). O coletor usa a entrada
# "today" para contar exatamente os mesmos posts que o painel mostra.
MAX_PAGES_BY_TIMEFRAME: Final[dict[str, int]] = {
    "today": 1,
    "week": 5,
    "month": 20,
    "all": 50,
}

# --- Relevância ---
RELEVANCE_WEIGHTS: Final[dict[str, float]] = {
    "favorites": 0.35,
    "boosts": 0.25,
    "followers": 0.25,
    "replies": 0.15,
}
# Escala de normalização: 2.5 leva o score bruto a ~63 pontos.
MAX_EXPECTED_SCORE: Final[float] = 2.5
MIN_SCORE: Final[float] = 0
MAX_SCORE: Final[float] = 100

# --- Validação ---
MAX_TOOT_LENGTH: Final[int] = 500
MAX_HASHTAG_LENGTH: Final[int] = 100
HASHTAG_PATTERN: Final[str] = r"^[a-zA-Z0-9_]+$"
USERNAME_PATTERN: Final[str] = r"^[a-zA-Z0-9_\-]+$"

# --- Publicação ---
POST_RATE_LIMIT_SECONDS: Final[int] = 60 * 60
TRUNCATION_NOTICE: Final[str] = "... (resumo truncado)"

# --- HTTP ---
HTTP_STATUS: Final[dict[str, int]] = {
    "OK": 200,
    "CREATED": 201,
    "NO_CONTENT": 204,
    "BAD_REQUEST": 400,
    "UNAUTHORIZED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "TOO_MANY_REQUESTS": 429,
    "INTERNAL_SERVER_ERROR": 500,
    "BAD_GATEWAY": 502,
    "SERVICE_UNAVAILABLE": 503,
}

# --- Tempo ---
DEFAULT_TIMEZONE: Final[str] = "America/Sao_Paulo"
DATE_FORMAT: Final[str] = "%Y-%m-%d"
DISPLAY_FORMAT_PT_BR: Final[str] = "%d/%m/%Y"
DISPLAY_DATETIME_PT_BR: Final[str] = "%d/%m/%Y %H:%M"


def get_hashtags_for_day(hashtag: str | list[str]) -> list[str]:
    """Normaliza a entrada de um dia para sempre devolver uma lista."""
    if isinstance(hashtag, list):
        return hashtag
    return [hashtag]


def get_first_hashtag_for_day(hashtag: str | list[str]) -> str:
    """Primeira hashtag configurada para um dia."""
    return get_hashtags_for_day(hashtag)[0]


def all_configured_hashtags() -> list[str]:
    """Todas as hashtags configuradas, em ordem de primeira aparição."""
    seen: dict[str, None] = {}
    for day_hashtags in HASHTAGS:
        for tag in get_hashtags_for_day(day_hashtags):
            seen.setdefault(tag, None)
    return list(seen)


def hashtags_for_weekday(day_of_week: int) -> list[str]:
    """Hashtags do dia da semana informado (0 = domingo)."""
    if not 0 <= day_of_week <= 6:
        raise IndexError(f"Invalid day of week: {day_of_week}")
    return get_hashtags_for_day(HASHTAGS[day_of_week])
