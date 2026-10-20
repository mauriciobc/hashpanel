"""Cálculo de relevância dos posts.

A relevância combina quatro sinais — favoritos, boosts, seguidores do autor e
respostas — numa escala logarítmica, e o resultado bruto é normalizado para
0–100 com uma curva que satura suavemente.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any

from hashpanel.constants import MAX_EXPECTED_SCORE, RELEVANCE_WEIGHTS
from hashpanel.errors import DataProcessingError
from hashpanel.utils.jscompat import js_round_1
from hashpanel.utils.logger import get_logger

logger = get_logger()

REQUIRED_WEIGHTS = ("favorites", "boosts", "followers", "replies")


class RelevanceCalculator:
    """Calcula e normaliza o score de relevância de um post."""

    MAX_EXPECTED_SCORE = MAX_EXPECTED_SCORE

    def __init__(self, weights: dict[str, float] | None = None) -> None:
        self.weights = self._validate_weights(dict(weights or RELEVANCE_WEIGHTS))
        self.total_calculations = 0
        self.errors = 0
        self.average_score = 0.0
        self.max_score = 0.0
        self.min_score = math.inf

    # --- validação dos pesos ---
    @staticmethod
    def _validate_weights(weights: dict[str, Any]) -> dict[str, float]:
        """Normaliza e valida os pesos usados na fórmula."""
        normalized: dict[str, float] = {}
        missing = False

        for key in REQUIRED_WEIGHTS:
            raw = weights.get(key)
            if raw is None:
                normalized[key] = 0.0
                missing = True
                continue
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                raise DataProcessingError(
                    f"Weight for {key} must be a valid number, got {raw}",
                    step="weight_validation",
                    details={"key": key, "weight": raw},
                )
            if math.isnan(raw) or math.isinf(raw):
                raise DataProcessingError(
                    f"Weight for {key} must be a valid number, got {raw}",
                    step="weight_validation",
                    details={"key": key, "weight": raw},
                )
            if not 0 <= raw <= 1:
                raise DataProcessingError(
                    f"Weight for {key} must be between 0 and 1, got {raw}",
                    step="weight_validation",
                    details={"key": key, "weight": raw},
                )
            normalized[key] = float(raw)

        if missing:
            logger.warning("Missing weight keys were normalized to 0")

        total = sum(normalized[key] for key in REQUIRED_WEIGHTS)
        if abs(total - 1.0) > 0.01:
            raise DataProcessingError(
                f"Relevance weights must sum to 1.0, but sum to {total}",
                step="weight_validation",
                details={"weights": normalized, "sum": total},
            )

        for key, weight in weights.items():
            if key in REQUIRED_WEIGHTS:
                continue
            if (
                isinstance(weight, bool)
                or not isinstance(weight, (int, float))
                or not 0 <= weight <= 1
            ):
                raise DataProcessingError(
                    f"Weight for {key} must be a number between 0 and 1",
                    step="weight_validation",
                    details={"key": key, "weight": weight},
                )

        return normalized

    # --- validação do post ---
    @staticmethod
    def validate_toot(toot: Any) -> list[str]:
        """Lista os problemas estruturais de um post."""
        errors: list[str] = []

        if not isinstance(toot, dict):
            return ["Toot must be an object"]

        if not toot.get("id"):
            errors.append("Missing toot.id")
        account = toot.get("account")
        if not account:
            errors.append("Missing toot.account")
        elif isinstance(account, dict):
            if not account.get("id"):
                errors.append("Missing toot.account.id")
            if not account.get("username"):
                errors.append("Missing toot.account.username")
        else:
            errors.append("Missing toot.account")

        for field in ("favourites_count", "reblogs_count"):
            if field in toot:
                value = toot[field]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                    errors.append(f"{field} must be a non-negative number, got {value}")

        return errors

    # --- métricas ---
    @staticmethod
    def extract_metrics(toot: dict[str, Any]) -> dict[str, Any]:
        """Métricas usadas no cálculo."""
        account = toot.get("account") or {}

        def _count(source: dict[str, Any], key: str) -> int:
            value = source.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return 0
            return int(value)

        return {
            "favorites": _count(toot, "favourites_count"),
            "boosts": _count(toot, "reblogs_count"),
            "replies": _count(toot, "replies_count"),
            "followers": _count(account, "followers_count"),
            "following": _count(account, "following_count"),
            "statuses": _count(account, "statuses_count"),
            "accountAge": RelevanceCalculator.calculate_account_age(account.get("created_at")),
        }

    @staticmethod
    def calculate_account_age(created_at: Any) -> int:
        """Idade da conta em dias (0 quando a data é inválida)."""
        if not created_at:
            return 0
        try:
            from hashpanel.utils.timezone import to_datetime

            created = to_datetime(created_at)
        except (TypeError, ValueError):
            logger.warning("Invalid date for account age calculation")
            return 0

        delta = abs(datetime.now(UTC) - created)
        return math.ceil(delta.total_seconds() / 86400)

    # --- fórmula ---
    def calculate_weighted_score(self, metrics: dict[str, Any]) -> float:
        """Score bruto: soma ponderada dos logs das métricas."""
        scaled_favorites = math.log10(max(1, metrics.get("favorites") or 0))
        scaled_boosts = math.log10(max(1, metrics.get("boosts") or 0))
        scaled_followers = math.log10(max(1, metrics.get("followers") or 0))
        scaled_replies = math.log10(max(1, metrics.get("replies") or 0))

        score = (
            self.weights["favorites"] * scaled_favorites
            + self.weights["boosts"] * scaled_boosts
            + self.weights["followers"] * scaled_followers
            + self.weights["replies"] * scaled_replies
        )

        if math.isnan(score) or math.isinf(score):
            logger.error("Invalid score calculated", metrics=metrics)
            return 0.0
        return score

    @staticmethod
    def normalize_score(raw_score: float) -> float:
        """Normaliza o score bruto para a escala 0–100."""
        if raw_score <= 0:
            return 0.0
        normalized = 100 * (1 - math.exp(-raw_score / MAX_EXPECTED_SCORE))
        return js_round_1(min(100.0, max(0.0, normalized)))

    def calculate_relevance(self, toot: dict[str, Any]) -> dict[str, Any]:
        """Devolve o post com os campos de relevância adicionados."""
        errors = self.validate_toot(toot)
        if errors:
            raise DataProcessingError(
                f"Invalid toot structure: {', '.join(errors)}",
                step="toot_validation",
                details={
                    "tootId": toot.get("id") if isinstance(toot, dict) else None,
                    "errors": errors,
                },
            )

        metrics = self.extract_metrics(toot)
        raw_score = self.calculate_weighted_score(metrics)
        score = self.normalize_score(raw_score)

        self._update_stats(score)

        result = dict(toot)
        result["relevanceScore"] = score
        result["relevanceScoreRaw"] = js_round_1(raw_score)
        result["metrics"] = metrics
        result["calculatedAt"] = datetime.now(UTC).isoformat()
        return result

    def _update_stats(self, score: float) -> None:
        self.total_calculations += 1
        self.max_score = max(self.max_score, score)
        self.min_score = min(self.min_score, score)
        self.average_score = (
            self.average_score * (self.total_calculations - 1) + score
        ) / self.total_calculations

    def sort_by_relevance(self, toots: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Ordena por relevância (maior primeiro), sem alterar a lista original."""
        scored = list(toots)
        for toot in scored:
            if toot.get("relevanceScore") is None:
                try:
                    toot.update(self.calculate_relevance(toot))
                except DataProcessingError:
                    toot["relevanceScore"] = 0
        scored.sort(key=lambda toot: toot.get("relevanceScore") or 0, reverse=True)
        return scored

    def get_top_toots(self, toots: list[dict[str, Any]], count: int = 5) -> list[dict[str, Any]]:
        """Posts mais relevantes."""
        return self.sort_by_relevance(toots)[:count]

    def get_stats(self) -> dict[str, Any]:
        """Estatísticas de uso do calculador."""
        attempts = self.total_calculations + self.errors
        return {
            "totalCalculations": self.total_calculations,
            "errors": self.errors,
            "averageScore": self.average_score,
            "maxScore": self.max_score,
            "minScore": 0 if self.min_score is math.inf else self.min_score,
            "weights": dict(self.weights),
            "errorRate": (self.errors / attempts * 100) if attempts else 0,
        }


_calculator: RelevanceCalculator | None = None


def get_relevance_calculator() -> RelevanceCalculator:
    """Instância única do calculador."""
    global _calculator
    if _calculator is None:
        _calculator = RelevanceCalculator()
    return _calculator
