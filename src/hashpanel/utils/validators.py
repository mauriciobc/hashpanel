"""Validação de parâmetros recebidos da web."""

from __future__ import annotations

import math
from typing import Any

from hashpanel.errors import ValidationError
from hashpanel.utils.timezone import parse_and_validate_timezone


def validate_days_parameter(
    days_value: Any,
    default_value: int = 7,
    minimum: int = 1,
    maximum: int = 365,
    *,
    logger: Any = None,
) -> int:
    """Valida e limita o parâmetro ``days``.

    Valores ausentes usam o padrão; valores fora da faixa são ajustados (sem
    erro); valores que não são números inteiros são rejeitados.
    """
    if days_value is None or days_value == "":
        return default_value

    try:
        parsed = float(days_value)
    except (TypeError, ValueError):
        raise ValidationError(
            f'Invalid days parameter: "{days_value}". Must be a valid number.',
            field="days",
            value=days_value,
        ) from None

    if math.isnan(parsed) or math.isinf(parsed):
        raise ValidationError(
            f'Invalid days parameter: "{days_value}". Must be a valid number.',
            field="days",
            value=days_value,
        )

    if not float(parsed).is_integer():
        raise ValidationError(
            f'Invalid days parameter: "{days_value}". Must be a finite integer.',
            field="days",
            value=days_value,
        )

    clamped = max(minimum, min(maximum, int(parsed)))
    if clamped != int(parsed) and logger is not None:
        logger.warning("Days parameter clamped to valid range")
    return clamped


def validate_timezone_parameter(timezone_value: Any, default_value: str | None = None) -> str:
    """Valida o parâmetro ``timezone`` e devolve um identificador IANA."""
    if timezone_value is None or timezone_value == "":
        from hashpanel.config import get_settings

        return default_value if default_value is not None else get_settings().preferred_timezone

    if isinstance(timezone_value, (list, tuple)):
        raise ValidationError(
            "Invalid timezone parameter. Must be a single value, not an array.",
            field="timezone",
            value=timezone_value,
        )

    if not isinstance(timezone_value, str):
        raise ValidationError(
            f"Invalid timezone parameter. Must be a string, got {type(timezone_value).__name__}.",
            field="timezone",
            value=timezone_value,
        )

    if not timezone_value.strip():
        raise ValidationError(
            "Invalid timezone parameter. Must be a non-empty string.",
            field="timezone",
            value=timezone_value,
        )

    # parse_and_validate_timezone com throw_on_invalid preserva a mensagem de erro.
    return parse_and_validate_timezone(timezone_value, throw_on_invalid=True)
