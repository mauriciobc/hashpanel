"""Semântica numérica equivalente à do JavaScript.

O painel já mostra números para a comunidade e alguns cálculos dependem do
comportamento do ``parseInt`` e do ``Math.round`` do JavaScript. Python usa
"banker's rounding" no ``round()``, o que produziria valores diferentes em
metades exatas, então usamos a mesma regra do JavaScript.
"""

from __future__ import annotations

import math
import re
from typing import Any

_LEADING_INT = re.compile(r"^[+-]?\d+")


def parse_int(value: Any, default: int = 0) -> int:
    """Equivale a ``parseInt(value) || default`` do JavaScript.

    Aceita prefixos numéricos (``"12abc"`` -> 12), devolve ``default`` quando
    não há número no início da string.
    """
    if value is None or isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value or default
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return default
        return int(value) or default
    if isinstance(value, str):
        match = _LEADING_INT.match(value.strip())
        if not match:
            return default
        return int(match.group()) or default
    return default


def js_round_1(value: Any) -> float:
    """Equivale a ``Math.round(value * 10) / 10``."""
    number = to_number(value)
    if math.isnan(number) or math.isinf(number):
        return 0
    return math.floor(number * 10 + 0.5) / 10


def js_round(value: Any) -> int:
    """Equivale a ``Math.round(value)`` (metades para cima)."""
    number = to_number(value)
    if math.isnan(number) or math.isinf(number):
        return 0
    return math.floor(number + 0.5)


def to_number(value: Any) -> float:
    """Converte para ``float`` como o JavaScript faria, devolvendo ``nan``."""
    if value is None or isinstance(value, bool):
        return math.nan
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return math.nan
        try:
            return float(text)
        except ValueError:
            return math.nan
    return math.nan


def truthy(value: Any) -> bool:
    """Equivale ao ``|| 0`` do JavaScript para números usados como contadores."""
    number = to_number(value)
    if math.isnan(number):
        return False
    return number != 0
