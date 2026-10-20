"""Utilitários de fuso horário.

O projeto trabalha com ``America/Sao_Paulo`` por padrão, mas aceita qualquer
identificador IANA válido. As funções convertem *instantes* (com offset) para o
fuso pedido e formatam no estilo do moment.js usado antes, para que os textos
gerados (resumos, relatórios) continuem idênticos.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from hashpanel.errors import ValidationError

DEFAULT_TIMEZONE = "America/Sao_Paulo"

# Substituições do conjunto moment.js -> strftime
_FORMAT_MAP = {
    "YYYY": "%Y",
    "YY": "%y",
    "MM": "%m",
    "DD": "%d",
    "HH": "%H",
    "mm": "%M",
    "ss": "%S",
    "SSS": "%f",
}


def parse_and_validate_timezone(
    timezone: str | None,
    *,
    fallback: str | None = None,
    throw_on_invalid: bool = False,
    logger: Any = None,
) -> str:
    """Valida um identificador IANA, devolvendo ``fallback`` quando inválido."""
    resolved_fallback = fallback or DEFAULT_TIMEZONE

    if not timezone:
        return resolved_fallback

    if not isinstance(timezone, str):
        error = ValidationError(
            f"Invalid timezone type: expected string, got {type(timezone).__name__}",
            field="timezone",
            value=timezone,
        )
        if throw_on_invalid:
            raise error
        if logger is not None:
            logger.warning("Invalid timezone type, using fallback")
        return resolved_fallback

    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
        error = ValidationError(
            f'Invalid IANA timezone identifier: "{timezone}". Must be a valid timezone '
            'like "America/Sao_Paulo" or "UTC".',
            field="timezone",
            value=timezone,
        )
        if throw_on_invalid:
            raise error from exc
        if logger is not None:
            logger.warning("Invalid timezone identifier, using fallback")
        return resolved_fallback

    return timezone


def to_datetime(value: datetime | date | str | int | float) -> datetime:
    """Converte um valor em ``datetime`` com timezone (assume UTC se necessário)."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=UTC)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=UTC)
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as exc:
            raise ValueError(f"Data inválida: {value!r}") from exc
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    raise TypeError(f"Tipo de data não suportado: {type(value).__name__}")


def format_datetime(
    value: datetime | date | str | int | float,
    timezone: str,
    fmt: str = "YYYY-MM-DD",
) -> str:
    """Formata um instante no fuso indicado usando tokens no estilo moment."""
    zone = ZoneInfo(parse_and_validate_timezone(timezone, fallback=DEFAULT_TIMEZONE))
    moment = to_datetime(value).astimezone(zone)

    if "Z" in fmt and "ZZ" not in fmt:
        fmt = fmt.replace("Z", "+00:00")
    if "ZZ" in fmt:
        fmt = fmt.replace("ZZ", "%z")

    for token, directive in _FORMAT_MAP.items():
        fmt = fmt.replace(token, directive)

    return moment.strftime(fmt)


def get_current_date_in_timezone(timezone: str, fmt: str = "YYYY-MM-DD") -> str:
    """Data de hoje (no fuso indicado) formatada."""
    zone = ZoneInfo(parse_and_validate_timezone(timezone, fallback=DEFAULT_TIMEZONE))
    return datetime.now(zone).strftime(
        fmt.replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d")
    )


def get_current_datetime(timezone: str) -> datetime:
    """Agora, com timezone, no fuso indicado."""
    zone = ZoneInfo(parse_and_validate_timezone(timezone, fallback=DEFAULT_TIMEZONE))
    return datetime.now(zone)


def get_current_timestamp_iso() -> str:
    """Instante atual em ISO 8601 (UTC)."""
    return datetime.now(UTC).isoformat()


def get_current_date_formatted(timezone: str) -> str:
    """Data de hoje no formato brasileiro (DD/MM/YYYY)."""
    return get_current_date_in_timezone(timezone, "DD/MM/YYYY")


def get_timezone_offset(timezone: str) -> str:
    """Deslocamento legível: ``UTC-3``, ``UTC+5:30`` ou ``UTC``."""
    zone = ZoneInfo(parse_and_validate_timezone(timezone, fallback="UTC"))
    now = datetime.now(zone).utcoffset() or timedelta(0)
    total_minutes = int(now.total_seconds() // 60)
    sign = "+" if total_minutes >= 0 else "-"
    hours, minutes = divmod(abs(total_minutes), 60)
    if minutes == 0:
        return "UTC" if hours == 0 else f"UTC{sign}{hours}"
    return f"UTC{sign}{hours}:{minutes:02d}"


def get_timezone_abbreviation(timezone: str) -> str:
    """Abreviação do fuso (``UTC``, ``BRT``, ...)."""
    zone = ZoneInfo(parse_and_validate_timezone(timezone, fallback="UTC"))
    abbreviation = datetime.now(zone).tzname() or "UTC"
    if abbreviation.isdigit() or abbreviation.startswith(("+", "-")):
        return get_timezone_offset(timezone)
    return abbreviation


def get_timezone_name(timezone: str) -> str:
    """Nome legível do fuso (``Sao Paulo``, ``Tokyo``)."""
    validated = parse_and_validate_timezone(timezone, fallback="UTC")
    return validated.split("/")[-1].replace("_", " ")


def convert_date_between_timezones(
    value: datetime | date | str | int | float,
    from_timezone: str,
    to_timezone: str,
) -> datetime:
    """Converte um instante entre dois fusos (o mesmo instante, outra parede)."""
    source = parse_and_validate_timezone(from_timezone, throw_on_invalid=True)
    target = parse_and_validate_timezone(to_timezone, throw_on_invalid=True)
    return to_datetime(value).astimezone(ZoneInfo(source)).astimezone(ZoneInfo(target))


def is_at_timezone_boundary(
    value: datetime | date | str | int | float,
    timezone: str,
    threshold_minutes: int = 60,
) -> bool:
    """Indica se o instante cai perto da meia-noite no fuso indicado."""
    zone = ZoneInfo(parse_and_validate_timezone(timezone, fallback=DEFAULT_TIMEZONE))
    local = to_datetime(value).astimezone(zone)
    minutes_since_midnight = local.hour * 60 + local.minute
    minutes_until_midnight = 24 * 60 - minutes_since_midnight
    return (
        minutes_since_midnight <= threshold_minutes or minutes_until_midnight <= threshold_minutes
    )


def get_timezone_info(timezone: str) -> dict[str, Any]:
    """Pacote com as informações de um fuso, usado em logs e na API."""
    validated = parse_and_validate_timezone(timezone, fallback="UTC")
    zone = ZoneInfo(validated)
    now = datetime.now(zone)
    return {
        "timezone": validated,
        "offset": get_timezone_offset(validated),
        "abbreviation": get_timezone_abbreviation(validated),
        "name": get_timezone_name(validated),
        "currentTime": now.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "isValid": True,
    }


def get_timezone_log_context(
    timezone: str, additional_context: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Contexto de log com as informações do fuso."""
    info = get_timezone_info(timezone)
    context = dict(additional_context or {})
    context.update(
        {
            "timezone": info["timezone"],
            "timezoneOffset": info["offset"],
            "timezoneAbbr": info["abbreviation"],
        }
    )
    return context


def day_of_week(value: datetime | date | str | int | float, timezone: str) -> int:
    """Dia da semana (0 = domingo) de um instante no fuso indicado."""
    zone = ZoneInfo(parse_and_validate_timezone(timezone, fallback=DEFAULT_TIMEZONE))
    local = to_datetime(value).astimezone(zone)
    # ``weekday()`` usa segunda=0; o painel usa domingo=0.
    return (local.weekday() + 1) % 7
